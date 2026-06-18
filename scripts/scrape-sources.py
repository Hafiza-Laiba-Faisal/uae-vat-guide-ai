"""
UAE VAT Source Scraper — Dual-Layer Ingestion Design
=====================================================
Layer 1: Landing page → structured metadata + change notices + links (context layer)
Layer 2: PDF download  → full legal text (primary law layer)

PDF always wins for legal text.
Landing page provides: amendments, update notices, versioning, related links.

Usage:
  python3 scripts/scrape-sources.py
  python3 scripts/scrape-sources.py --url https://uaelegislation.gov.ae/en/legislations/1227
  python3 scripts/scrape-sources.py --dry-run
"""
import sys
import json
import argparse
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

try:
    import cloudscraper
    from bs4 import BeautifulSoup
except ImportError:
    venv = Path(__file__).parent.parent / "Website Documents Scraper" / ".venv-linux" / "bin" / "python"
    print(json.dumps({"error": f"Missing deps. Run: {venv} -m pip install cloudscraper beautifulsoup4"}))
    sys.exit(1)


# ── Sources ────────────────────────────────────────────────────────────────────

SOURCES = [
    {
        "title": "Federal Decree-Law No. 8 of 2017 — UAE VAT Law",
        "landing_url": "https://uaelegislation.gov.ae/en/legislations/1227",
        "download_url": "https://uaelegislation.gov.ae/en/legislations/1227/download",
        "related_url": "https://uaelegislation.gov.ae/en/legislations/1227/related-legislations",
        "doc_type": "vat_law",
        "priority": 10,
        "source": "uaelegislation.gov.ae",
    },
    {
        "title": "FTA — VAT Guides & Public Clarifications",
        "landing_url": "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
        "download_url": None,
        "related_url": None,
        "doc_type": "fta_guide",
        "priority": 9,
        "source": "tax.gov.ae",
    },
    {
        "title": "FTA — VAT Legislation Library",
        "landing_url": "https://tax.gov.ae/en/legislation.aspx",
        "download_url": None,
        "related_url": None,
        "doc_type": "vat_law",
        "priority": 9,
        "source": "tax.gov.ae",
    },
    {
        "title": "Ministry of Finance — VAT Information",
        "landing_url": "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
        "download_url": None,
        "related_url": None,
        "doc_type": "fta_overview",
        "priority": 6,
        "source": "mof.gov.ae",
    },
]


# ── Landing page structured extractor ─────────────────────────────────────────

