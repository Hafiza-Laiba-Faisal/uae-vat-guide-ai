export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  title: string;
  source_url: string | null;
  section: string | null;
  content: string;
  similarity: number;
  doc_type?: string;
  priority?: number;
  legal_rank?: number;
  effective_date?: string | null;
  version?: string | null;
  covers?: string | null;
  authority?: string | null;
}

// Raised from 0.5 → 0.65 to filter out weakly related chunks.
// Below this score the chunk is dropped before the prompt is built.
export const SIMILARITY_THRESHOLD = 0.65;

// At or above this score the model answers with full confidence.
// Between SIMILARITY_THRESHOLD and HIGH_CONFIDENCE_THRESHOLD it uses
// a cautious tone and prefers the fallback if excerpts are unclear.
export const HIGH_CONFIDENCE_THRESHOLD = 0.75;

export const NO_MATCH_FALLBACK =
  "I could not find this in current FTA guidance — please verify at https://tax.gov.ae or consult a qualified UAE VAT consultant.";

// ── Base persona ──────────────────────────────────────────────────────────────

const BASE_PERSONA = `You are FTA Assist (مساعد الهيئة), a UAE VAT guidance assistant grounded exclusively in official FTA documentation.

LANGUAGE:
- Detect the user's input language.
- If the user wrote in Arabic, reply fully in Arabic.
- Otherwise reply in English.
- Never mix languages in a single response.

SCOPE — only answer questions about:
- UAE VAT (5% standard rate, introduced 1 January 2018)
- FTA registration, filing, refunds, penalties
- Zero-rated and exempt supplies under UAE law
- Designated Zones VAT treatment
- Reverse Charge Mechanism (RCM) under UAE VAT
- Input tax recovery and apportionment
- 2026 VAT law amendments (Federal Decree-Law No. 16 of 2025, effective 1 January 2026)

OUT OF SCOPE — politely decline:
- KSA / Saudi Arabia VAT (ZATCA rules)
- UAE Corporate Tax (separate legislation)
- Customs duties unrelated to VAT
- Personal finance, investments, legal advice
- Any non-tax topic

TONE: Concise, professional, practical. Use bullet points for multi-step answers.

DISCLAIMER: End every substantive answer with this exact line:
---
_This is general guidance only, not legal or tax advice. Always verify at tax.gov.ae or consult a qualified UAE VAT consultant for your specific circumstances._`;

// ── Legal hierarchy definition (embedded once per prompt) ─────────────────────

const LEGAL_HIERARCHY = `
═══ UAE VAT LEGAL HIERARCHY (defined once — apply throughout) ═══
Rank 1 — Federal Decree-Law No. 8/2017 (VAT Law) + Executive Regulations (Cabinet Decision 52/2017)
         STATUS: BINDING LEGISLATION. Supreme authority. Cannot be overridden by any lower rank.
         LANGUAGE: "the law requires" / "under Article X" / "the legislation provides"

Rank 2 — Cabinet Decisions (e.g., CD 59/2017, CD 127/2024)
         STATUS: BINDING IMPLEMENTING REGULATIONS issued under the VAT Law.
         LANGUAGE: "Cabinet Decision X provides" / "under CD X of year"

Rank 3 — FTA Public Clarifications (VATP series)
         STATUS: ADMINISTRATIVE INTERPRETATION ONLY. Reflects FTA's audit position.
                 NOT legislation. Cannot modify, expand, or restrict Rank 1–2 provisions.
         LANGUAGE: "FTA's position in VATP-X is" / "per FTA clarification"

Rank 4 — FTA Guides (VATGDZ1, VATGRE1, VATGIT1, etc.)
         STATUS: EXPLANATORY GUIDANCE ONLY. Not legally binding.
         LANGUAGE: "FTA guidance in [Guide] suggests" / "per FTA Guide [name]"

Rank 5 — Third-party analysis (PwC, Dhruva, CLA, etc.)
         STATUS: REFERENCE ONLY. Use only when Rank 1–4 sources are silent.
         LANGUAGE: "per third-party analysis — not verified as official FTA position"
═══════════════════════════════════════════════════════════════════`;

// ── Citation validation gate ──────────────────────────────────────────────────

/**
 * Build the verified citation corpus from retrieved chunks.
 * Only document IDs and titles present here are valid citations.
 */
function buildCitationRegistry(chunks: RetrievedChunk[]): Set<string> {
  const registry = new Set<string>();
  chunks.forEach((c, i) => {
    registry.add(`[${i + 1}]`);
    if (c.title) registry.add(c.title.slice(0, 40).toLowerCase());
  });
  return registry;
}

