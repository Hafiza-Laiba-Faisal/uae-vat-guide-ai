// /**
//  * FTA auto-updater.
//  *
//  * Primary sources:
//  *  - UAE VAT Law PDF (EN + AR)
//  *  - MoF VAT page
//  *
//  * Auto-discovered updates:
//  *  - Crawls /related-legislations page, finds all /download links, fetches each
//  */
// import { chunkText, contentHash } from "./chunker";
// import { embedTexts } from "./embeddings.server";

// const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

// export type ScrapeMode = "firecrawl" | "direct";

// export interface RefreshResult {
//   ok: boolean;
//   notConfigured?: boolean;
//   message?: string;
//   mode?: ScrapeMode;
//   processed: Array<{
//     url: string;
//     title: string;
//     status: "indexed" | "unchanged" | "failed";
//     chunks?: number;
//     error?: string;
//   }>;
// }

// // ── Firecrawl ─────────────────────────────────────────────────────────────────

// async function firecrawlScrape(url: string, apiKey: string): Promise<string | null> {
//   const res = await fetch(FIRECRAWL_SCRAPE_URL, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${apiKey}`,
//     },
//     body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
//   });
//   if (!res.ok) {
//     const body = await res.text().catch(() => "");
//     throw new Error(`Firecrawl ${res.status}: ${body.slice(0, 200) || res.statusText}`);
//   }
//   const json = (await res.json()) as {
//     data?: { markdown?: string; links?: string[] };
//     markdown?: string;
//   };
//   return json.data?.markdown ?? json.markdown ?? null;
// }

// async function firecrawlLinks(url: string, apiKey: string): Promise<string[]> {
//   const res = await fetch(FIRECRAWL_SCRAPE_URL, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${apiKey}`,
//     },
//     body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: false }),
//   });
//   if (!res.ok) return [];
//   const json = (await res.json()) as { data?: { links?: string[] } };
//   return json.data?.links ?? [];
// }

// // ── Direct fetch ──────────────────────────────────────────────────────────────

// async function directScrape(url: string): Promise<string | null> {
//   const { parse } = await import("node-html-parser");
//   const res = await fetch(url, {
//     headers: {
//       "User-Agent": "Mozilla/5.0 (compatible; UAE-VAT-Bot/1.0)",
//       Accept: "text/html,application/xhtml+xml",
//     },
//     signal: AbortSignal.timeout(15_000),
//   });
//   if (!res.ok) throw new Error(`HTTP ${res.status}`);
//   const html = await res.text();
//   const root = parse(html);
//   for (const el of root.querySelectorAll("script,style,noscript,nav,header,footer,iframe"))
//     el.remove();
//   const main =
//     root.querySelector("main") ??
//     root.querySelector('[role="main"]') ??
//     root.querySelector("article") ??
//     root.querySelector("body");
//   if (!main) return null;
//   const text = main.innerText
//     .replace(/\t/g, " ")
//     .replace(/[ ]{2,}/g, " ")
//     .replace(/\n{3,}/g, "\n\n")
//     .trim();
//   return text.length > 100 ? text : null;
// }

// // ── Discover download links from related-legislations ─────────────────────────

// async function discoverRelatedDownloads(
//   relatedUrl: string,
//   apiKey: string,
// ): Promise<Array<{ title: string; url: string; lang: "en" | "ar" }>> {
//   console.log(`[fta-updater] Discovering related laws from ${relatedUrl}`);
//   const links = await firecrawlLinks(relatedUrl, apiKey);

//   const downloads: Array<{ title: string; url: string; lang: "en" | "ar" }> = [];
//   for (const link of links) {
//     const m = link.match(
//       /https:\/\/uaelegislation\.gov\.ae\/(en|ar)\/legislations\/(\d+)\/download/,
//     );
//     if (!m) continue;
//     const lang = m[1] as "en" | "ar";
//     const id = m[2];
//     // Skip the main law itself (1227) — already in primary sources
//     if (id === "1227") continue;
//     downloads.push({
//       title: `UAE Legislation ${id} (${lang.toUpperCase()})`,
//       url: link,
//       lang,
//     });
//   }

