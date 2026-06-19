# Architecture

## Overview

UAE VAT Guide AI is a Retrieval-Augmented Generation (RAG) system. User queries are embedded, matched against a vector store of official FTA documents, and a structured system prompt is built around the retrieved chunks before being sent to the LLM.

---

## Request Flow

```
User message
     │
     ▼
api/chat.ts  (TanStack Start streaming route)
     │
     ├─► detectIntent()          vat-rules.ts
     │       │ out_of_scope? ──► short-circuit → LLM directly
     │
     ├─► embedOne(query)         embeddings.server.ts → mistral-embed API
     │
     ├─► match_fta_chunks()      Supabase RPC (cosine similarity + priority boost)
     │       │
     │       └─► fta_chunks JOIN fta_documents
     │
     ├─► filterChunks()          similarity threshold 0.65, top 5
     │
     ├─► isExpertQuery(query)    rag-prompt.ts — regex trigger detection
     │       │
     │       ├─ concise mode  → plain language, <150 words, no ranks shown
     │       └─ expert mode   → full legal hierarchy, citation validation
     │
     ├─► buildRagSystemPrompt()  rag-prompt.ts
     │
     └─► streamText()            ai-gateway.server.ts → Mistral LLM
              │
              ▼
         Streaming response to browser
```

---

## Response Depth Detection

Two modes determined by `isExpertQuery(userQuery)`:

**Concise Mode** (default) — triggered for simple questions:
- Plain language answer, max 150 words
- No document ranks, legal hierarchy, or internal reasoning shown
- Natural inline references only

**Expert Mode** — triggered when user asks for:
- Article numbers, legal basis, citations, sources
- "which rule prevails", "what if", hypotheticals
- Federal Decree, Cabinet Decision, VATP references
- Detailed reasoning or proof

---

## Legal Hierarchy

Every retrieved chunk is tagged with a rank. The LLM is instructed to never present lower-rank sources as legally binding.

| Rank | Source Type | Binding? | Language used |
|---|---|---|---|
| 1 | Federal Decree-Law (VAT Law, Tax Procedures) | Yes | "the law requires" / "under Article X" |
| 2 | Cabinet Decisions, Executive Regulations | Yes | "Cabinet Decision X provides" |
| 3 | FTA Public Clarifications (VATP series) | No — audit position only | "FTA's position in VATP-X is" |
| 4 | FTA Guides (VATGDZ1, VATGRE1, etc.) | No — explanatory only | "FTA guidance in [Guide] suggests" |
| 5 | Third-party analysis (PwC, Dhruva, CLA) | No — reference only | "per third-party analysis" |

---

## Database Schema

### `fta_documents`

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| title | text | Document title |
| source_url | text | Unique identifier (pdf://filename or https://) |
| source_kind | text | `pdf`, `firecrawl`, `landing_page` |
| doc_type | text | `vat_law`, `executive_regulation`, `cabinet_decision`, `public_clarification`, `fta_guide` |
| priority | integer | 6–10, used in similarity boost |
| legal_rank | integer | 1–5, legal hierarchy rank |
| authority | text | Issuing authority |
| effective_date | date | When this document took effect |
| version | text | Version label (e.g. VATGDZ1, VATP031, Jun 2026) |
| covers | text | One-line description of what this document covers |
| content_hash | text | MD5 of full text — used for change detection |
| chunk_count | integer | Number of chunks stored |

### `fta_chunks`

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| document_id | uuid | FK → fta_documents |
| chunk_index | integer | Position within document |
| section | text | Detected section heading |
| content | text | Chunk text (≤3500 chars) |
| embedding | vector(1024) | Mistral embed vector |

### `match_fta_chunks()` RPC

```sql
CREATE OR REPLACE FUNCTION match_fta_chunks(
  query_embedding vector(1024),
  match_count     int     DEFAULT 5,
  similarity_threshold float DEFAULT 0.4
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

The `priority * 0.009` term ensures higher-tier legal documents rank above lower-tier ones at equal semantic similarity.

---

## Ingestion Pipeline

```
PDF files (36 docs)
     │
     ▼
bulk-ingest-pdfs.py
     ├─ extract_pdf_text()     pdfminer.six
     ├─ chunk_text()           3500 char chunks, 500 char overlap
     ├─ infer_metadata()       auto-detects doc_type, priority, legal_rank,
     │                         authority, effective_date, version, covers
     │                         from filename + title patterns
     ├─ embed_texts()          Mistral mistral-embed API (batches of 16)
     └─ supabase_post()        INSERT fta_documents + fta_chunks
```

Auto-metadata inference handles:
- `decree-law` / `federal decree` → Rank 1, binding legislation
- `cabinet` / `executive reg` → Rank 2, binding regulation
- `vatp` / `clarification` → Rank 3, FTA administrative interpretation
- `guide` / `vatg` → Rank 4, FTA explanatory guide

---

## Web Scraping (Live Updates)

`scrape-sources.py` + `run-scraper.mjs` implement a dual-layer scraping approach:

- **Layer 1 — Landing page**: structured metadata, amendment notices, related law links
- **Layer 2 — PDF text**: full legal content (primary source, always wins for legal text)

`fta-updater.server.ts` provides a server-side refresh function triggered from the admin panel using Firecrawl API for HTML pages and direct PDF parsing for documents.

---

## Confidence Scoring

`assessConfidence()` determines the answer confidence state:

| State | Condition | LLM instruction |
|---|---|---|
| `high` | Top chunk similarity ≥ 0.75, Rank 1–2 present | Answer with full confidence |
| `moderate` | Similarity < 0.75 or superseded docs present | Cautious tone, use fallback if unclear |
| `ambiguous` | No Rank 1–2 chunks — only guides/clarifications | Do not force legal conclusion |
| `conflict` | Both binding law + interpretive sources, similarity < 0.75 | State both positions, declare divergence |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key (client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-only) |
| `MISTRAL_API_KEY` | Yes | Mistral AI API key |
| `FIRECRAWL_API_KEY` | No | Firecrawl API key (enables live web scraping) |
