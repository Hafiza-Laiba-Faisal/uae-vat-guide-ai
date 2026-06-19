# Roadmap

Items are grouped by priority. No fixed release dates.

---

## High Priority

### Scheduled Document Refresh
Automate the ingestion pipeline so new FTA publications are picked up without manual intervention.

Options under consideration:
- **GitHub Actions** — weekly cron job (`on: schedule`) that runs `bulk-ingest-pdfs.py` and commits updated manifest
- **Supabase pg_cron** — database-level weekly job calling `refreshFtaFromFirecrawl()`
- **Cloudflare Cron Triggers** — `scheduled()` handler in the Nitro/Cloudflare Workers deployment

### Architecture Diagram in README
Visual diagram (PNG/SVG) showing the full request flow, ingestion pipeline, and component relationships. Currently documented in text form in ARCHITECTURE.md.

### `.env.example` File
Committed example environment file listing all required and optional variables with descriptions, so new contributors can set up without reading the docs.

---

## Medium Priority

### Streaming Citation Sources UI
Surface the retrieved source documents in the chat UI alongside the streamed answer — show title, rank, effective date, and a link to the original document. Currently `sources` metadata is passed in the stream but not rendered.

### Multi-turn Context Awareness
The current system uses the last user message for embedding. Improve retrieval by summarising or extracting the core question from multi-turn conversations before embedding.

### Arabic Document Ingestion
The UAE VAT Law and Executive Regulations exist in Arabic. Ingest Arabic versions and route Arabic-language queries to Arabic chunks for better bilingual accuracy.

### Confidence Score in UI
Show a subtle confidence indicator in the chat interface (e.g. high / moderate / check sources) so users know when to verify externally.

### Admin Panel — Document Management
Extend the admin panel to:
- Show all indexed documents with their metadata
- Allow manual metadata edits (priority, effective_date, version, covers)
- Trigger single-document re-ingestion from the UI
- Show chunk counts, last indexed date, content hash

---

## Lower Priority

### Private Ruling Request Helper
Guide users through the FTA private ruling application process with a structured form — pre-filling standard sections based on the chat conversation context.

### VAT Return Calculator
Deterministic tool for common VAT calculations — output tax, input tax recovery, apportionment ratio. No LLM involved, pure rule engine.

### Webhook for FTA Website Changes
Monitor the FTA guides listing page (`tax.gov.ae/en/taxes/vat/guides.references.aspx`) for new PDF links and trigger automatic ingestion when a new document appears.

### User Feedback Loop
Thumbs up/down on answers to build a quality dataset. Flag incorrect citations. Feed signal back into prompt tuning or retrieval threshold adjustment.

### Evaluation Harness
Automated RAG evaluation against a golden dataset of UAE VAT questions with known correct answers and expected citations. Track precision, recall, and citation accuracy across prompt changes.

### Hybrid Search
Combine pgvector cosine similarity with BM25 keyword search (PostgreSQL full-text search). Hybrid scoring often improves retrieval for queries containing specific article numbers or legal terms.

---

## Known Limitations

- **No scheduled scraping** — documents must be manually re-ingested when FTA publishes updates
- **No streaming citations UI** — source documents are not shown in the chat interface
- **Image-only PDFs** — some older FTA documents are scanned images; pdfminer.six cannot extract text from them
- **Single-query retrieval** — multi-turn conversations use only the last message for embedding, which can miss context from earlier turns
- **No Arabic chunk retrieval** — Arabic queries are answered from English document chunks