def extract_structured_landing(html: str, page_url: str) -> dict:
    """
    Extract clean structured content from a legislation landing page.
    Returns: { clean_text, metadata, links, pdf_links, amendment_notices }
    """
    soup = BeautifulSoup(html, "html.parser")

    # Remove noise
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer",
                     "iframe", "form", "[aria-hidden]"]):
        tag.decompose()
    for tag in soup.find_all(class_=re.compile(r"(breadcrumb|cookie|banner|social|share|widget)", re.I)):
        tag.decompose()

    # ── Extract metadata fields ────────────────────────────────────────────
    metadata = {}

    # Law number, issue date, effective date — look for dt/dd or labeled divs
    full_text = soup.get_text(separator="\n")
    lines = [l.strip() for l in full_text.splitlines() if l.strip()]

    # Issued/Effective/Official Gazette dates
    for i, line in enumerate(lines):
        lline = line.lower()
        if "issued date" in lline and i + 1 < len(lines):
            metadata["issued_date"] = lines[i + 1]
        elif "effective date" in lline and i + 1 < len(lines):
            metadata["effective_date"] = lines[i + 1]
        elif "official gazette" in lline and "date" in lline and i + 1 < len(lines):
            metadata["gazette_date"] = lines[i + 1]
        elif "legislation state" in lline and i + 1 < len(lines):
            metadata["state"] = lines[i + 1]
        elif "legislation amendments" in lline and i + 1 < len(lines):
            metadata["amendment_count"] = lines[i + 1]
        elif "last update" in lline:
            # Try to find date on same or next line
            date_match = re.search(r"\d{2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}", line)
            if date_match:
                metadata["last_updated"] = date_match.group()
            elif i + 1 < len(lines):
                metadata["last_updated"] = lines[i + 1]

    # ── Extract amendment notices ──────────────────────────────────────────
    amendment_notices = []
    amendment_patterns = [
        r"amended by .{5,100}",
        r"supersedes .{5,100}",
        r"Federal Decree.{0,5}Law No\.\s*\(\d+\)\s*of\s*\d{4}",
        r"Cabinet (Decision|Resolution) No\.\s*\(\d+\)\s*of\s*\d{4}",
    ]
    for line in lines:
        for pattern in amendment_patterns:
            if re.search(pattern, line, re.I):
                if line not in amendment_notices and len(line) < 300:
                    amendment_notices.append(line)
                break

    # ── Extract useful content sections ───────────────────────────────────
    # Keep only lines that look like legal/contextual content
    KEEP_PATTERNS = [
        r"^(Article|Section|Chapter|Part|Annex|Schedule)\s+[\(\d]",
        r"Federal Decree",
        r"Cabinet (Decision|Resolution)",
        r"Value.?Added Tax",
        r"VAT",
        r"Executive Regulation",
        r"Designated Zone",
        r"amendment",
        r"effective",
        r"issued",
        r"repeal",
        r"This law",
        r"The following",
        r"Pursuant to",
        r"Having reviewed",
    ]
    SKIP_PATTERNS = [
        r"^(Home|About|Contact|FAQ|News|Media|Login|Sign)",
        r"^(Copyright|Privacy|Terms|Accessibility)",
        r"^\d+$",
        r"^[|•→←↑↓]",
        r"Skip to",
        r"cookie",
        r"javascript",
    ]

    clean_lines = []
    for line in lines:
        if len(line) < 8:
            continue
        skip = any(re.search(p, line, re.I) for p in SKIP_PATTERNS)
        if skip:
            continue
        keep = any(re.search(p, line, re.I) for p in KEEP_PATTERNS)
        # Also keep lines in index/heading sections or date-looking lines
        if keep or re.search(r"\d{4}", line):
            clean_lines.append(line)

    clean_text = "\n".join(clean_lines[:200])  # cap at 200 lines

    # ── Extract links ──────────────────────────────────────────────────────
    pdf_links = []
    related_links = []
    download_links = []

    for a in soup.find_all("a", href=True):
        href = a["href"]
        full = urljoin(page_url, href)
        text = a.get_text(strip=True)

        if "/download" in full and "uaelegislation.gov.ae" in full:
            lang = "ar" if "/ar/" in full else "en"
            download_links.append({"url": full, "lang": lang, "text": text or lang.upper()})
        elif full.lower().endswith(".pdf"):
            pdf_links.append({"url": full, "text": text[:80] if text else ""})
        elif "uaelegislation.gov.ae/en/legislations/" in full and "/download" not in full:
            law_id = re.search(r"/legislations/(\d+)", full)
            if law_id and law_id.group(1) != "1227":
                related_links.append({"url": full, "law_id": law_id.group(1), "text": text[:80]})

    # Deduplicate
    pdf_links = list({d["url"]: d for d in pdf_links}.values())
    related_links = list({d["url"]: d for d in related_links}.values())
    download_links = list({d["url"]: d for d in download_links}.values())

    return {
        "clean_text": clean_text,
        "metadata": metadata,
        "amendment_notices": amendment_notices[:10],
        "pdf_links": pdf_links[:30],
        "download_links": download_links,
        "related_legislation_links": related_links[:20],
    }


