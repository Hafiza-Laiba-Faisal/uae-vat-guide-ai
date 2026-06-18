"""
Bulk PDF Ingest — UAE VAT Knowledge Base
=========================================
Reads PDFs from downloads folder using pdfminer.six,
chunks text, embeds with Mistral, inserts into Supabase.

Usage:
  python3 scripts/bulk-ingest-pdfs.py
  python3 scripts/bulk-ingest-pdfs.py --dry-run
  python3 scripts/bulk-ingest-pdfs.py --file 01-vat-law-decree-8-2017.pdf

  # Or directly via venv (recommended):
  "Website Documents Scraper/.venv-linux/bin/python" scripts/bulk-ingest-pdfs.py
"""
import sys, json, re, time, hashlib, argparse
from pathlib import Path
from io import StringIO

ROOT = Path(__file__).parent.parent
VENV_SITE_PACKAGES = ROOT / "Website Documents Scraper" / ".venv-linux" / "lib" / "python3.12" / "site-packages"

# ── Inject venv site-packages into path if pdfminer not already importable ────
try:
    import pdfminer  # noqa: F401 — just a check
except ImportError:
    if VENV_SITE_PACKAGES.exists():
        sys.path.insert(0, str(VENV_SITE_PACKAGES))

try:
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams
    import requests
except ImportError as e:
    print(f"ERROR: Missing dependency — {e}")
    print(f"Install via: pip install pdfminer.six requests  (or use the project venv)")
    sys.exit(1)

# ── Config ─────────────────────────────────────────────────────────────────────

DOWNLOADS_DIR = ROOT / "Website Documents Scraper" / "downloads"
MANIFEST_PATH = DOWNLOADS_DIR / "manifest.json"

# Load env
ENV = {}
env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        m = re.match(r'^([^#=\s]+)\s*=\s*["\']?([^"\']+)["\']?\s*$', line)
        if m:
            ENV[m.group(1)] = m.group(2).strip()

SUPABASE_URL = ENV.get("SUPABASE_URL", "")
SUPABASE_KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")
MISTRAL_KEY = ENV.get("MISTRAL_API_KEY", "")

# ── Deduplicated file list (primary files only, no duplicates) ─────────────────
# law-XXXX-en.pdf are duplicates of 01-/02-/etc. series — skip them
# Use the numbered series as primary

SKIP_DUPLICATES = {
    "law-1227-en.pdf",   # = 01-vat-law-decree-8-2017.pdf
    "law-1226-en.pdf",   # = 02b-exec-reg-cab-52-2017-leg.pdf
    "law-1625-en.pdf",   # = 02c-tax-procedures-1625.pdf
    "law-3860-en.pdf",   # = 02d-cab-3860-scrap-metal.pdf
    "law-1230-en.pdf",   # = 02e-cab-1230-tourist-refund.pdf
    "law-1229-en.pdf",   # = 02f-cab-1229-exhibitions.pdf
    # Profit Margin duplicate
    "Profit Margin-Scheme-EN-02-01-2026-re.pdf",  # = 13-profit-margin-scheme-2026.pdf
    # VAT Admin exceptions duplicate
    "VAT Administrative Exceptions Guide - EN - 05 12 2025.pdf",  # = 14-vat-admin-exceptions-guide-2025.pdf
    # VAT Refund nationals duplicates
    "VAT Refund for UAE Nationals Building New Residences - EN - 09 06 2026.pdf",  # = 15-
}

def extract_pdf_text(pdf_path: Path) -> str:
    output = StringIO()
    try:
        with open(pdf_path, "rb") as f:
            extract_text_to_fp(f, output, laparams=LAParams(
                line_margin=0.5,
                word_margin=0.1,
                char_margin=2.0,
            ))
        text = output.getvalue()
        # Clean up
        text = re.sub(r'\x0c', '\n\n', text)          # form feed → paragraph break
        text = re.sub(r'[ \t]+', ' ', text)            # collapse spaces
        text = re.sub(r'\n{3,}', '\n\n', text)         # max 2 newlines
        text = re.sub(r'(?<!\n)\n(?!\n)', ' ', text)   # join broken lines
        return text.strip()
    except Exception as e:
        return ""

# ── Chunker ────────────────────────────────────────────────────────────────────

