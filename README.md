# UAE VAT Guide AI

> AI-powered UAE VAT guidance assistant grounded exclusively in official FTA documentation.

An intelligent chat assistant that answers UAE VAT questions with strict legal source ranking, citation validation, and automatic response depth detection — concise for simple questions, full expert analysis when legal basis is requested.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, MISTRAL_API_KEY

# 3. Run Supabase migrations (see ARCHITECTURE.md)

# 4. Ingest documents
python3 scripts/bulk-ingest-pdfs.py --dry-run   # preview
python3 scripts/bulk-ingest-pdfs.py             # ingest all

# 5. Start dev server
npm run dev
```

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TanStack Start, TanStack Router |
| Styling | Tailwind CSS v4, shadcn/ui (Radix) |
| AI / LLM | Mistral (mistral-large / mistral-small) via AI SDK |
| Embeddings | `mistral-embed` — 1024-dimensional vectors |
| Database | Supabase — PostgreSQL + pgvector extension |
| Build | Vite 7, Nitro (Cloudflare target) |
| Scraping | Python — pdfminer.six, Playwright, cloudscraper |

---

## Project Structure

```
src/
  lib/
    rag.server.ts            # Query embedding + vector search
    rag-prompt.ts            # Prompt builder, depth detection, legal hierarchy
    embeddings.server.ts     # Mistral embed wrapper
    ai-gateway.server.ts     # LLM call handler (streaming)
    fta-updater.server.ts    # FTA document refresh via Firecrawl
    document-catalog.ts      # Static document catalog
    vat-rules.ts             # UAE VAT rule constants + intent detection
    admin.functions.ts       # Admin panel server functions
    chunker.ts               # Text chunking utilities
  routes/
    index.tsx                # Chat UI
    api/chat.ts              # Streaming chat API route
    _authenticated.admin.tsx # Admin panel

scripts/
  bulk-ingest-pdfs.py        # PDF → chunk → embed → Supabase pipeline
  update-metadata.sql        # Metadata patch for all indexed documents
  scrape-sources.py          # FTA website scraper (dual-layer)
  run-scraper.mjs            # Scraper runner + Supabase ingest
  requirements.txt           # Python dependencies

Website Documents Scraper/
  Scraper.py                 # Playwright-based document scraper
  Browser RPA Bot.py         # RPA bot for document downloads
  download-official.mjs      # Official document downloader
```

---

## Documents Indexed

36 official documents across 5 legal tiers:

| Tier | Type | Count |
|---|---|---|
| 1 | UAE VAT Law + Tax Procedures Law | 3 |
| 2 | Cabinet Decisions + Executive Regulations | 6 |
| 3 | FTA Public Clarifications (VATP series) | 5 |
| 4 | FTA Guides (designated zones, real estate, financial, etc.) | 18 |
| 5 | Third-party reference (PwC, Dhruva, CLA) | 4 |

---

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data flow, database schema
- [FEATURES.md](FEATURES.md) — complete feature list
- [ROADMAP.md](ROADMAP.md) — planned improvements
