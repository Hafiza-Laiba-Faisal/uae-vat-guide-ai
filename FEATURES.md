# Features

## Core Chat

### Response Depth Detection
Automatically switches between two modes based on the user's query:

- **Concise Mode** (default) — plain language answer under 150 words, no legal jargon, no source ranks shown. For everyday questions like "is food zero-rated?" or "what is the VAT registration threshold?"
- **Expert Mode** — full legal analysis with citation validation, legal hierarchy enforcement, and structured output. Triggered when user asks for article numbers, legal basis, citations, which rule prevails, hypotheticals, or detailed reasoning.

### Legal Hierarchy Enforcement
Every answer respects a strict 5-rank source hierarchy:
- Rank 1–2 (binding law) is always stated first and labeled as such
- Rank 3–4 (FTA guidance) is labeled non-binding
- Rank 5 (third-party) is labeled reference only
- LLM is forbidden from presenting Rank 3–4 as legally binding

### Citation Validation Gate
Only citations corresponding to actually retrieved document chunks are allowed. The LLM cannot invent article numbers or reference documents not in the retrieved set.

### Confidence Scoring
Four confidence states — `high`, `moderate`, `ambiguous`, `conflict` — each with specific LLM instructions:
- Ambiguous: no binding law retrieved, LLM must not force a legal conclusion
- Conflict: Rank 1–2 and Rank 3–4 sources present and divergent, LLM states both positions separately

### Fallback Handling
When no relevant chunks pass the similarity threshold (0.65), the LLM is forced to emit exactly:
> "I could not find this in current FTA guidance — please verify at https://tax.gov.ae or consult a qualified UAE VAT consultant."

No hallucination, no training-knowledge gap-filling.

### Bilingual Support
- Detects user input language (Arabic or English)
- Replies fully in the detected language
- No language mixing within a single response

---

## RAG Pipeline

### Vector Search with Priority Boost
`match_fta_chunks()` Supabase RPC combines cosine similarity with a document priority multiplier (`priority × 0.009`). This ensures higher-tier legal documents rank above lower-tier ones at equal semantic similarity.

### Document Currency Awareness
Each chunk carries metadata: `effective_date`, `version`, `covers`, `authority`. The prompt builder:
- Shows these fields inline with each excerpt
- Detects when both old and new versions of a document are retrieved
- Adds a currency warning to the LLM when mixed-version sources are present
- Lowers confidence when superseded documents are in the retrieved set

### Intent Detection
Before RAG retrieval, `detectIntent()` classifies the query:
- Out-of-scope queries (KSA VAT, corporate tax, personal finance) are short-circuited with a polite decline — no embedding or retrieval cost
- Deterministic VAT rules (registration threshold, standard rate, etc.) are answered from a rule engine, with RAG used for supporting context

### Similarity Threshold Filtering
Chunks below 0.65 similarity are dropped before prompt construction. Top 5 chunks are used by default.

---

## Document Knowledge Base

### 36 Official Documents
Covering the full UAE VAT legal framework:
- UAE VAT Law (FDL No. 8/2017) including all amendments through 2026
- Tax Procedures Law (FDL No. 28/2022)
- Executive Regulations (Cabinet Decision 52/2017, amended)
- 6 Cabinet Decisions (designated zones, tourist refund, RCM for metals/scrap)
- 3 FTA Public Clarifications (VATP001, VATP015, VATP031)
- 2 batches of FTA Private Clarifications (Nov 2024, Jul 2025)
- 13 FTA Guides (real estate, designated zones, input tax, e-commerce, automotive, insurance, financial services, healthcare, registration, refunds, invoices, profit margin, admin exceptions)
- 4 third-party reference documents (PwC, Dhruva, CLA)

### Auto-Metadata Inference
`infer_metadata()` in `bulk-ingest-pdfs.py` automatically sets `doc_type`, `priority`, `legal_rank`, `authority`, `effective_date`, `version`, and `covers` from filename and title patterns — no manual metadata entry needed for new documents.

### Content Hash Change Detection
On re-ingest, document content is hashed (MD5). If the hash matches the stored value, the document is skipped as `unchanged`. Changed documents have their chunks deleted and re-embedded automatically.

---

## Ingestion & Scraping

### Bulk PDF Ingestion
`bulk-ingest-pdfs.py` handles the full pipeline:
- PDF text extraction via pdfminer.six
- Text chunking (3500 char max, 500 char overlap, paragraph-aware)
- Section heading detection
- Mistral embed API (batches of 16, rate-limited)
- Supabase upsert (chunks in batches of 50)
- Duplicate detection via SKIP_DUPLICATES set
- `--dry-run` mode for previewing without inserting
- `--file` flag for single-document ingestion
- Auto-injects project venv site-packages — works with plain `python3`

### Dual-Layer Web Scraping
`scrape-sources.py` implements a two-layer approach for live FTA sources:
- **Layer 1**: Landing page → amendment notices, metadata, related law links
- **Layer 2**: PDF → full legal text (always wins for legal content)

### Auto-Discovery
- Related Cabinet Decisions auto-discovered from the UAE Legislation Portal
- New FTA guides and VATP clarifications auto-discovered from the FTA guides listing page
- Known documents are de-duplicated against the primary sources list

### Admin Panel Refresh
`fta-updater.server.ts` provides server-side document refresh triggered from the admin UI:
- Supports `firecrawl` mode (HTML scraping via Firecrawl API) and `direct` mode (fetch + pdfjs)
- Processes primary sources, then auto-discovers related Cabinet Decisions and new FTA PDFs
- Custom URL ingestion for ad-hoc document additions

---

## Developer Experience

### Test Suite
24 tests across 3 test files:
- `rag-prompt.test.ts` — prompt structure, confidence modes, citation validation, expert/concise mode switching
- `citation-accuracy.test.ts` — citation contract, confidence thresholds, fallback enforcement
- `chunker.test.ts` — text chunking logic

### Type Safety
Full TypeScript throughout. `RetrievedChunk` interface carries all metadata fields. No `any` in hot paths.

### Disclaimer
Every substantive answer ends with:
> "This is general guidance only, not legal or tax advice. Always verify at tax.gov.ae or consult a qualified UAE VAT consultant for your specific circumstances."
