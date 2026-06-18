# UAE VAT Guide AI

An AI-powered UAE VAT guidance assistant grounded exclusively in official FTA documentation. Answers questions about UAE VAT law with strict source ranking, citation validation, and legal hierarchy enforcement.

---

## What it does

- Embeds user queries and retrieves relevant chunks from an FTA document knowledge base (Supabase + pgvector)
- Ranks sources by legal authority — binding legislation first, interpretive guides last
- Builds a structured RAG prompt that forces the LLM to separate law from interpretation
- Warns when retrieved sources are outdated or superseded
- Falls back gracefully when no relevant source is found

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TanStack Start, TanStack Router |
| Styling | Tailwind CSS v4, shadcn/ui (Radix) |
| AI / LLM | Mistral (via AI SDK) |
| Embeddings | `mistral-embed` (1024-dim) |
| Database | Supabase (PostgreSQL + pgvector) |
| Build | Vite 7, Nitro (Cloudflare target) |

---

## Project structure

```
src/
  lib/
    rag.server.ts          # Query embedding + Supabase vector search
    rag-prompt.ts          # RAG prompt builder, legal hierarchy, confidence scoring
    embeddings.server.ts   # Mistral embed wrapper
    ai-gateway.server.ts   # LLM call handler
    fta-updater.server.ts  # FTA document update checker
    document-catalog.ts    # Static document catalog
    vat-rules.ts           # UAE VAT rule constants
    admin.functions.ts     # Admin panel server functions
  routes/
    index.tsx              # Chat UI
    api/chat.ts            # Streaming chat API route
    _authenticated.admin.tsx  # Admin panel

scripts/
  bulk-ingest-pdfs.py      # PDF → chunk → embed → Supabase pipeline
  update-metadata.sql      # One-time metadata patch for all indexed documents
  scrape-sources.py        # FTA website scraper
  requirements.txt         # Python dependencies

Website Documents Scraper/
  Scraper.py               # Playwright-based document scraper
  Browser RPA Bot.py       # RPA bot for document downloads
  download-official.mjs    # Official document downloader
```

---

## Setup

### 1. Install JS dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MISTRAL_API_KEY=
```

### 3. Supabase — run migrations

In your Supabase SQL editor, create the tables and the `match_fta_chunks` function:

```sql
-- Enable pgvector
create extension if not exists vector;

-- Documents table
create table fta_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_url text unique not null,
  source_kind text default 'pdf',
  doc_type text,
  priority integer default 6,
  legal_rank integer default 4,
  authority text,
  effective_date date,
  version text,
  covers text,
  content_hash text,
  chunk_count integer,
  created_at timestamptz default now()
);

-- Chunks table
create table fta_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references fta_documents(id) on delete cascade,
  chunk_index integer,
  section text,
  content text not null,
  embedding vector(1024),
  created_at timestamptz default now()
);

-- Vector search function
create or replace function match_fta_chunks(
  query_embedding vector(1024),
  match_count int default 5,
  similarity_threshold float default 0.4
)
returns table (
  chunk_id uuid, document_id uuid, title text, source_url text,
  section text, content text, similarity float,
  doc_type text, priority integer, legal_rank integer,
  effective_date date, version text, covers text, authority text
)
language sql stable as $$
  select
    c.id, c.document_id, d.title, d.source_url, c.section, c.content,
    (1 - (c.embedding <=> query_embedding)) + (d.priority * 0.009) as similarity,
    d.doc_type, d.priority, d.legal_rank,
    d.effective_date, d.version, d.covers, d.authority
  from fta_chunks c
  join fta_documents d on d.id = c.document_id
  where (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
  order by similarity desc
  limit match_count;
$$;
```

### 4. Ingest documents

Put PDFs in `Website Documents Scraper/downloads/` with a `manifest.json`, then:

```bash
# Dry run — check chunks without inserting
python3 scripts/bulk-ingest-pdfs.py --dry-run

# Ingest all documents
python3 scripts/bulk-ingest-pdfs.py

# Ingest a single file
python3 scripts/bulk-ingest-pdfs.py --file 01-vat-law-decree-8-2017.pdf
```

The script auto-infers `doc_type`, `priority`, `legal_rank`, `authority`, `effective_date`, `version`, and `covers` from the filename and title — no manual metadata entry needed.

After first ingest, run `scripts/update-metadata.sql` in Supabase SQL editor to apply precise metadata for all 32 documents.

### 5. Run dev server

```bash
npm run dev
```

### 6. Python dependencies (for scripts only)

```bash
pip install -r scripts/requirements.txt

# Or use the bundled venv
"Website Documents Scraper/.venv-linux/bin/python" scripts/bulk-ingest-pdfs.py
```

---

## Legal hierarchy

The RAG system enforces a strict 5-rank source hierarchy:

| Rank | Type | Example | Binding? |
|---|---|---|---|
| 1 | Federal Decree-Law | FDL No. 8/2017 (VAT Law) | ✅ Yes |
| 2 | Cabinet Decision / Executive Regulation | CD 52/2017 | ✅ Yes |
| 3 | FTA Public Clarification | VATP001, VATP031 | ❌ No (audit position) |
| 4 | FTA Guide | VATGDZ1, VATGRE1 | ❌ No (explanatory) |
| 5 | Third-party analysis | PwC, Dhruva, CLA | ❌ No (reference only) |

The LLM is instructed to never present Rank 3–4 sources as legally binding, and to declare conflicts explicitly rather than synthesising a merged answer.

---

## Document coverage

36 official documents covering:

- UAE VAT Law (FDL No. 8/2017) including all amendments up to 2026
- Executive Regulations (Cabinet Decision 52/2017)
- Tax Procedures Law (FDL No. 28/2022)
- Cabinet Decisions on Designated Zones, Tourist Refund, RCM (precious metals, scrap)
- FTA Guides: Real Estate, Designated Zones, Input Tax, E-Commerce, Automotive, Insurance, Financial Services, Healthcare, Registration, Refunds, Invoices, Profit Margin Scheme
- FTA Public Clarifications: VATP001, VATP015, VATP031, Private Clarifications (Nov 2024, Jul 2025)