def detect_section(text: str) -> str | None:
    first = text.split("\n", 1)[0].strip()
    if re.match(r'^(article|section|chapter|clause|part|annex|vatp\s*\d+|cabinet decision|federal decree|executive regulation)', first, re.I):
        return first[:160]
    return None

def chunk_text(text: str, max_chars=3500, overlap=500) -> list[dict]:
    paragraphs = [p.strip() for p in re.split(r'\n{2,}', text) if p.strip()]
    chunks = []
    buffer = ""

    def flush():
        nonlocal buffer
        content = buffer.strip()
        if not content:
            return
        chunks.append({
            "index": len(chunks),
            "content": content,
            "section": detect_section(content),
        })
        buffer = content[-overlap:] if overlap > 0 else ""

    for para in paragraphs:
        if len(para) > max_chars:
            if buffer.strip():
                flush()
            buffer = ""
            cursor = 0
            while cursor < len(para):
                buffer = para[cursor:cursor + max_chars]
                flush()
                cursor += max(1, max_chars - overlap)
            continue

        candidate = (buffer + "\n\n" + para) if buffer else para
        if len(candidate) > max_chars:
            flush()
            buffer = para
        else:
            buffer = candidate

    if buffer.strip():
        chunks.append({
            "index": len(chunks),
            "content": buffer.strip(),
            "section": detect_section(buffer),
        })

    return chunks

def content_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()

# ── Embeddings (Mistral API) ───────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> list[list[float]]:
    """Call Mistral embeddings API directly."""
    url = "https://api.mistral.ai/v1/embeddings"
    headers = {
        "Authorization": f"Bearer {MISTRAL_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"model": "mistral-embed", "input": texts}
    r = requests.post(url, json=payload, headers=headers, timeout=60)
    if not r.ok:
        raise Exception(f"Mistral embed failed: {r.status_code} {r.text[:200]}")
    data = r.json()
    return [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]

# ── Supabase client ────────────────────────────────────────────────────────────

def supabase_post(path: str, payload: dict) -> dict:
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{path}",
        json=payload,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        timeout=30,
    )
    if not r.ok:
        raise Exception(f"Supabase POST {path} failed: {r.status_code} {r.text[:300]}")
    return r.json()

def supabase_patch(path: str, payload: dict, match: dict) -> None:
    params = "&".join(f"{k}=eq.{v}" for k, v in match.items())
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}?{params}",
        json=payload,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    if not r.ok:
        raise Exception(f"Supabase PATCH {path} failed: {r.status_code} {r.text[:300]}")

def supabase_delete(path: str, match: dict) -> None:
    params = "&".join(f"{k}=eq.{v}" for k, v in match.items())
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/{path}?{params}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
        timeout=30,
    )
    if not r.ok:
        raise Exception(f"Supabase DELETE {path} failed: {r.status_code} {r.text[:300]}")

def supabase_get(path: str, params: str = "") -> list:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{path}?{params}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
        timeout=30,
    )
    if not r.ok:
        raise Exception(f"Supabase GET {path} failed: {r.status_code}")
    return r.json()

# ── Ingest one PDF ─────────────────────────────────────────────────────────────