//   // Deduplicate by URL
//   const seen = new Set<string>();
//   return downloads.filter((d) => {
//     if (seen.has(d.url)) return false;
//     seen.add(d.url);
//     return true;
//   });
// }

// // ── Ingest one source ─────────────────────────────────────────────────────────

// async function ingestSource(
//   title: string,
//   scrapeUrl: string,
//   pageUrl: string,
//   mode: ScrapeMode,
//   apiKey: string,
//   // eslint-disable-next-line @typescript-eslint/no-explicit-any
//   supabaseAdmin: any,
// ): Promise<RefreshResult["processed"][0]> {
//   let text: string | null = null;
//   if (mode === "firecrawl") {
//     text = await firecrawlScrape(scrapeUrl, apiKey);
//   } else {
//     text = await directScrape(scrapeUrl);
//   }

//   if (!text || text.length < 100) {
//     return { url: pageUrl, title, status: "failed", error: "Empty content" };
//   }

//   const hash = contentHash(text);
//   const { data: existing } = await supabaseAdmin
//     .from("fta_documents")
//     .select("id, content_hash")
//     .eq("source_url", pageUrl)
//     .maybeSingle();

//   if (existing && existing.content_hash === hash) {
//     return { url: pageUrl, title, status: "unchanged" };
//   }

//   const chunks = chunkText(text);
//   if (chunks.length === 0) {
//     return { url: pageUrl, title, status: "failed", error: "No chunks" };
//   }

//   let docId: string;
//   if (existing) {
//     await supabaseAdmin.from("fta_chunks").delete().eq("document_id", existing.id);
//     await supabaseAdmin.from("fta_documents").update({
//       title,
//       content_hash: hash,
//       chunk_count: chunks.length,
//       source_kind: "firecrawl",
//     }).eq("id", existing.id);
//     docId = existing.id;
//   } else {
//     const { data: ins, error } = await supabaseAdmin
//       .from("fta_documents")
//       .insert({ title, source_url: pageUrl, source_kind: "firecrawl", content_hash: hash, chunk_count: chunks.length })
//       .select("id")
//       .single();
//     if (error) throw new Error(error.message);
//     docId = ins.id;
//   }

//   const embeddings = await embedTexts(chunks.map((c) => c.content));
//   const rows = chunks.map((c, i) => ({
//     document_id: docId,
//     chunk_index: c.index,
//     content: c.content,
//     section: c.section ?? null,
//     embedding: embeddings[i] as unknown as string,
//   }));
//   const { error: insErr } = await supabaseAdmin.from("fta_chunks").insert(rows);
//   if (insErr) throw new Error(insErr.message);

//   return { url: pageUrl, title, status: "indexed", chunks: chunks.length };
// }

// // ── Main refresh ──────────────────────────────────────────────────────────────

// export async function refreshFtaFromFirecrawl(
//   urls?: string[],
//   mode: ScrapeMode = "firecrawl",
// ): Promise<RefreshResult> {
//   const apiKey = process.env.FIRECRAWL_API_KEY;

//   if (mode === "firecrawl" && !apiKey) {
//     return {
//       ok: false,
//       notConfigured: true,
//       message: "FIRECRAWL_API_KEY is not set.",
//       processed: [],
//     };
//   }

//   const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
//   const processed: RefreshResult["processed"] = [];

//   // ── If custom URLs provided ────────────────────────────────────────────────
//   if (urls && urls.length > 0) {
//     for (const u of urls) {
//       try {
//         const result = await ingestSource(u, u, u, mode, apiKey ?? "", supabaseAdmin);
//         processed.push(result);
//       } catch (err) {
//         processed.push({ url: u, title: u, status: "failed", error: String(err) });
//       }
//     }
//     return { ok: true, mode, processed };
//   }

