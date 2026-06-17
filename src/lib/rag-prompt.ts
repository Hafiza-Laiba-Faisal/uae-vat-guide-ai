/**
 * RAG prompt assembly + citation extraction.
 * Pure functions — covered by src/lib/__tests__/rag-prompt.test.ts
 */

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  title: string;
  source_url: string | null;
  section: string | null;
  content: string;
  similarity: number;
}

export const SIMILARITY_THRESHOLD = 0.5;
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;
export const NO_MATCH_FALLBACK =
  "I could not find this in current FTA guidance — please verify at https://tax.gov.ae or consult a qualified UAE VAT consultant.";

const BASE_PERSONA = `You are the UAE VAT Assistant, a specialist on Value Added Tax in the United Arab Emirates administered by the Federal Tax Authority (FTA).

LANGUAGE: Detect the user's language. If they wrote in Arabic, respond in Arabic; otherwise respond in English.
SCOPE: Only answer UAE VAT questions. For anything else (KSA VAT, corporate tax, personal finance, customs unrelated to VAT) politely decline.
TONE: Concise, professional, practical.
DISCLAIMER: End every substantive answer with this line on its own:
---
_This is general guidance only, not legal or tax advice. Verify at tax.gov.ae or consult a qualified UAE VAT consultant._`;

/**
 * Build the system prompt. When grounded excerpts are supplied the model must
 * answer ONLY from them and cite by bracketed index. When no excerpts pass the
 * similarity threshold the model is instructed to use the exact fallback line.
 */
export function buildRagSystemPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return `${BASE_PERSONA}

RETRIEVAL RESULT: No relevant FTA excerpts were found in the knowledge base for this question.

YOU MUST respond with EXACTLY this sentence (translated to the user's language if Arabic), then stop:
"${NO_MATCH_FALLBACK}"

Do not guess, do not invent article numbers, do not answer from prior training. After the fallback you may optionally suggest a clearer way the user could rephrase their question.`;
  }

  const maxSim = Math.max(...chunks.map((c) => c.similarity));
  const confidenceNote =
    maxSim >= HIGH_CONFIDENCE_THRESHOLD
      ? "Confidence in retrieved excerpts: HIGH."
      : "Confidence in retrieved excerpts: MODERATE. If the excerpts do not clearly answer the question, prefer the no-match fallback below.";

  const excerptBlock = chunks
    .map((c, i) => {
      const ref = [c.title, c.section].filter(Boolean).join(" — ");
      return `[${i + 1}] ${ref}${c.source_url ? `\nURL: ${c.source_url}` : ""}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  return `${BASE_PERSONA}

RETRIEVAL RESULT: ${chunks.length} relevant FTA excerpts found. ${confidenceNote}

You MUST answer ONLY using the excerpts below. Cite every substantive claim with a bracketed reference matching the excerpt index, e.g. [1] or [2]. After your answer add a "Sources:" list mapping each [N] to the document title and section.

If the excerpts do NOT contain enough information to answer the question, respond with EXACTLY:
"${NO_MATCH_FALLBACK}"
…then stop. Do not pad with general VAT knowledge.

=== FTA EXCERPTS ===
${excerptBlock}
=== END EXCERPTS ===`;
}

/**
 * Extract [N] bracket citations referenced in an assistant answer.
 * Returns the unique sorted set of integers found.
 */
export function extractCitationIndices(text: string): number[] {
  const seen = new Set<number>();
  const re = /\[(\d{1,2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 99) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** True iff the assistant answer is the no-match fallback line. */
export function isFallbackAnswer(text: string): boolean {
  return text.trim().startsWith(NO_MATCH_FALLBACK.slice(0, 40));
}
