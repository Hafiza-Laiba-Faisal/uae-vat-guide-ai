/**
 * UAE VAT Source Crawler — Test Script
 * Run: node scripts/crawl-test.mjs
 *
 * Tests 4 seed URLs, shows:
 *  - HTTP status
 *  - Content type
 *  - Page title
 *  - All VAT-relevant links found
 *  - PDF links found
 *  - Extracted text length + first 500 chars
 */

import { parse } from "node-html-parser";

// ── Config ────────────────────────────────────────────────────────────────────

const SEED_URLS = [
  { name: "UAE Legislation — VAT Law",   url: "https://uaelegislation.gov.ae/en/legislations/1227" },
  { name: "FTA — Main Portal",           url: "https://tax.gov.ae/en/default.aspx" },
  { name: "FTA — VAT Topics",            url: "https://tax.gov.ae/en/vat/vat.topics.aspx" },
  { name: "MoF — VAT Page",             url: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/" },
];

const ALLOWED_DOMAINS = ["uaelegislation.gov.ae", "tax.gov.ae", "mof.gov.ae"];

const INCLUDE_KEYWORDS = [
  "vat", "tax", "legislation", "decree", "law", "regulation",
  "cabinet", "clarification", "guide", "faq", "value-added",
  "executive", "procedure", "ministerial",
];

const EXCLUDE_KEYWORDS = [
  "careers", "jobs", "media", "gallery", "events", "tender",
  "procurement", "contact", "sitemap", "privacy", "terms",
  "accessibility", "whistleblow", "newsletter",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAllowedUrl(href) {
  try {
    const u = new URL(href);
    if (!ALLOWED_DOMAINS.some((d) => u.hostname.endsWith(d))) return false;
    const path = u.pathname.toLowerCase() + u.search.toLowerCase();
    if (EXCLUDE_KEYWORDS.some((k) => path.includes(k))) return false;
    if (INCLUDE_KEYWORDS.some((k) => path.includes(k))) return true;
    return false;
  } catch {
    return false;
  }
}

function isPdf(href) {
  return href.toLowerCase().endsWith(".pdf");
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; UAE-VAT-Research/1.0)",
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", html: await res.text() };
}

function extractText(root) {
  for (const el of root.querySelectorAll(
    "script,style,noscript,nav,header,footer,iframe,[aria-hidden='true'],.menu,.navigation,.breadcrumb",
  )) el.remove();

  const main =
    root.querySelector("main") ??
    root.querySelector('[role="main"]') ??
    root.querySelector(".main-content, #main-content, .content, #content, article") ??
    root.querySelector("body");

  if (!main) return "";
  return main.innerText
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLinks(root, baseUrl) {
  const links = { vat: [], pdf: [], other: [] };
  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    let abs;
    try { abs = new URL(href, baseUrl).href; } catch { continue; }
    if (isPdf(abs)) {
      links.pdf.push({ text: a.innerText.trim().slice(0, 80), url: abs });
    } else if (isAllowedUrl(abs)) {
      links.vat.push({ text: a.innerText.trim().slice(0, 80), url: abs });
    }
  }
  // deduplicate
  links.vat = [...new Map(links.vat.map((l) => [l.url, l])).values()];
  links.pdf = [...new Map(links.pdf.map((l) => [l.url, l])).values()];
  return links;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("UAE VAT Crawler — Structure Test");
console.log("=".repeat(60));

for (const seed of SEED_URLS) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📌 ${seed.name}`);
  console.log(`   ${seed.url}`);

  try {
    const { status, contentType, html } = await fetchPage(seed.url);
    console.log(`   Status: ${status} | Type: ${contentType.split(";")[0]}`);

    if (!html || status !== 200) {
      console.log("   ❌ Could not fetch");
      continue;
    }

    const root = parse(html);
    const title = root.querySelector("title")?.innerText?.trim() ?? "(no title)";
    console.log(`   Title: ${title}`);

    const text = extractText(root);
    console.log(`   Text length: ${text.length} chars`);
    console.log(`   First 400 chars:\n   ${text.slice(0, 400).replace(/\n/g, "\n   ")}`);

    const links = extractLinks(root, seed.url);
    console.log(`\n   📄 VAT-relevant links (${links.vat.length}):`);
    links.vat.slice(0, 15).forEach((l) => console.log(`     • ${l.text || "(no text)"}\n       ${l.url}`));
    if (links.vat.length > 15) console.log(`     … and ${links.vat.length - 15} more`);

    console.log(`\n   📑 PDF links (${links.pdf.length}):`);
    links.pdf.slice(0, 10).forEach((l) => console.log(`     • ${l.text || "(no text)"}\n       ${l.url}`));
    if (links.pdf.length > 10) console.log(`     … and ${links.pdf.length - 10} more`);

  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log("Test complete. Review above to plan full crawl.");