//   // ── Primary sources ────────────────────────────────────────────────────────
//   const primarySources = [
//     {
//       title: "Federal Decree-Law No. 8 of 2017 — UAE VAT Law (EN)",
//       scrapeUrl: "https://uaelegislation.gov.ae/en/legislations/1227/download",
//       pageUrl: "https://uaelegislation.gov.ae/en/legislations/1227",
//     },
//     {
//       title: "Federal Decree-Law No. 8 of 2017 — UAE VAT Law (AR)",
//       scrapeUrl: "https://uaelegislation.gov.ae/ar/legislations/1227/download",
//       pageUrl: "https://uaelegislation.gov.ae/ar/legislations/1227",
//     },
//     {
//       title: "Ministry of Finance — VAT Information",
//       scrapeUrl: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
//       pageUrl: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
//     },
//   ];

//   for (const src of primarySources) {
//     console.log(`[fta-updater] Primary: ${src.title}`);
//     try {
//       const result = await ingestSource(
//         src.title, src.scrapeUrl, src.pageUrl, mode, apiKey ?? "", supabaseAdmin,
//       );
//       processed.push(result);
//     } catch (err) {
//       const msg = err instanceof Error ? err.message : String(err);
//       console.error("[fta-updater] failed", src.scrapeUrl, msg);
//       processed.push({ url: src.pageUrl, title: src.title, status: "failed", error: msg });
//     }
//   }

//   // ── Auto-discover related legislation updates ──────────────────────────────
//   if (mode === "firecrawl" && apiKey) {
//     try {
//       const related = await discoverRelatedDownloads(
//         "https://uaelegislation.gov.ae/en/legislations/1227/related-legislations",
//         apiKey,
//       );
//       console.log(`[fta-updater] Discovered ${related.length} related laws`);

//       for (const rel of related) {
//         console.log(`[fta-updater] Related: ${rel.title}`);
//         try {
//           // Derive canonical pageUrl from download URL
//           const pageUrl = rel.url.replace("/download", "").replace("/ar/", "/en/");
//           const result = await ingestSource(
//             rel.title, rel.url, pageUrl, mode, apiKey, supabaseAdmin,
//           );
//           processed.push(result);
//         } catch (err) {
//           const msg = err instanceof Error ? err.message : String(err);
//           console.error("[fta-updater] related failed", rel.url, msg);
//           processed.push({ url: rel.url, title: rel.title, status: "failed", error: msg });
//         }
//       }
//     } catch (err) {
//       console.error("[fta-updater] related-legislations discovery failed", err);
//     }
//   }

//   return { ok: true, mode, processed };
// }





/**
 * FTA auto-updater — Updated v2
 *
 * Primary sources:
 *  - UAE VAT Law PDF (EN + AR)
 *  - MoF VAT page
 *  - FTA VAT Guides (General, Designated Zones, Real Estate, Financial, Healthcare, Input Tax)
 *  - FTA Public Clarifications (VATP043, VATP044, and auto-discovered)
 *  - FTA Legislation page
 *
 * Auto-discovered updates:
 *  - Crawls /related-legislations page for Cabinet Decisions
 *  - Crawls FTA guides listing page for new PDFs
 */






import { chunkText, contentHash } from "./chunker";
import { embedTexts } from "./embeddings.server";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

export type ScrapeMode = "firecrawl" | "direct";

export interface RefreshResult {
  ok: boolean;
  notConfigured?: boolean;
  message?: string;
  mode?: ScrapeMode;
  processed: Array<{
    url: string;
    title: string;
    status: "indexed" | "unchanged" | "failed";
    chunks?: number;
    error?: string;
  }>;
}

// ── Primary Sources ────────────────────────────────────────────────────────────
// Add new FTA guides here as they are published