def infer_metadata(filename: str, title: str) -> dict:
    """Auto-infer document metadata from filename + title patterns.
    Called for every new document so LLM always has source authority + currency."""
    fn = filename.lower()
    ti = title.lower()
    meta = {"doc_type": "fta_guide", "priority": 6, "legal_rank": 4,
            "authority": "Federal Tax Authority", "effective_date": None,
            "version": None, "covers": None}

    if "decree-law" in ti or "decree law" in ti:
        meta.update({"doc_type": "vat_law", "priority": 10, "legal_rank": 1,
                     "authority": "UAE Federal Government"})
        if "vat" in ti or "value added" in ti:
            meta["covers"] = "UAE VAT core legislation"
        if "tax procedure" in ti:
            meta["covers"] = "Tax procedures — registration, audits, disputes, penalties"
        m = re.search(r"(20\d{2})", title)
        if m: meta["effective_date"] = f"{m.group()}-01-01"

    elif "cabinet" in ti or "executive reg" in ti:
        meta.update({"priority": 10, "legal_rank": 2, "authority": "UAE Cabinet",
                     "doc_type": "executive_regulation" if "executive reg" in ti else "cabinet_decision"})
        if "designated zone" in ti: meta["covers"] = "Official UAE Designated Zones list"
        elif "executive reg" in ti: meta["covers"] = "Detailed implementing rules for UAE VAT Law"
        elif "precious metal" in ti: meta["covers"] = "RCM for precious metals"
        elif "scrap" in ti: meta["covers"] = "RCM for scrap metal"
        elif "tourist" in ti: meta["covers"] = "VAT refund system for tourists"
        elif "exhibition" in ti: meta["covers"] = "VAT refund for exhibitions and conferences"
        m = re.search(r"(20\d{2})", title)
        if m: meta["effective_date"] = f"{m.group()}-01-01"

    elif "vatp" in fn or "vatp" in ti or "clarification" in ti:
        meta.update({"doc_type": "public_clarification", "priority": 9, "legal_rank": 3})
        vm = re.search(r"vatp\s*0*(\d+)", ti, re.I)
        if vm: meta["version"] = f"VATP{vm.group(1).zfill(3)}"
        ym = re.search(r"(20\d{2})", fn)
        if ym: meta["effective_date"] = f"{ym.group()}-01-01"

    elif "guide" in ti or "vatg" in fn:
        meta.update({"doc_type": "fta_guide", "priority": 9, "legal_rank": 4})
        gm = re.search(r"(vatg[a-z]+\d*)", fn, re.I)
        if gm: meta["version"] = gm.group(1).upper()
        ym = re.search(r"(20\d{2})", title)
        if ym: meta["effective_date"] = f"{ym.group()}-01-01"
        for kw, cov in [("real estate", "VAT on real estate"), ("designated zone", "VAT in Designated Zones"),
                        ("input tax", "Input tax apportionment"), ("healthcare", "VAT on healthcare"),
                        ("insurance", "VAT on insurance"), ("financial", "VAT on financial services"),
                        ("e-commerce", "VAT on e-commerce"), ("automotive", "VAT in automotive sector"),
                        ("registration", "VAT registration"), ("profit margin", "Profit Margin Scheme"),
                        ("invoice", "Tax invoices"), ("exception", "VAT administrative exceptions"),
                        ("refund", "VAT refund process")]:
            if kw in ti: meta["covers"] = cov; break

    return meta


