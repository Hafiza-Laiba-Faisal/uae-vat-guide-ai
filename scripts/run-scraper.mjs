/**
 * UAE VAT Source Scraper Runner — Dual-Layer Ingestion
 *
 * Layer 1: Landing page → structured context (amendments, metadata, links)
 * Layer 2: PDF text → primary law content (via Firecrawl)
 *
 * Conflict resolution: PDF layer always wins for legal text.
 * Landing page stored separately as context/change-detection layer.
 *
 * Usage:
 *   node scripts/run-scraper.mjs              # scrape all + ingest
 *   node scripts/run-scraper.mjs --dry-run    # scrape only, no ingest
 *   node scripts/run-scraper.mjs --url <URL>  # single URL
 */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Load .env ─────────────────────────────────────────────────────────────────
const env = {};
try {
  readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  });
} catch {}

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const MISTRAL_API_KEY = env.MISTRAL_API_KEY;
const FIRECRAWL_API_KEY = env.FIRECRAWL_API_KEY;

const PYTHON = resolve(ROOT, "Website Documents Scraper", ".venv-linux", "bin", "python");
const SCRAPER = resolve(ROOT, "scripts", "scrape-sources.py");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const urlArg = args.includes("--url") ? args[args.indexOf("--url") + 1] : null;
const dryRun = args.includes("--dry-run");

console.log("UAE VAT Dual-Layer Scraper");
console.log("==========================");
if (urlArg) console.log(`Single URL: ${urlArg}`);
if (dryRun) console.log("Dry-run — no ingest");
console.log();

// ── Step 1: Run Python scraper ────────────────────────────────────────────────
console.log("Running Python cloudscraper...");
const pyArgs = [SCRAPER];
if (urlArg) pyArgs.push("--url", urlArg);
if (FIRECRAWL_API_KEY) pyArgs.push("--firecrawl-key", FIRECRAWL_API_KEY);

const py = spawnSync(PYTHON, pyArgs, {
  encoding: "utf8",
  maxBuffer: 100 * 1024 * 1024,
  timeout: 300000,
});

if (py.status !== 0) {
  console.error("Python scraper failed:", py.stderr?.slice(0, 500) || py.error?.message);
  process.exit(1);
}

let scraped;
try {
  scraped = JSON.parse(py.stdout);
} catch (e) {
  console.error("Failed to parse scraper output:", py.stdout?.slice(0, 500));
  if (py.stderr) console.error("Stderr:", py.stderr.slice(0, 300));
  process.exit(1);
}

// ── Print scrape summary ──────────────────────────────────────────────────────
const results = scraped.results ?? [];
console.log(`Scraped ${results.length} sources at ${scraped.scraped_at}\n`);

for (const r of results) {
  const layers = r.layers ?? [];
  const landingOk = layers.find((l) => l.layer === "landing_page" && l.status === "ok");
  const pdfOk = layers.find((l) => l.layer === "pdf" && l.status !== "failed");
  console.log(`  ${r.title}`);
  console.log(`    Landing: ${landingOk ? `✅ ${landingOk.content?.length ?? 0} chars` : "❌"}`);
  if (landingOk?.amendment_notices?.length) {
    console.log(`    Amendments: ${landingOk.amendment_notices.length} notices`);
  }
  if (pdfOk) {
    console.log(`    PDF: ${pdfOk.content ? `✅ ${pdfOk.content.length} chars` : `✅ downloaded (${pdfOk.size_kb}KB) — no text (Firecrawl needed)`}`);
  }
  if (r.related_laws?.length) {
    console.log(`    Related laws: ${r.related_laws.length}`);
  }
}

if (dryRun) {
  console.log("\nDry-run complete.");
  process.exit(0);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MISTRAL_API_KEY) {
  console.error("\nMissing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISTRAL_API_KEY");
  process.exit(1);
}

// ── Supabase + embedding setup ────────────────────────────────────────────────
const { createClient } = await import("@supabase/supabase-js");
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function embedTexts(texts) {
  const { createMistral } = await import("@ai-sdk/mistral");
  const { embedMany } = await import("ai");
  const mistral = createMistral({ apiKey: MISTRAL_API_KEY });
  const model = mistral.textEmbeddingModel("mistral-embed");
  const { embeddings } = await embedMany({ model, values: texts });
  return embeddings;
}

function contentHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function detectSection(text) {
  const first = text.split("\n", 1)[0]?.trim() ?? "";
  if (/^(article|section|chapter|clause|part|annex|vatp\s*\d+|cabinet decision)/i.test(first))
    return first.slice(0, 160);
  return undefined;
}