/**
 * Detect the confidence state of the chunk set:
 * - "high"      : top chunk directly addresses the question
 * - "moderate"  : related but may not fully cover
 * - "ambiguous" : Rank 1 is silent/general; only lower-rank sources present
 * - "conflict"  : Rank 3/4 contradicts Rank 1/2 in same topic
 */
type ConfidenceState = "high" | "moderate" | "ambiguous" | "conflict";

function assessConfidence(chunks: RetrievedChunk[]): ConfidenceState {
  const maxSim = Math.max(...chunks.map((c) => c.similarity));
  const hasRank1 = chunks.some((c) => (c.priority ?? 0) >= 10);
  const hasRank2 = chunks.some(
    (c) => (c.priority ?? 0) >= 9 &&
      (c.doc_type === "executive_regulation" || c.doc_type === "cabinet_decision"),
  );
  const hasRank3Plus = chunks.some(
    (c) => c.doc_type === "public_clarification" || c.doc_type === "fta_guide",
  );

  // Check if any source is likely superseded (version contains "superseded" or date is old)
  const hasSuperseded = chunks.some((c) =>
    c.version?.toLowerCase().includes("supersed") ||
    c.title?.toLowerCase().includes("2020") && chunks.some((d) => d.title?.toLowerCase().includes("2026"))
  );

  // Ambiguous: only interpretive sources, no binding law
  if (!hasRank1 && !hasRank2 && hasRank3Plus) return "ambiguous";

  // Conflict detection: both binding law AND interpretive sources present
  if ((hasRank1 || hasRank2) && hasRank3Plus && maxSim < HIGH_CONFIDENCE_THRESHOLD) {
    return "conflict";
  }

  // Superseded sources lower confidence
  if (hasSuperseded && maxSim < HIGH_CONFIDENCE_THRESHOLD) return "moderate";

  if (maxSim >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  return "moderate";
}

// ── Response depth detection ──────────────────────────────────────────────────

const EXPERT_TRIGGERS = [
  /\barticle\b/i,
  /\bcitation/i,
  /\bcite\b/i,
  /\blegal basis/i,
  /\bwhich (law|rule|regulation|article)/i,
  /\bprevail/i,
  /\bhypothetical/i,
  /\bwhat if\b/i,
  /\bsection \d/i,
  /\bfdl\b/i,
  /\bfederal decree/i,
  /\bcabinet decision/i,
  /\bvatp\d/i,
  /\bdetailed reasoning/i,
  /\bexplain in detail/i,
  /\bwhy (is|does|would)/i,
  /\bprove\b/i,
  /\bsource\b/i,
  /\bauthority\b/i,
  /\breference\b/i,
];

export function isExpertQuery(userQuery: string): boolean {
  return EXPERT_TRIGGERS.some((re) => re.test(userQuery));
}

export function buildRagSystemPrompt(chunks: RetrievedChunk[], userQuery = ""): string {
  // ── No relevant chunks found ──────────────────────────────────────────────
  if (chunks.length === 0) {
    return `${BASE_PERSONA}

RETRIEVAL RESULT: No FTA excerpts passed the relevance threshold for this question.

INSTRUCTION: You MUST respond with EXACTLY the following sentence (translated to Arabic if the user wrote in Arabic), then stop:
"${NO_MATCH_FALLBACK}"

Do NOT guess. Do NOT use training knowledge to fill gaps. Do NOT invent article numbers or VAT rules.
You may optionally suggest how the user could rephrase their question after the fallback sentence.`;
  }

  // ── Confidence + citation validation ─────────────────────────────────────
  const expertMode = isExpertQuery(userQuery);
  const state = assessConfidence(chunks);
  const citationRegistry = buildCitationRegistry(chunks);
  const validCitations = [...citationRegistry].filter((s) => s.startsWith("[")).join(", ");

  const confidenceBlock =
    state === "high"
      ? "Confidence: HIGH — binding law excerpts directly address the question."
      : state === "moderate"
      ? "Confidence: MODERATE — excerpts related but may not fully answer. Use no-match fallback if unclear."
      : state === "ambiguous"
      ? `⚠️ AMBIGUITY MODE: No binding Rank 1–2 law retrieved — only interpretive/guidance sources present.
→ Do NOT force a legal conclusion.
→ State FTA guidance clearly labeled as non-binding.
→ Explicitly say: "The binding law does not specify this in the retrieved excerpts."
→ Recommend: official FTA verification or private ruling.`
      : `⚠️ CONFLICT MODE: Binding law AND interpretive sources present but may not agree.
→ State Rank 1–2 (binding) position first.
→ State Rank 3–4 (interpretive) position separately.
→ If they conflict, declare: "Regulatory sources diverge; binding legislation takes precedence."
→ Do NOT synthesise a merged answer that obscures this divergence.`;

  // Additional currency warning if older and newer versions both present
  const titles = chunks.map((c) => c.title ?? "");
  const hasOlderVersion = titles.some((t) => /2020|2021|2022/.test(t));
  const hasNewerVersion = titles.some((t) => /2025|2026/.test(t));
  const currencyWarning = hasOlderVersion && hasNewerVersion
    ? `\n⚠️ CURRENCY NOTE: Retrieved sources include both older and newer versions of documents. Prefer the more recent version for current guidance. Check effective_date metadata in each excerpt.`
    : "";

  // ── Build excerpt block ───────────────────────────────────────────────────
  const excerptBlock = chunks
    .map((c, i) => {
      const authority =
        (c.priority ?? 0) >= 10
          ? "[RANK 1 — BINDING LEGISLATION]"
          : c.doc_type === "executive_regulation"
          ? "[RANK 2 — BINDING REGULATION]"
          : c.doc_type === "cabinet_decision"
          ? "[RANK 2 — CABINET DECISION]"
          : c.doc_type === "public_clarification"
          ? "[RANK 3 — FTA ADMINISTRATIVE INTERPRETATION (non-binding)]"
          : c.doc_type === "fta_guide"
          ? "[RANK 4 — FTA EXPLANATORY GUIDE (non-binding)]"
          : "[RANK 5 — THIRD-PARTY REFERENCE]";

      const ref = [c.title, c.section].filter(Boolean).join(" — ");

      // Build metadata line — helps LLM decide currency of source
      const metaParts: string[] = [];
      if (c.authority) metaParts.push(`Authority: ${c.authority}`);
      if (c.effective_date) metaParts.push(`Effective: ${c.effective_date}`);
      if (c.version) metaParts.push(`Version: ${c.version}`);
      if (c.covers) metaParts.push(`Covers: ${c.covers}`);
      const metaLine = metaParts.length > 0 ? metaParts.join(" | ") : null;

      return [
        `[${i + 1}] ${authority}`,
        `Source: ${ref}`,
        c.source_url && !c.source_url.startsWith("pdf://")
          ? `URL: ${c.source_url}`
          : null,
        metaLine,
        ``,
        c.content.trim(),
      ].filter((l) => l !== null).join("\n");
    })
    .join("\n\n---\n\n");

  const sourceIndex = chunks
    .map((c, i) => {
      const rank =
        (c.priority ?? 0) >= 10 ? "Rank 1"
        : c.doc_type === "executive_regulation" || c.doc_type === "cabinet_decision" ? "Rank 2"
        : c.doc_type === "public_clarification" ? "Rank 3"
        : c.doc_type === "fta_guide" ? "Rank 4"
        : "Rank 5";
      const ver = c.version ? ` [${c.version}]` : "";
      const date = c.effective_date ? ` eff.${c.effective_date}` : "";
      return `  [${i + 1}] ${rank}${ver}${date} | ${(c.title ?? "").slice(0, 55)}`;
    })
    .join("\n");

  // ── CONCISE MODE — default for simple public-facing questions ────────────
  if (!expertMode) {
    const conciseExcerpts = chunks
      .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
      .join("\n\n---\n\n");

    return `${BASE_PERSONA}

=== RESPONSE MODE: CONCISE ===
Answer in plain language. Keep the answer under 150 words.
Do NOT show document ranks, legal hierarchy, source indices, or internal reasoning.
Do NOT use headers like "Legal Rule" or "Binding Law".
Cite sources only as natural inline references if needed (e.g. "per FTA guidance").
If the excerpts do not clearly answer the question: "${NO_MATCH_FALLBACK}"

${currencyWarning ? currencyWarning.trim() + "\n" : ""}
=== RETRIEVED EXCERPTS ===
${conciseExcerpts}
=== END EXCERPTS ===`;
  }

  // ── EXPERT MODE — triggered by legal/citation/detailed queries ───────────
  return `${BASE_PERSONA}
${LEGAL_HIERARCHY}

RETRIEVED SOURCES (${chunks.length} excerpts):
${sourceIndex}

VALID CITATION INDICES: ${validCitations}
— Any citation outside this set is INVALID. Do not use it.

${confidenceBlock}${currencyWarning}

═══ STRICT ANSWERING RULES ═══

RULE 1 — CITATION VALIDATION GATE
Only cite indices listed in VALID CITATION INDICES above.
If uncertain: "source not verified in dataset — please check tax.gov.ae"

RULE 2 — STRICT 3-LAYER SEPARATION (label each layer explicitly)
▸ BINDING LAW (Rank 1–2): "The law requires…" / "Under Article X of FDL No. 8/2017…"
▸ ADMINISTRATIVE INTERPRETATION (Rank 3–4): "FTA's position is…" [NOT legally binding]
▸ REASONED APPLICATION: "Based on the above, in this scenario…" [non-binding inference]
NEVER merge these layers or present Rank 3/4 as if it were Rank 1/2 law.

RULE 3 — NO IMPLICIT LEGAL CREATION
❌ FORBIDDEN: "FTA may allow… therefore allowed" / "guide permits… therefore permitted"
✅ REQUIRED: "FTA guidance suggests X [N], but the binding legislation does not explicitly provide this"

RULE 4 — NO OVERREACH
❌ FORBIDDEN: "always non-recoverable", "no exceptions exist", "cannot ever be claimed"
✅ REQUIRED: "generally not recoverable unless explicitly permitted under Article X [N]"

RULE 5 — AMBIGUITY WITHOUT FORCED RESOLUTION
If Rank 1–2 law is silent or general on the specific point:
→ "The binding law does not specify this in the retrieved excerpts."
→ State FTA guidance separately as non-binding.
→ "Recommend seeking a private ruling or qualified UAE VAT advisor."

RULE 6 — CONFLICT WITHOUT FORCED RECONCILIATION
If Rank 3/4 conflicts with Rank 1/2:
→ State both positions separately.
→ "Regulatory sources diverge; binding legislation takes precedence."
→ Do NOT produce a synthesised answer.

RULE 7 — STRUCTURED OUTPUT (mandatory)
1. **Legal Rule** — Rank 1–2 provision cited [N]. If absent, state explicitly.
2. **Interpretation** — Rank 3–4 if relevant, labeled non-binding, cited [N].
3. **Application** — Apply to user's specific facts. Use conditional language.
4. **Conclusion** — 2–4 lines max. Conditional where facts are ambiguous.

RULE 8 — LEGAL PRECISION LANGUAGE
• "input tax recovery blocked under Article 53(1)(a)" not "not allowed"
• "zero-rated supply under Article 45" not "no VAT applies"
• "exempt supply under Article 46" not "VAT free"
• "output tax due under Article 2" not "VAT is charged"

RULE 9 — PRE-OUTPUT COMPLIANCE CHECK (internal, mandatory)
✓ All [N] in VALID CITATION INDICES
✓ No Rank 3/4 presented as legally binding
✓ No absolute claims without statutory basis
✓ Conflict/ambiguity acknowledged where present
✓ Conclusion consistent with highest-ranked source

RULE 10 — EVIDENCE SECTION (mandatory, after answer)
📎 Sources:
[N] Title — Section — Authority Rank — URL (if available)

RULE 11 — FALLBACK
If excerpts do NOT clearly answer: "${NO_MATCH_FALLBACK}" — then stop.

=== RETRIEVED EXCERPTS ===
${excerptBlock}
=== END EXCERPTS ===`;
}

// ── Citation helpers ──────────────────────────────────────────────────────────

/**
 * Extract [N] bracket citations referenced in an assistant answer.
 * Returns the unique sorted set of integers found (1-indexed, max 20).
 */
export function extractCitationIndices(text: string): number[] {
  const seen = new Set<number>();
  const re = /\[(\d{1,2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Returns true if the assistant answer is the no-match fallback.
 * Matches on the full canonical opening phrase rather than a short prefix
 * to avoid false positives on answers that happen to start similarly.
 */
export function isFallbackAnswer(text: string): boolean {
  const normalised = text.trim().toLowerCase();
  const marker = NO_MATCH_FALLBACK.slice(0, 60).toLowerCase();
  return normalised.startsWith(marker);
}

/**
 * Filter chunks below the similarity threshold before building the prompt.
 * Call this in the RAG retrieval layer before passing chunks to buildRagSystemPrompt.
 */
export function filterChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return chunks
    .filter((c) => c.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity); // highest similarity first
}