def format_landing_for_rag(title: str, url: str, structured: dict) -> str:
    """
    Format structured landing page data into clean text for RAG ingestion.
    This is the 'context layer' stored alongside the PDF.
    """
    parts = [
        f"DOCUMENT: {title}",
        f"SOURCE: {url}",
        f"LAYER: Landing Page Context (amendments, metadata, related laws)",
        "",
    ]

    meta = structured.get("metadata", {})
    if meta:
        parts.append("── Legal Metadata ──")
        for k, v in meta.items():
            parts.append(f"{k.replace('_', ' ').title()}: {v}")
        parts.append("")

    notices = structured.get("amendment_notices", [])
    if notices:
        parts.append("── Amendment Notices ──")
        for n in notices:
            parts.append(f"• {n}")
        parts.append("")

    dl_links = structured.get("download_links", [])
    if dl_links:
        parts.append("── Download Links ──")
        for d in dl_links:
            parts.append(f"• [{d['lang'].upper()}] {d['url']}")
        parts.append("")

    rel_links = structured.get("related_legislation_links", [])
    if rel_links:
        parts.append("── Related Legislation ──")
        for r in rel_links[:10]:
            parts.append(f"• Law {r['law_id']}: {r['text']} — {r['url']}")
        parts.append("")

    clean = structured.get("clean_text", "")
    if clean:
        parts.append("── Page Content ──")
        parts.append(clean)

    return "\n".join(parts)


# ── PDF fetcher ────────────────────────────────────────────────────────────────