function chunkText(text, maxChars = 3500, overlap = 500) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";
  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({ index: chunks.length, content, section: detectSection(content) });
    buffer = overlap > 0 ? content.slice(-overlap) : "";
  };
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (buffer.trim()) flush();
      buffer = "";
      let cursor = 0;
      while (cursor < para.length) {
        buffer = para.slice(cursor, cursor + maxChars);
        flush();
        cursor += Math.max(1, maxChars - overlap);
      }
      continue;
    }
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length > maxChars) { flush(); buffer = para; }
    else buffer = candidate;
  }
  if (buffer.trim()) chunks.push({ index: chunks.length, content: buffer.trim(), section: detectSection(buffer) });
  return chunks;
}

// ── Ingest one document layer ─────────────────────────────────────────────────

async function ingestLayer(title, content, pageUrl, docType, priority, sourceKind) {
  if (!content || content.length < 50) return { status: "skipped", reason: "too short" };

  const hash = contentHash(content);
  const { data: existing } = await db.from("fta_documents")
    .select("id, content_hash")
    .eq("source_url", pageUrl)
    .maybeSingle();

  if (existing?.content_hash === hash) return { status: "unchanged" };

  const chunks = chunkText(content);
  if (!chunks.length) return { status: "failed", error: "no chunks" };

  let docId;
  if (existing) {
    await db.from("fta_chunks").delete().eq("document_id", existing.id);
    await db.from("fta_documents").update({
      title, content_hash: hash, chunk_count: chunks.length,
      source_kind: sourceKind, doc_type: docType, priority,
    }).eq("id", existing.id);
    docId = existing.id;
  } else {
    const { data: ins, error } = await db.from("fta_documents").insert({
      title, source_url: pageUrl, source_kind: sourceKind,
      content_hash: hash, chunk_count: chunks.length,
      doc_type: docType, priority,
    }).select("id").single();
    if (error) throw new Error(error.message);
    docId = ins.id;
  }

  // Embed in batches of 20
  const allEmbs = [];
  for (let i = 0; i < chunks.length; i += 20) {
    const batch = chunks.slice(i, i + 20);
    const embs = await embedTexts(batch.map((c) => c.content));
    allEmbs.push(...embs);
  }

  const rows = chunks.map((c, i) => ({
    document_id: docId, chunk_index: c.index,
    content: c.content, section: c.section ?? null,
    embedding: allEmbs[i],
  }));
  const { error: insErr } = await db.from("fta_chunks").insert(rows);
  if (insErr) throw new Error(insErr.message);

  return { status: "indexed", chunks: chunks.length };
}

// ── Process all results ───────────────────────────────────────────────────────

console.log("\nIngesting into Supabase (dual-layer)...\n");
const summary = { indexed: 0, unchanged: 0, failed: 0, skipped: 0 };

async function processSource(title, layers, landingUrl, docType, priority) {
  for (const layer of layers ?? []) {
    if (layer.status === "failed" || !layer.content) continue;

    const isLanding = layer.layer === "landing_page";
    const isPdf = layer.layer === "pdf";

    // Landing page: lower priority, add suffix to distinguish from PDF
    const layerTitle = isLanding ? `${title} [Context]` : title;
    const layerPriority = isLanding ? Math.max(1, priority - 2) : priority;
    const sourceKind = isLanding ? "landing_page" : "pdf";
    const pageUrl = isLanding ? landingUrl : (layer.url ?? landingUrl);

    process.stdout.write(`  [${isLanding ? "CTX" : "PDF"}] ${layerTitle.slice(0, 60)} ... `);
    try {
      const res = await ingestLayer(layerTitle, layer.content, pageUrl, docType, layerPriority, sourceKind);
      console.log(`${res.status}${res.chunks ? ` (${res.chunks} chunks)` : ""}`);
      summary[res.status] = (summary[res.status] ?? 0) + 1;
    } catch (e) {
      console.log(`failed: ${e.message}`);
      summary.failed++;
    }
  }
}

for (const r of results) {
  await processSource(r.title, r.layers, r.landing_url, r.doc_type, r.priority);

  for (const rel of r.related_laws ?? []) {
    if (!rel.layers) continue;
    await processSource(
      rel.title ?? `UAE Legislation ${rel.law_id}`,
      rel.layers,
      rel.landing_url,
      rel.doc_type ?? "vat_law",
      rel.priority ?? 10,
    );
  }
}

console.log(`\n==========================`);
console.log(`Indexed:   ${summary.indexed}`);
console.log(`Unchanged: ${summary.unchanged}`);
console.log(`Skipped:   ${summary.skipped}`);
console.log(`Failed:    ${summary.failed}`);
console.log(`\nDone! ${new Date().toISOString()}`);