def ingest_pdf(file_meta: dict, dry_run: bool = False) -> dict:
    filename = file_meta["filename"]
    title = file_meta["title"]
    source_url = f"pdf://{filename}"

    # Merge manifest metadata with auto-inferred metadata
    auto = infer_metadata(filename, title)
    doc_type = file_meta.get("type") or auto["doc_type"]
    priority = file_meta.get("priority") or auto["priority"]
    legal_rank = auto["legal_rank"]
    authority = auto["authority"]
    effective_date = auto["effective_date"]
    version = auto["version"]
    covers = auto["covers"]

    pdf_path = DOWNLOADS_DIR / filename
    if not pdf_path.exists():
        return {"status": "failed", "error": f"File not found: {filename}"}

    text = extract_pdf_text(pdf_path)
    if len(text) < 200:
        return {"status": "failed", "error": f"Too short ({len(text)} chars) — possibly scanned/image PDF"}

    hash_val = content_hash(text)

    if dry_run:
        chunks = chunk_text(text)
        return {"status": "dry_run", "chars": len(text), "chunks": len(chunks)}

    existing = supabase_get("fta_documents", f"source_url=eq.{source_url}&select=id,content_hash")
    if existing and existing[0].get("content_hash") == hash_val:
        return {"status": "unchanged"}

    chunks = chunk_text(text)
    if not chunks:
        return {"status": "failed", "error": "No chunks produced"}

    # Build document record with full metadata
    doc_record = {
        "title": title, "content_hash": hash_val,
        "chunk_count": len(chunks), "source_kind": "pdf",
        "doc_type": doc_type, "priority": priority,
        "legal_rank": legal_rank, "authority": authority,
    }
    if effective_date: doc_record["effective_date"] = effective_date
    if version: doc_record["version"] = version
    if covers: doc_record["covers"] = covers

    if existing:
        doc_id = existing[0]["id"]
        supabase_delete("fta_chunks", {"document_id": doc_id})
        supabase_patch("fta_documents", doc_record, {"id": doc_id})
    else:
        doc_record["source_url"] = source_url
        result = supabase_post("fta_documents", doc_record)
        doc_id = result[0]["id"]

    # Embed in batches of 16
    batch_size = 16
    all_embeddings = []
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        embs = embed_texts([c["content"] for c in batch])
        all_embeddings.extend(embs)
        if i + batch_size < len(chunks):
            time.sleep(0.5)  # rate limit

    # Insert chunks
    rows = [
        {
            "document_id": doc_id,
            "chunk_index": c["index"],
            "content": c["content"],
            "section": c["section"],
            "embedding": emb,
        }
        for c, emb in zip(chunks, all_embeddings)
    ]
    # Insert in batches of 50
    for i in range(0, len(rows), 50):
        supabase_post("fta_chunks", rows[i:i + 50])

    return {"status": "indexed", "chunks": len(chunks), "chars": len(text)}

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--file", help="Ingest single file by filename")
    parser.add_argument("--skip-tier5", action="store_true", help="Skip third_party documents")
    args = parser.parse_args()

    if not MISTRAL_KEY:
        print("ERROR: MISTRAL_API_KEY not set in .env")
        sys.exit(1)

    manifest = json.loads(MANIFEST_PATH.read_text())
    files = manifest["files"]

    # Filter
    if args.file:
        files = [f for f in files if f["filename"] == args.file]
        if not files:
            print(f"File not found in manifest: {args.file}")
            sys.exit(1)
    else:
        # Skip duplicates
        files = [f for f in files if f["filename"] not in SKIP_DUPLICATES]
        if args.skip_tier5:
            files = [f for f in files if f["type"] != "third_party"]

    # Sort by priority descending
    files.sort(key=lambda f: -f["priority"])

    print(f"\nUAE VAT Bulk PDF Ingest")
    print(f"=======================")
    print(f"Files to process: {len(files)}")
    print(f"Dry run: {args.dry_run}\n")

    # Group by priority for display
    for tier, label in [(10, "TIER 1 — Core Laws"), (9, "TIER 2 — FTA Guides & Clarifications"),
                        (8, "TIER 3 — Official References"), (7, "TIER 4 — Other Official"),
                        (6, "TIER 5 — Third Party")]:
        tier_files = [f for f in files if f["priority"] == tier]
        if tier_files:
            print(f"  {label}: {len(tier_files)} files")

    print()

    summary = {"indexed": 0, "unchanged": 0, "failed": 0, "dry_run": 0}
    manifest_updated = False

    for i, f in enumerate(files):
        print(f"[{i+1}/{len(files)}] P{f['priority']} | {f['title'][:55]}")
        try:
            result = ingest_pdf(f, dry_run=args.dry_run)
            status = result["status"]
            summary[status] = summary.get(status, 0) + 1

            if status == "indexed":
                print(f"  ✅ indexed — {result['chunks']} chunks ({result['chars']:,} chars)")
                # Update manifest
                for mf in manifest["files"]:
                    if mf["filename"] == f["filename"]:
                        mf["indexed"] = True
                        manifest_updated = True
            elif status == "unchanged":
                print(f"  ⏭  unchanged")
            elif status == "dry_run":
                print(f"  🔍 dry-run — {result['chunks']} chunks ({result['chars']:,} chars)")
            elif status == "failed":
                print(f"  ❌ failed — {result['error']}")

        except Exception as e:
            print(f"  ❌ exception — {e}")
            summary["failed"] = summary.get("failed", 0) + 1

        # Small delay between files to avoid rate limits
        if i < len(files) - 1:
            time.sleep(1)

    # Save updated manifest
    if manifest_updated and not args.dry_run:
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
        print("\nManifest updated.")

    print(f"\n{'='*40}")
    print(f"Indexed:   {summary.get('indexed', 0)}")
    print(f"Unchanged: {summary.get('unchanged', 0)}")
    print(f"Failed:    {summary.get('failed', 0)}")
    if args.dry_run:
        print(f"Dry-run:   {summary.get('dry_run', 0)}")
    print(f"\nDone!")

if __name__ == "__main__":
    main()
