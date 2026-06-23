# UAE VAT Guide AI — RAG Architecture Deep Dive

> **Primary RAG Type:** Advanced RAG (with Corrective + Modular + Adaptive elements)  
> **Best Descriptive Name:** "Rule-Augmented Advanced Legal RAG"  
> **Last Updated:** June 2026

---

## Table of Contents

1. [What Type of RAG Is This?](#1-what-type-of-rag-is-this)
2. [High-Level Request Flow](#2-high-level-request-flow)
3. [Layer-by-Layer Architecture](#3-layer-by-layer-architecture)
   - [Layer 3 — Frontend UI & Chat Transport](#layer-3--frontend-ui--chat-transport)
   - [Layer 7 — Rule Engine & Intent Detection](#layer-7--rule-engine--intent-detection)
   - [Layer 2 — RAG Retrieval](#layer-2--rag-retrieval)
   - [Layer 4 — Prompt Building](#layer-4--prompt-building)
   - [Layer 5 — Admin Panel & Document Management](#layer-5--admin-panel--document-management)
   - [Layer 6 — Authentication & Authorization](#layer-6--authentication--authorization)
   - [Layer 1 — LLM Generation](#layer-1--llm-generation)
4. [Embedding Model & Strategy](#4-embedding-model--strategy)
5. [Document Ingestion Techniques](#5-document-ingestion-techniques)
   - [Path A — Offline Bulk Ingestion](#path-a--offline-bulk-ingestion-bulk-ingest-pdfspy)
   - [Path B — Live Web Ingestion](#path-b--live-web-ingestion-fta-updaterserverts)
6. [Chunking Strategy](#6-chunking-strategy)
7. [Vector Database & Schema](#7-vector-database--schema)
8. [Retrieval Strategies](#8-retrieval-strategies)
9. [Confidence Scoring](#9-confidence-scoring)
10. [Response Depth Modes](#10-response-depth-modes)
11. [Legal Hierarchy Enforcement](#11-legal-hierarchy-enforcement)
12. [LLM for Generation](#12-llm-for-generation)
13. [Quick Reference Summary](#13-quick-reference-summary)

---

## 1. What Type of RAG Is This?

This system does **not** fit neatly into a single RAG category. It is a **combination**, but the closest match among known RAG types is:

### Primary: Advanced RAG

Advanced RAG is defined as a refined RAG pipeline that combines multiple improvements — reranking, feedback loops, branching, improved retrieval — to produce more accurate results. This project has all of those:

| Feature in This Project | Present in Advanced RAG? |
|---|---|
| Rule Engine running before retrieval | ✅ Yes |
| Intent detection + doc_type filtering | ✅ Yes |
| Priority boost + similarity thresholds | ✅ Yes (improved retrieval) |
| Confidence assessment layer | ✅ Yes (feedback/check layer) |
| Dual response modes (Concise + Expert) | ✅ Yes |
| Legal hierarchy + citation validation | ✅ Yes |
| Smart chunking + auto metadata inference | ✅ Yes |
| Live web ingestion + auto-update pipeline | ✅ Yes |

### Secondary Elements from Other RAG Types

| RAG Type | What This Project Borrows |
|---|---|
| **Corrective RAG** | Confidence assessment drops low-similarity chunks; fallback response when no good match found |
| **Modular RAG** | Clean separation: Rule Engine → Retrieval → Prompt Building → Generation (each is an independent module) |
| **Adaptive RAG** | Behaviour changes based on intent — deterministic queries skip RAG entirely; expert queries trigger full legal mode |

### What This Is NOT

- ❌ Naive RAG / Simple RAG — no naive pass-through
- ❌ Agentic RAG — no autonomous multi-step agent loop
- ❌ Graph RAG — no knowledge graph
- ❌ HyDE — no hypothetical document generation
- ❌ Multimodal RAG — text only
- ❌ Self-RAG — no self-reflection tokens

**Final classification:**  
**Primary:** Advanced RAG | **Secondary:** Corrective RAG + Modular RAG + Adaptive RAG

---

## 2. High-Level Request Flow

```
User Query
     │
     ▼
┌─────────────────────────────────────────────┐
│  LAYER 7 — Rule Engine & Intent Detection   │  vat-rules.ts
│  (Pure regex — zero LLM calls here)         │
└─────────────────────────────────────────────┘
     │
     ├──► Out of scope? (KSA VAT, Corp Tax, etc.)
     │         └──► Short-circuit → LLM with canned scope message
     │
     ├──► Deterministic? (VAT calc, registration threshold, deadlines, penalties)
     │         └──► Rule engine answer → prepend to system prompt → LLM
     │
     └──► Non-deterministic → continue to RAG
     │
     ▼
┌─────────────────────────────────────────────┐
│  LAYER 2 — RAG Retrieval                    │  rag.server.ts + embeddings.server.ts
└─────────────────────────────────────────────┘
     │
     ├──► embedOne(query) → 1024-dim vector (mistral-embed)
     ├──► match_fta_chunks() RPC → cosine similarity + priority boost → top 8
     ├──► Intent-based doc_type filter (if ≥2 chunks remain)
     └──► filterChunks() → drop below 0.65 threshold → keep top 5
     │
     ▼
┌─────────────────────────────────────────────┐
│  LAYER 4 — Prompt Building                  │  rag-prompt.ts + vat-rules.ts
└─────────────────────────────────────────────┘
     │
     ├──► assessConfidence() → high / moderate / ambiguous / conflict
     ├──► isExpertQuery() → Concise Mode or Expert Mode
     ├──► buildRagSystemPrompt() → base persona + chunks + rank labels + metadata
     └──► buildRuleContext() → deterministic facts prepended
     │
     ▼
┌─────────────────────────────────────────────┐
│  LAYER 1 — LLM Generation                   │  ai-gateway.server.ts
└─────────────────────────────────────────────┘
     │
     └──► streamText() — mistral-large-latest, temp 0.1
               │
               ▼
         Streaming response to browser
         + sources metadata (deduped by document)
```

---

## 3. Layer-by-Layer Architecture

The system is built in 7 distinct layers. The code explicitly labels them in comments (e.g. `// ── Layer 2: RAG retrieval`, `// ── Layer 3+7: Intent detection`). Here is each layer in order of execution, from user input down to the response.

---

### Layer 3 — Frontend UI & Chat Transport

**Files:** `src/routes/index.tsx`, `src/components/ai-elements/`

This is the entry point — what the user actually sees and interacts with.

```
Browser
  │
  ├── useChat({ transport: DefaultChatTransport({ api: "/api/chat" }) })
  │     └── @ai-sdk/react — manages message state, status, streaming
  │
  ├── PromptInput component
  │     ├── PromptInputTextarea — user types query here (English or Arabic)
  │     └── PromptInputSubmit — sends message on Enter or click
  │
  ├── Conversation + ConversationContent — scrollable message list
  │     ├── User messages — plain text bubbles
  │     ├── Assistant messages — Streamdown (Markdown renderer, streams tokens live)
  │     └── Shimmer — "Searching FTA guidance…" loading indicator (status === "submitted")
  │
  └── Empty state — 6 suggestion chips for first-time users
```

**Key design decisions:**
- `useChat` from `@ai-sdk/react` handles the full message lifecycle — sending, streaming, appending tokens in real time, error state
- `DefaultChatTransport` points to `/api/chat` — a TanStack Start server route, not a separate API server
- Arabic RTL detection: `lang="ar"` is set on message containers if the text contains Arabic Unicode range `[\u0600-\u06FF]`
- `Streamdown` renders markdown progressively as tokens arrive — no flicker or re-render of the full message on each token
- The chat is **public** — no auth required to ask questions. Auth is only needed for the admin panel

---

### Layer 7 — Rule Engine & Intent Detection

**File:** `src/lib/vat-rules.ts`

This layer runs **before any vector retrieval**. It uses regex pattern matching — no LLM involved — to classify the query into one of these intents:

| Intent | Example Queries | Deterministic? |
|---|---|---|
| `registration_check` | "Do I need to register for VAT?" | ✅ Yes |
| `vat_calculation` | "What is VAT on AED 10,000?" | ✅ Yes |
| `filing_deadline` | "When is my VAT return due?" | ✅ Yes |
| `penalty` | "Fine for late VAT filing?" | ✅ Yes |
| `designated_zone` | "VAT in free zones?" | ❌ No → RAG |
| `rcm` | "Reverse charge on gold?" | ❌ No → RAG |
| `real_estate` | "VAT on property sale?" | ❌ No → RAG |
| `out_of_scope` | "KSA VAT rules?" | ✅ Short-circuit |

For **deterministic intents**, a hardcoded fact-based answer is built and prepended to the LLM system prompt — the LLM is instructed to use this as the basis for its answer. This avoids hallucination on well-known facts like the 5% rate, AED 375,000 threshold, or 28-day filing deadline.

For **out-of-scope** intents, the RAG pipeline is completely skipped. The LLM is given only the scope message.

Each intent also carries `suggested_doc_types` — e.g., `rcm` → `["vat_law", "cabinet_decision", "public_clarification"]` — which is used later to filter retrieved chunks.

---

### Layer 2 — RAG Retrieval

**Files:** `src/lib/rag.server.ts`, `src/lib/embeddings.server.ts`

```
query string
     │
     ▼
embedOne(query)              ← mistral-embed API, 1024 dimensions
     │
     ▼
supabaseAdmin.rpc("match_fta_chunks", {
  query_embedding,
  match_count: 8,
  similarity_threshold: 0.4   ← loose DB filter, tight filter applied in code
})
     │
     ▼
Intent-based doc_type filter ← only if ≥2 chunks survive
     │
     ▼
filterChunks()               ← drop similarity < 0.65, sort desc, take top 5
```

The Supabase RPC returns chunks pre-sorted by a **boosted similarity score** — see Section 8 for details.

---

### Layer 4 — Prompt Building

**Files:** `src/lib/rag-prompt.ts`, `src/lib/vat-rules.ts`

This layer assembles the final system prompt. Its responsibilities:

1. **Confidence assessment** — determines confidence state from chunk scores and legal ranks
2. **Response mode detection** — decides Concise or Expert mode based on query regex
3. **Excerpt block** — formats each chunk with rank label, authority, effective date, version, covers
4. **Legal hierarchy** — injects the full 5-rank hierarchy definition (Expert mode only)
5. **Citation registry** — builds a set of valid `[N]` indices the LLM is permitted to cite
6. **Rule context** — appends deterministic facts block from the rule engine
7. **Deterministic prefix** — if a rule engine answer exists, it is prepended as the authoritative basis

---

### Layer 5 — Admin Panel & Document Management

**Files:** `src/routes/_authenticated.admin.tsx`, `src/lib/admin.functions.ts`

The admin panel is the control plane for the knowledge base. It is protected by Supabase auth + role check — only users with the `admin` role can access it.

```
Admin user logs in → /admin route
      │
      ├── getMyRole() server fn
      │     └── supabase.rpc("has_role", { _user_id, _role: "admin" })
      │           ├── Not admin → "Claim admin access" button (first user only)
      │           └── Admin → show full panel
      │
      ├── Section 1: "Refresh from FTA" button
      │     └── triggerFtaRefresh() → fta-updater.server.ts → full auto-discover pipeline
      │           └── Mode toggle: Firecrawl (default) or Direct
      │
      ├── Section 2: Custom URL scraper
      │     └── Paste one or more URLs (one per line)
      │     └── triggerFtaRefresh({ urls, mode }) → scrape + embed + upsert
      │
      ├── Section 3: Manual document add
      │     ├── Paste text directly OR upload .txt / .md file
      │     ├── ingestDocument() server fn:
      │     │     ├── chunkText() → chunk the content
      │     │     ├── contentHash() → dedup check
      │     │     ├── embedTexts() → Mistral embed
      │     │     └── INSERT fta_documents + fta_chunks
      │     └── Admin-only guard: has_role check inside server fn
      │
      └── Section 4: Indexed documents list
            ├── listDocuments() → shows all fta_documents
            ├── Download button → getDocumentChunks() → full chunk text export as .txt
            └── Delete button → deleteDocument() → removes doc + all its chunks
```

**Key design decisions:**
- All admin server functions use `requireSupabaseAuth` middleware — Bearer token is validated server-side before any operation runs
- `has_role` RPC is called inside every sensitive server function as a second gate (defence in depth — middleware checks auth, server fn checks role)
- The "Refresh from FTA" button triggers the exact same pipeline as the scheduled auto-update, making manual refresh and automated refresh identical in behaviour
- Document download gives admins a way to inspect exactly what text the LLM is seeing — chunk-by-chunk, with section headings and line numbers

---

### Layer 6 — Authentication & Authorization

**Files:** `src/integrations/supabase/auth-attacher.ts`, `src/integrations/supabase/auth-middleware.ts`, `src/routes/auth.tsx`, `src/routes/_authenticated.tsx`

Authentication is only required for the admin panel. The public chat is completely open.

```
CLIENT SIDE (auth-attacher.ts)
  attachSupabaseAuth middleware (registered globally on all serverFn calls):
  └── supabase.auth.getSession() → get access_token
  └── Attach as Authorization: Bearer <token> header on every server fn request

SERVER SIDE (auth-middleware.ts)
  requireSupabaseAuth middleware (used on all admin server fns):
  └── Read Authorization header from request
  └── createClient() with the token
  └── supabase.auth.getClaims(token) → validate JWT + extract userId
  └── Pass { supabase, userId, claims } to server fn handler via context

ROLE CHECK (inside each admin server fn)
  supabase.rpc("has_role", { _user_id: userId, _role: "admin" })
  └── True  → execute the admin operation
  └── False → throw "Forbidden: admin role required"

FIRST USER SETUP
  claim_initial_admin() RPC
  └── If no admin exists yet → grant admin role to current user
  └── If admin already exists → reject (prevents takeover)
```

**Auth flow for admin panel:**

```
User visits /admin
      │
      ▼
_authenticated.tsx layout route
      └── Checks Supabase session (client-side)
            ├── Not logged in → redirect to /auth
            └── Logged in → render admin page
                  └── getMyRole() server fn (server-side role check)
                        ├── No admin role → claim screen
                        └── Has admin role → full admin UI
```

**Key design decisions:**
- Auth uses Supabase's JWT-based auth — no custom session management
- The `requireSupabaseAuth` middleware validates the Bearer token on every server fn call — it does not trust the client's claims
- Role check is double-layered: route-level (client redirect) + server fn level (throw 403) — an authenticated non-admin user cannot call admin functions even via direct API calls
- The public `/api/chat` route has **no auth middleware** — it is intentionally public for the chatbot

---

### Layer 1 — LLM Generation

**File:** `src/lib/ai-gateway.server.ts`

```typescript
const mistral = createMistral({ apiKey });
return mistral("mistral-large-latest");
```

- Model: `mistral-large-latest`
- Temperature: `0.1` — kept near-zero for legal accuracy
- Mode: Full streaming via Vercel AI SDK `streamText()` + `toUIMessageStreamResponse()`
- After streaming, sources are deduped by `document_id` (highest similarity per document kept) and returned as message metadata to the frontend

---

## 4. Embedding Model & Strategy

| Property | Value |
|---|---|
| Model | `mistral-embed` |
| Provider | Mistral AI |
| Dimensions | **1024** |
| Vector storage | `vector(1024)` column in Supabase pgvector |
| Runtime SDK | Vercel AI SDK `@ai-sdk/mistral` — `embed()` / `embedMany()` |
| Bulk ingestion | Direct Mistral REST API `POST /v1/embeddings` |

**Key design decision:** The same `mistral-embed` model is used for both document indexing and query embedding. This ensures both vectors live in the same embedding space, which is critical for cosine similarity to be meaningful.

The two functions used at runtime:

```typescript
// Single query
export async function embedOne(input: string): Promise<number[]>

// Batch ingestion
export async function embedTexts(inputs: string[]): Promise<number[][]>
```

---

## 5. Document Ingestion Techniques

### Path A — Offline Bulk Ingestion (`bulk-ingest-pdfs.py`)

This is the primary ingestion path for the 36 official FTA documents.

```
PDF files in downloads/ folder
        │
        ▼
extract_pdf_text()
  └── pdfminer.six with LAParams:
        line_margin=0.5, word_margin=0.1, char_margin=2.0
  └── Post-processing:
        - \x0c (form feed) → \n\n (paragraph break)
        - collapse multiple spaces
        - collapse 3+ newlines → 2
        - join single-break lines (broken sentences)
        │
        ▼
content_hash()              ← MD5 of full text for dedup check
        │
        ├──► Hash unchanged? → skip (no re-indexing)
        │
        ▼
chunk_text()                ← 3500 char chunks, 500 char overlap
        │
        ▼
infer_metadata()            ← auto-detect from filename + title
  └── doc_type, priority, legal_rank, authority,
      effective_date, version, covers
        │
        ▼
embed_texts()               ← Mistral REST API, batches of 16
  └── 0.5s sleep between batches (rate limit)
        │
        ▼
Supabase upsert
  └── fta_documents record (with full metadata)
  └── fta_chunks in batches of 50
```

**Auto metadata inference** — the `infer_metadata()` function detects document properties purely from filename and title string patterns:

| Pattern | doc_type | priority | legal_rank |
|---|---|---|---|
| `decree-law` / `federal decree` | `vat_law` | 10 | 1 |
| `cabinet` / `executive reg` | `cabinet_decision` / `executive_regulation` | 10 | 2 |
| `vatp` / `clarification` | `public_clarification` | 9 | 3 |
| `guide` / `vatg` | `fta_guide` | 9 | 4 |
| Everything else | `fta_guide` | 6 | 4–5 |

**Duplicate handling** — a `SKIP_DUPLICATES` set in the script prevents indexing the same document twice when it exists under multiple filenames (e.g., `law-1227-en.pdf` is the same as `01-vat-law-decree-8-2017.pdf`).

---

### Path B — Live Web Ingestion (`fta-updater.server.ts`)

Triggered from the admin panel. Handles live FTA website updates without requiring a code deployment.

```
Admin triggers refresh
        │
        ▼
PRIMARY_SOURCES list (14 hardcoded official URLs)
        │
        ├── HTML pages → Firecrawl API /v2/scrape (markdown format)
        └── PDF URLs  → pdfjs-dist (page-by-page, [Page N] markers)
        │
        ▼
Auto-discovery Step 1:
  uaelegislation.gov.ae/related-legislations
  └── Firecrawl extracts all /download links
  └── New Cabinet Decision IDs (not already in primary) → ingest
        │
        ▼
Auto-discovery Step 2:
  tax.gov.ae/en/taxes/vat/guides.references.aspx
  └── Firecrawl extracts all .pdf links from tax.gov.ae
  └── New PDFs not in primary sources → ingest
        │
        ▼
Same pipeline as offline:
  contentHash() → chunk → embed → upsert fta_documents + fta_chunks
```

**PDF routing rule:** Even in Firecrawl mode, any URL ending in `.pdf` is always routed to `pdfjs-dist` (not Firecrawl), because Firecrawl does not parse PDF binary content reliably.

---

## 6. Chunking Strategy

**Implemented in two places (identical algorithm):**
- TypeScript: `src/lib/chunker.ts`
- Python: `scripts/bulk-ingest-pdfs.py → chunk_text()`

| Parameter | Value |
|---|---|
| Max chunk size | **3500 chars** (~1000 tokens) |
| Overlap | **500 chars** (~150 tokens) |
| Split boundary | Blank-line paragraph breaks (`\n\n`) |

### Algorithm (step by step)

```
1. Normalize whitespace
   └── Collapse spaces, join single-newline broken lines

2. Split on blank lines → list of paragraphs

3. Greedy packing loop:
   For each paragraph:
   └── Would adding it to current buffer exceed 3500 chars?
         ├── No  → append to buffer ("candidate")
         └── Yes → flush buffer as a chunk, start new buffer with this paragraph

4. Oversized paragraph (single para > 3500 chars):
   └── Hard-slice at (3500 - 500) = 3000 char intervals
   └── Each slice is its own chunk

5. Overlap carry:
   └── After flushing a chunk, carry last 500 chars into next buffer
   └── Ensures citations/clauses spanning a chunk boundary are still findable

6. Section heading detection (detectSection):
   └── Inspects first line of each chunk
   └── Matches: Article N, Section N, Chapter, VATP NNN,
               Cabinet Decision, Federal Decree, Executive Regulation
   └── Stored as `section` field in fta_chunks
   └── Surfaced in prompts as "Source: [Title] — [Section]"
```

### Why 3500 chars?

- Fits comfortably within `mistral-embed`'s context window
- ~1000 tokens — gives enough context for a complete legal clause or article
- The 500-char overlap (~150 tokens) is ~14% of chunk size — enough to preserve continuity without excessive duplication

---

## 7. Vector Database & Schema

**Database:** Supabase PostgreSQL + `pgvector` extension

### Table: `fta_documents`

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `title` | text | Document title |
| `source_url` | text | Unique URL — `pdf://filename` or `https://...` |
| `source_kind` | text | `pdf`, `firecrawl`, `landing_page` |
| `doc_type` | text | `vat_law`, `executive_regulation`, `cabinet_decision`, `public_clarification`, `fta_guide` |
| `priority` | integer | 6–10 — used in similarity boost formula |
| `legal_rank` | integer | 1–5 — legal hierarchy rank |
| `authority` | text | Issuing authority (e.g. "UAE Federal Government") |
| `effective_date` | date | When this document took effect |
| `version` | text | Version label (e.g. `VATGDZ1`, `VATP031`, `Jun 2026`) |
| `covers` | text | One-line description of what this document covers |
| `content_hash` | text | MD5 of full text — used for change detection |
| `chunk_count` | integer | Number of chunks stored |

### Table: `fta_chunks`

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `document_id` | uuid | FK → `fta_documents` |
| `chunk_index` | integer | Position within document (0-indexed) |
| `section` | text | Detected section heading (nullable) |
| `content` | text | Chunk text (≤3500 chars) |
| `embedding` | vector(1024) | Mistral embed vector |

### Retrieval RPC: `match_fta_chunks()`

```sql
CREATE OR REPLACE FUNCTION match_fta_chunks(
  query_embedding      vector(1024),
  match_count          int     DEFAULT 5,
  similarity_threshold float   DEFAULT 0.4
)
RETURNS TABLE (
  chunk_id uuid, document_id uuid, title text, source_url text,
  section text, content text, similarity float,
  doc_type text, priority integer, legal_rank integer,
  effective_date date, version text, covers text, authority text
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id, c.document_id, d.title, d.source_url, c.section, c.content,
    (1 - (c.embedding <=> query_embedding)) + (d.priority * 0.009) AS similarity,
    d.doc_type, d.priority, d.legal_rank,
    d.effective_date, d.version, d.covers, d.authority
  FROM fta_chunks c
  JOIN fta_documents d ON d.id = c.document_id
  WHERE (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
```

**The priority boost explained:**

A Rank 1 law document has `priority = 10`.  
Boost = `10 × 0.009 = +0.09`

A Rank 4 FTA guide has `priority = 6`.  
Boost = `6 × 0.009 = +0.054`

Difference = `0.036` — so if both have the same cosine score, the law chunk ranks 0.036 points higher. This is intentional: legally binding sources should always be preferred over explanatory guides when the semantic similarity is equal.

---

## 8. Retrieval Strategies

Five distinct retrieval strategies are applied in sequence:

### Strategy 1 — Loose DB Filter
The Supabase RPC is called with `similarity_threshold: 0.4` — a loose filter to get 8 candidates. Tighter filtering happens in application code.

### Strategy 2 — Intent-Based Doc Type Filter
```typescript
if (intent.suggested_doc_types?.length && chunks.length > 0) {
  const typed = chunks.filter(c =>
    intent.suggested_doc_types.includes(c.doc_type)
  );
  if (typed.length >= 2) chunks = typed;
}
```
If the user is asking about Reverse Charge Mechanism, only `cabinet_decision` and `public_clarification` chunks are kept. This avoids irrelevant chunks from unrelated document types ranking high purely on semantic similarity.

### Strategy 3 — Similarity Threshold Filter
```typescript
// SIMILARITY_THRESHOLD = 0.65
chunks.filter(c => c.similarity >= SIMILARITY_THRESHOLD).slice(0, 5)
```
Chunks below 0.65 are dropped entirely. If nothing passes the threshold, the no-match fallback is triggered.

### Strategy 4 — Priority Boost (DB level)
Built into the SQL RPC — see Section 7. Higher-rank legal documents get a small additive boost to their cosine score.

### Strategy 5 — Top-K Cap
After all filters, maximum 5 chunks are passed to the prompt builder. This keeps the prompt size manageable and the LLM focused on the most relevant excerpts.

---

## 9. Confidence Scoring

After retrieval, `assessConfidence()` classifies the chunk set into one of four states:

| State | Condition | LLM Instruction |
|---|---|---|
| `high` | Top similarity ≥ 0.75 AND Rank 1–2 sources present | Answer with full confidence, no hedging |
| `moderate` | Similarity < 0.75 OR superseded documents detected | Use cautious tone; use fallback if unclear |
| `ambiguous` | No Rank 1–2 chunks — only guides/clarifications | Do NOT force a legal conclusion; label all sources non-binding; recommend private ruling |
| `conflict` | Both binding law AND interpretive sources present, similarity < 0.75 | State both positions separately; declare divergence; do NOT synthesise |

The confidence state is injected into the system prompt as an explicit instruction block, so the LLM knows how authoritative to sound.

**Superseded detection:** If chunks from both 2020–2022 and 2025–2026 documents are present for the same title, a currency warning is injected into the prompt telling the LLM to prefer the more recent version.

---

## 10. Response Depth Modes

The query is analysed by `isExpertQuery()` to decide which prompt mode to use:

### Concise Mode (default)
Triggered for general questions.
- Answer in plain language, max 150 words
- No document ranks, legal hierarchy, or source indices shown
- Natural inline references only (e.g. "per FTA guidance")
- Chunk content passed without rank labels

### Expert Mode
Triggered when the query contains legal/citation keywords:

```
article, citation, cite, legal basis, which law, which rule,
which regulation, which article, prevail, hypothetical, what if,
section N, FDL, federal decree, cabinet decision, VATPNNN,
detailed reasoning, explain in detail, why is, prove, source,
authority, reference
```

In Expert Mode:
- Full legal hierarchy block is injected into the prompt
- Each chunk is labeled with its rank (`[RANK 1 — BINDING LEGISLATION]`, etc.)
- Authority, effective date, version, and covers metadata are shown per chunk
- 11 strict answering rules are enforced (see below)
- A citation registry is built — only `[N]` indices present in retrieved chunks are valid
- A mandatory "📎 Sources" section is required at the end of every answer
- A pre-output compliance check (Rule 9) must be run internally before generating

---

## 11. Legal Hierarchy Enforcement

Every document in the knowledge base is assigned a legal rank. The LLM is instructed to never present lower-rank sources as legally binding:

| Rank | Source Type | Binding? | Required Language |
|---|---|---|---|
| 1 | Federal Decree-Law (VAT Law + Tax Procedures Law) | ✅ Yes | "the law requires" / "under Article X" |
| 2 | Cabinet Decisions, Executive Regulations | ✅ Yes | "Cabinet Decision X provides" |
| 3 | FTA Public Clarifications (VATP series) | ❌ No — audit position only | "FTA's position in VATP-X is" |
| 4 | FTA Guides (VATGDZ1, VATGRE1, VATGIT1, etc.) | ❌ No — explanatory only | "FTA guidance in [Guide] suggests" |
| 5 | Third-party analysis (PwC, Dhruva, CLA) | ❌ No — reference only | "per third-party analysis" |

**The 11 Expert Mode answering rules** (enforced in system prompt):

| Rule | Description |
|---|---|
| 1 | Citation Validation Gate — only cite indices in VALID CITATION INDICES |
| 2 | Strict 3-layer separation: Binding Law / Administrative Interpretation / Reasoned Application |
| 3 | No implicit legal creation from guides (guide says X ≠ therefore X is legal) |
| 4 | No overreach — no "always", "never", "no exceptions" without statutory basis |
| 5 | Ambiguity without forced resolution — state law is silent if it is |
| 6 | Conflict without forced reconciliation — state both positions separately |
| 7 | Structured output: Legal Rule → Interpretation → Application → Conclusion |
| 8 | Legal precision language (e.g. "blocked under Article 53(1)(a)" not "not allowed") |
| 9 | Pre-output compliance check (internal) — verify all rules before generating |
| 10 | Evidence section mandatory after every answer |
| 11 | Fallback if excerpts don't clearly answer the question |

---

## 12. LLM for Generation

| Property | Value |
|---|---|
| Model | `mistral-large-latest` |
| Provider | Mistral AI |
| SDK | `@ai-sdk/mistral` + Vercel AI SDK `streamText()` |
| Temperature | `0.1` (near-deterministic) |
| Mode | Full streaming — `toUIMessageStreamResponse()` |
| Framework | TanStack Start server route (`/api/chat`) |

**Temperature 0.1** is a deliberate choice for a legal domain system. Higher temperatures introduce variation that is unacceptable when citing specific articles, thresholds, or penalties — these must be reproduced exactly every time.

**Post-stream source deduplication:**

After the stream completes, sources are deduplicated by `document_id` — if two chunks from the same document were retrieved, only the one with higher similarity is shown in the UI source panel:

```typescript
const seen = new Map<string, Chunk>();
for (const c of chunks) {
  const existing = seen.get(c.document_id);
  if (!existing || c.similarity > existing.similarity) {
    seen.set(c.document_id, c);
  }
}
```

---

## 13. Quick Reference Summary

| Layer | Technology | File |
|---|---|---|
| LLM | `mistral-large-latest` (Mistral AI) | `ai-gateway.server.ts` |
| Embeddings | `mistral-embed`, 1024-dim | `embeddings.server.ts` |
| Vector DB | Supabase pgvector (PostgreSQL) | Supabase project |
| Similarity | Cosine distance + priority boost (×0.009) | `match_fta_chunks()` RPC |
| Chunk size | 3500 chars, 500 char overlap | `chunker.ts` / `bulk-ingest-pdfs.py` |
| Similarity threshold | 0.65 (drop), 0.75 (high confidence) | `rag-prompt.ts` |
| Top-K retrieval | 8 fetched from DB → 5 after filtering | `rag.server.ts` |
| PDF extraction (offline) | `pdfminer.six` | `bulk-ingest-pdfs.py` |
| PDF extraction (live) | `pdfjs-dist` | `fta-updater.server.ts` |
| HTML scraping | Firecrawl API | `fta-updater.server.ts` |
| Intent engine | Regex-based, pre-RAG | `vat-rules.ts` |
| Documents indexed | 36 official FTA documents across 5 legal tiers | `downloads/manifest.json` |
| Response modes | Concise (default) + Expert (legal queries) | `rag-prompt.ts` |
| Confidence states | high / moderate / ambiguous / conflict | `rag-prompt.ts` |

---

## Document Coverage (5 Legal Tiers)

| Tier | Rank | doc_type | Examples | Count |
|---|---|---|---|---|
| 1 | 1 | `vat_law` | Federal Decree-Law No. 8/2017, Tax Procedures Law | 2 |
| 2 | 2 | `executive_regulation`, `cabinet_decision` | Cabinet Decision 52/2017 (Exec Reg), CD 127/2024 (Precious Metals), CD 153/2025 (Scrap) | ~8 |
| 3 | 3 | `public_clarification` | VATP001–VATP044 series | ~15 |
| 4 | 4 | `fta_guide` | General Guide, Real Estate Guide, Designated Zones, Healthcare, Financial, Input Tax, Registration | ~9 |
| 5 | 5 | `third_party` | PwC, Dhruva, CLA analysis (reference only) | ~2 |

---

*This document was generated from full codebase analysis of the UAE VAT Guide AI project. All technical details reflect the actual implementation in `src/lib/`, `scripts/`, and the Supabase schema.*