def fetch_pdf_as_firecrawl_markdown(url: str, scraper, firecrawl_key: str = None) -> str | None:
    """
    Fetch PDF content. Uses Firecrawl if key available, else returns None
    (caller should handle via Firecrawl in Node.js).
    """
    if not firecrawl_key:
        return None

    import urllib.request
    req_data = json.dumps({"url": url, "formats": ["markdown"], "onlyMainContent": True}).encode()
    req = urllib.request.Request(
        "https://api.firecrawl.dev/v2/scrape",
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {firecrawl_key}",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read())
            return data.get("data", {}).get("markdown") or data.get("markdown")
    except Exception:
        return None


# ── Related legislations crawler ───────────────────────────────────────────────

def crawl_related_legislations(related_url: str, scraper) -> list[dict]:
    """
    Fetch related-legislations page and extract all EN download links with metadata.
    """
    try:
        r = scraper.get(related_url, timeout=20)
        if not r.ok:
            return []
    except Exception:
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    items = []
    seen = set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        full = urljoin(related_url, href)

        # Only EN download links, skip main law (1227)
        if ("/en/legislations/" in full and "/download" in full
                and "1227" not in full and full not in seen):
            seen.add(full)
            law_id = re.search(r"/legislations/(\d+)/download", full)
            if law_id:
                page_url = full.replace("/download", "")
                # Try to get title from nearby text
                title_text = ""
                parent = a.find_parent(["li", "tr", "div"])
                if parent:
                    title_text = parent.get_text(separator=" ", strip=True)[:120]

                items.append({
                    "law_id": law_id.group(1),
                    "download_url": full,
                    "page_url": page_url,
                    "title_hint": title_text,
                })

    return items


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="Scrape a single URL")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--firecrawl-key", default="", help="Firecrawl API key for PDF parsing")
    args = parser.parse_args()

    # Try to read firecrawl key from .env if not provided
    firecrawl_key = args.firecrawl_key
    if not firecrawl_key:
        env_file = Path(__file__).parent.parent / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                m = re.match(r'^FIRECRAWL_API_KEY\s*=\s*["\']?([^"\']+)["\']?', line)
                if m:
                    firecrawl_key = m.group(1).strip()
                    break

    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True}
    )

    results = []
    sources = SOURCES

    if args.url:
        sources = [{
            "title": args.url,
            "landing_url": args.url,
            "download_url": None,
            "related_url": None,
            "doc_type": "manual",
            "priority": 9,
            "source": urlparse(args.url).netloc,
        }]

    for src in sources:
        result = {
            "title": src["title"],
            "landing_url": src["landing_url"],
            "doc_type": src["doc_type"],
            "priority": src["priority"],
            "source": src["source"],
            "layers": [],
        }

        # ── Layer 1: Landing page ─────────────────────────────────────────
        try:
            r = scraper.get(src["landing_url"], timeout=20)
            if r.ok:
                structured = extract_structured_landing(r.text, src["landing_url"])
                landing_text = format_landing_for_rag(src["title"], src["landing_url"], structured)
                result["layers"].append({
                    "layer": "landing_page",
                    "url": src["landing_url"],
                    "content": landing_text,
                    "metadata": structured["metadata"],
                    "amendment_notices": structured["amendment_notices"],
                    "download_links": structured["download_links"],
                    "pdf_links": structured["pdf_links"][:10],
                    "status": "ok",
                })
            else:
                result["layers"].append({
                    "layer": "landing_page",
                    "url": src["landing_url"],
                    "status": "failed",
                    "error": f"HTTP {r.status_code}",
                })
            time.sleep(1)
        except Exception as e:
            result["layers"].append({
                "layer": "landing_page",
                "url": src["landing_url"],
                "status": "failed",
                "error": str(e),
            })

        # ── Layer 2: PDF download (primary law text) ──────────────────────
        if src.get("download_url"):
            try:
                r = scraper.get(src["download_url"], timeout=30)
                if r.ok and r.content[:4] == b"%PDF":
                    # PDF downloaded — pass to Firecrawl for text extraction
                    pdf_text = fetch_pdf_as_firecrawl_markdown(
                        src["download_url"], scraper, firecrawl_key
                    )
                    result["layers"].append({
                        "layer": "pdf",
                        "url": src["landing_url"],
                        "scrape_url": src["download_url"],
                        "size_kb": len(r.content) // 1024,
                        "content": pdf_text,  # None if no Firecrawl key
                        "status": "ok" if pdf_text else "pdf_only",
                    })
                else:
                    result["layers"].append({
                        "layer": "pdf",
                        "url": src["download_url"],
                        "status": "failed",
                        "error": f"HTTP {r.status_code} or not PDF",
                    })
                time.sleep(1)
            except Exception as e:
                result["layers"].append({
                    "layer": "pdf",
                    "url": src["download_url"],
                    "status": "failed",
                    "error": str(e),
                })

        # ── Layer 3: Related legislation (auto-discover) ──────────────────
        if src.get("related_url"):
            related = crawl_related_legislations(src["related_url"], scraper)
            if related:
                result["related_laws"] = []
                for rel in related:
                    time.sleep(1)
                    try:
                        # Landing page for each related law
                        rr = scraper.get(rel["page_url"], timeout=20)
                        if rr.ok:
                            rel_structured = extract_structured_landing(rr.text, rel["page_url"])
                            rel_landing = format_landing_for_rag(
                                f"UAE Legislation {rel['law_id']} (EN)",
                                rel["page_url"],
                                rel_structured
                            )
                            # PDF download
                            pdf_text = None
                            try:
                                pdf_r = scraper.get(rel["download_url"], timeout=30)
                                if pdf_r.ok and pdf_r.content[:4] == b"%PDF":
                                    pdf_text = fetch_pdf_as_firecrawl_markdown(
                                        rel["download_url"], scraper, firecrawl_key
                                    )
                            except Exception:
                                pass

                            result["related_laws"].append({
                                "law_id": rel["law_id"],
                                "title": f"UAE Legislation {rel['law_id']} (EN)",
                                "landing_url": rel["page_url"],
                                "download_url": rel["download_url"],
                                "doc_type": "vat_law",
                                "priority": 10,
                                "layers": [
                                    {
                                        "layer": "landing_page",
                                        "url": rel["page_url"],
                                        "content": rel_landing,
                                        "metadata": rel_structured["metadata"],
                                        "amendment_notices": rel_structured["amendment_notices"],
                                        "status": "ok",
                                    },
                                    *(
                                        [{
                                            "layer": "pdf",
                                            "url": rel["page_url"],
                                            "scrape_url": rel["download_url"],
                                            "content": pdf_text,
                                            "status": "ok" if pdf_text else "pdf_only",
                                        }] if pdf_text is not None else []
                                    ),
                                ],
                            })
                    except Exception as e:
                        result["related_laws"].append({
                            "law_id": rel["law_id"],
                            "error": str(e),
                        })

        results.append(result)

    print(json.dumps({"results": results, "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