const PRIMARY_SOURCES = [
  // ── Core Law ──────────────────────────────────────────────────────────────
  {
    title: "Federal Decree-Law No. 8 of 2017 — UAE VAT Law (EN)",
    scrapeUrl: "https://uaelegislation.gov.ae/en/legislations/1227/download",
    pageUrl: "https://uaelegislation.gov.ae/en/legislations/1227",
  },
  {
    title: "Federal Decree-Law No. 8 of 2017 — UAE VAT Law (AR)",
    scrapeUrl: "https://uaelegislation.gov.ae/ar/legislations/1227/download",
    pageUrl: "https://uaelegislation.gov.ae/ar/legislations/1227",
  },
  {
    title: "Ministry of Finance — VAT Information",
    scrapeUrl: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
    pageUrl: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
  },
  {
    title: "FTA Legislation Page",
    scrapeUrl: "https://tax.gov.ae/en/Legislation.aspx",
    pageUrl: "https://tax.gov.ae/en/Legislation.aspx",
  },

  // ── FTA VAT Guides ────────────────────────────────────────────────────────
  {
    title: "FTA VAT General Guide",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/VAT_general_guide.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
  {
    title: "FTA Designated Zones VAT Guide (VATGDZ1)",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/Designated-Zones-VAT-Guide.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
  {
    title: "FTA Real Estate VAT Guide",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/VAT-Real-Estate-Guide.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
  {
    title: "FTA Financial Services VAT Guide",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/VAT_Financial_Services_Guide.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
  {
    title: "FTA Healthcare VAT Guide",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/Healthcare_VAT_Guide.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
  {
    title: "FTA Input Tax Apportionment Guide (VATGIT1)",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/Input-Tax-Apportionment-Guide.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
  {
    title: "FTA VAT Registration Guide",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/VAT_Registration_Guide.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },

  // ── FTA Public Clarifications (VATP Series) ───────────────────────────────
  {
    title: "VATP043 — Precious Metals & Stones Reverse Charge (Cabinet Decision 127/2024)",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/VATP043.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
  {
    title: "VATP044 — Import of Services Reverse Charge Mechanism",
    scrapeUrl: "https://tax.gov.ae/DataFolder/Files/Pdf/VATP044.pdf",
    pageUrl: "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
  },
];

// ── Firecrawl ─────────────────────────────────────────────────────────────────

async function firecrawlScrape(url: string, apiKey: string): Promise<string | null> {
  const res = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firecrawl ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    data?: { markdown?: string; links?: string[] };
    markdown?: string;
  };
  return json.data?.markdown ?? json.markdown ?? null;
}

async function firecrawlLinks(url: string, apiKey: string): Promise<string[]> {
  const res = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: false }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { links?: string[] } };
  return json.data?.links ?? [];
}

// ── PDF Scraper ───────────────────────────────────────────────────────────────

async function scrapePdf(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; UAE-VAT-Bot/1.0)" },
    signal: AbortSignal.timeout(30_000), // PDFs can be large
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = await res.arrayBuffer();

  // pdfjs-dist: extract text page by page
  const { getDocument } = await import("pdfjs-dist");
  const pdf = await getDocument({ data: buffer }).promise;

  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => item.str)
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (pageText) fullText += `\n[Page ${i}]\n${pageText}`;
  }

  return fullText.length > 100 ? fullText : null;
}

// ── Direct HTML Scraper ───────────────────────────────────────────────────────

async function directScrape(url: string): Promise<string | null> {
  // Route PDFs to PDF scraper
  if (url.toLowerCase().endsWith(".pdf")) {
    return scrapePdf(url);
  }

  const { parse } = await import("node-html-parser");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; UAE-VAT-Bot/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const root = parse(html);
  for (const el of root.querySelectorAll("script,style,noscript,nav,header,footer,iframe"))
    el.remove();

  const main =
    root.querySelector("main") ??
    root.querySelector('[role="main"]') ??
    root.querySelector("article") ??
    root.querySelector("body");
  if (!main) return null;

  const text = main.innerText
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > 100 ? text : null;
}

// ── Auto-Discover: Related Cabinet Decisions ──────────────────────────────────

async function discoverRelatedDownloads(
  relatedUrl: string,
  apiKey: string,
): Promise<Array<{ title: string; url: string; lang: "en" | "ar" }>> {
  console.log(`[fta-updater] Discovering related laws from ${relatedUrl}`);
  const links = await firecrawlLinks(relatedUrl, apiKey);

  const downloads: Array<{ title: string; url: string; lang: "en" | "ar" }> = [];
  for (const link of links) {
    const m = link.match(
      /https:\/\/uaelegislation\.gov\.ae\/(en|ar)\/legislations\/(\d+)\/download/,
    );
    if (!m) continue;
    const lang = m[1] as "en" | "ar";
    const id = m[2];
    if (id === "1227") continue; // Skip main law — already in primary sources
    downloads.push({
      title: `UAE Legislation ${id} (${lang.toUpperCase()})`,
      url: link,
      lang,
    });
  }

  const seen = new Set<string>();
  return downloads.filter((d) => {
    if (seen.has(d.url)) return false;
    seen.add(d.url);
    return true;
  });
}

// ── Auto-Discover: New FTA VAT Guides & VATP Clarifications ──────────────────

async function discoverFtaGuides(
  apiKey: string,
): Promise<Array<{ title: string; url: string }>> {
  console.log("[fta-updater] Discovering new FTA guides and VATP clarifications");

  const links = await firecrawlLinks(
    "https://tax.gov.ae/en/taxes/vat/guides.references.aspx",
    apiKey,
  );

  // Collect known primary PDF URLs to avoid re-indexing
  const knownUrls = new Set(PRIMARY_SOURCES.map((s) => s.scrapeUrl.toLowerCase()));

  const pdfs: Array<{ title: string; url: string }> = [];
  for (const link of links) {
    if (!link.toLowerCase().endsWith(".pdf")) continue;
    if (!link.includes("tax.gov.ae")) continue;
    if (knownUrls.has(link.toLowerCase())) continue; // Already in primary sources

    // Build a readable title from filename
    const filename = link.split("/").pop()?.replace(".pdf", "") ?? link;
    const title = filename
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    pdfs.push({ title, url: link });
  }

  const seen = new Set<string>();
  return pdfs.filter((d) => {
    if (seen.has(d.url)) return false;
    seen.add(d.url);
    return true;
  });
}

// ── Ingest One Source ─────────────────────────────────────────────────────────

async function ingestSource(
  title: string,
  scrapeUrl: string,
  pageUrl: string,
  mode: ScrapeMode,
  apiKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
): Promise<RefreshResult["processed"][0]> {
  let text: string | null = null;

  if (mode === "firecrawl" && !scrapeUrl.toLowerCase().endsWith(".pdf")) {
    // Use Firecrawl for HTML pages
    text = await firecrawlScrape(scrapeUrl, apiKey);
  } else {
    // Always use direct scraper for PDFs (Firecrawl does not parse PDFs well)
    text = await directScrape(scrapeUrl);
  }

  if (!text || text.length < 100) {
    return { url: pageUrl, title, status: "failed", error: "Empty content" };
  }

  const hash = contentHash(text);
  const { data: existing } = await supabaseAdmin
    .from("fta_documents")
    .select("id, content_hash")
    .eq("source_url", pageUrl)
    .maybeSingle();

  // Skip if content has not changed
  if (existing && existing.content_hash === hash) {
    return { url: pageUrl, title, status: "unchanged" };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { url: pageUrl, title, status: "failed", error: "No chunks produced" };
  }

  // Upsert document record
  let docId: string;
  if (existing) {
    await supabaseAdmin.from("fta_chunks").delete().eq("document_id", existing.id);
    await supabaseAdmin
      .from("fta_documents")
      .update({ title, content_hash: hash, chunk_count: chunks.length, source_kind: "firecrawl" })
      .eq("id", existing.id);
    docId = existing.id;
  } else {
    const { data: ins, error } = await supabaseAdmin
      .from("fta_documents")
      .insert({
        title,
        source_url: pageUrl,
        source_kind: "firecrawl",
        content_hash: hash,
        chunk_count: chunks.length,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    docId = ins.id;
  }

  // Embed and insert chunks
  const embeddings = await embedTexts(chunks.map((c) => c.content));
  const rows = chunks.map((c, i) => ({
    document_id: docId,
    chunk_index: c.index,
    content: c.content,
    section: c.section ?? null,
    embedding: embeddings[i] as unknown as string,
  }));

  const { error: insErr } = await supabaseAdmin.from("fta_chunks").insert(rows);
  if (insErr) throw new Error(insErr.message);

  return { url: pageUrl, title, status: "indexed", chunks: chunks.length };
}

// ── Main Refresh ──────────────────────────────────────────────────────────────

export async function refreshFtaFromFirecrawl(
  urls?: string[],
  mode: ScrapeMode = "firecrawl",
): Promise<RefreshResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (mode === "firecrawl" && !apiKey) {
    return {
      ok: false,
      notConfigured: true,
      message: "FIRECRAWL_API_KEY is not set. Add it to your environment variables.",
      processed: [],
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const processed: RefreshResult["processed"] = [];

  // ── Custom URLs (manual trigger from admin panel) ─────────────────────────
  if (urls && urls.length > 0) {
    for (const u of urls) {
      try {
        const result = await ingestSource(u, u, u, mode, apiKey ?? "", supabaseAdmin);
        processed.push(result);
      } catch (err) {
        processed.push({ url: u, title: u, status: "failed", error: String(err) });
      }
    }
    return { ok: true, mode, processed };
  }

  // ── Step 1: Primary Sources ───────────────────────────────────────────────
  console.log(`[fta-updater] Processing ${PRIMARY_SOURCES.length} primary sources`);
  for (const src of PRIMARY_SOURCES) {
    console.log(`[fta-updater] Primary: ${src.title}`);
    try {
      const result = await ingestSource(
        src.title,
        src.scrapeUrl,
        src.pageUrl,
        mode,
        apiKey ?? "",
        supabaseAdmin,
      );
      processed.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[fta-updater] Primary failed:", src.scrapeUrl, msg);
      processed.push({ url: src.pageUrl, title: src.title, status: "failed", error: msg });
    }
  }

  // ── Step 2: Auto-discover related Cabinet Decisions ───────────────────────
  if (mode === "firecrawl" && apiKey) {
    try {
      const related = await discoverRelatedDownloads(
        "https://uaelegislation.gov.ae/en/legislations/1227/related-legislations",
        apiKey,
      );
      console.log(`[fta-updater] Discovered ${related.length} related Cabinet Decisions`);

      for (const rel of related) {
        console.log(`[fta-updater] Cabinet Decision: ${rel.title}`);
        try {
          const pageUrl = rel.url.replace("/download", "").replace("/ar/", "/en/");
          const result = await ingestSource(
            rel.title,
            rel.url,
            pageUrl,
            mode,
            apiKey,
            supabaseAdmin,
          );
          processed.push(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[fta-updater] Cabinet Decision failed:", rel.url, msg);
          processed.push({ url: rel.url, title: rel.title, status: "failed", error: msg });
        }
      }
    } catch (err) {
      console.error("[fta-updater] Related-legislations discovery failed:", err);
    }

    // ── Step 3: Auto-discover new FTA guides and VATP clarifications ─────────
    try {
      const ftaGuides = await discoverFtaGuides(apiKey);
      console.log(`[fta-updater] Discovered ${ftaGuides.length} new FTA PDFs`);

      for (const guide of ftaGuides) {
        console.log(`[fta-updater] New FTA guide: ${guide.title}`);
        try {
          const result = await ingestSource(
            guide.title,
            guide.url,
            guide.url,
            mode,
            apiKey,
            supabaseAdmin,
          );
          processed.push(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[fta-updater] FTA guide failed:", guide.url, msg);
          processed.push({ url: guide.url, title: guide.title, status: "failed", error: msg });
        }
      }
    } catch (err) {
      console.error("[fta-updater] FTA guide discovery failed:", err);
    }
  }

  // ── Summary log ───────────────────────────────────────────────────────────
  const indexed = processed.filter((p) => p.status === "indexed").length;
  const unchanged = processed.filter((p) => p.status === "unchanged").length;
  const failed = processed.filter((p) => p.status === "failed").length;
  console.log(
    `[fta-updater] Done — indexed: ${indexed}, unchanged: ${unchanged}, failed: ${failed}`,
  );

  return { ok: true, mode, processed };
}