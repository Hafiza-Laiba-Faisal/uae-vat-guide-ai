/**
 * FTA auto-updater. Scrapes a configurable list of tax.gov.ae URLs via the
 * Firecrawl connector (markdown output), then ingests each as a document.
 *
 * If FIRECRAWL_API_KEY is missing, returns a structured "not configured"
 * status so the caller can prompt the admin to link Firecrawl.
 */
import { chunkText, contentHash } from "./chunker";
import { embedTexts } from "./embeddings.server";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

export const DEFAULT_FTA_SOURCES: { title: string; url: string }[] = [
  {
    title: "FTA — VAT Overview",
    url: "https://tax.gov.ae/en/taxes/vat.aspx",
  },
  {
    title: "FTA — VAT Legislation",
    url: "https://tax.gov.ae/en/legislation",
  },
  {
    title: "FTA — Public Clarifications",
    url: "https://tax.gov.ae/en/public.clarifications.aspx",
  },
  {
    title: "FTA — VAT Guides",
    url: "https://tax.gov.ae/en/taxes/vat/vat.guides.aspx",
  },
];

export interface RefreshResult {
  ok: boolean;
  notConfigured?: boolean;
  message?: string;
  processed: Array<{
    url: string;
    title: string;
    status: "indexed" | "unchanged" | "failed";
    chunks?: number;
    error?: string;
  }>;
}

async function firecrawlScrape(url: string, apiKey: string): Promise<string | null> {
  const res = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firecrawl ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    data?: { markdown?: string };
    markdown?: string;
  };
  return json.data?.markdown ?? json.markdown ?? null;
}

export async function refreshFtaFromFirecrawl(
  urls?: string[],
): Promise<RefreshResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      notConfigured: true,
      message:
        "Firecrawl is not connected. Link the Firecrawl connector from the project Connectors panel to enable automatic FTA scraping.",
      processed: [],
    };
  }

  const sources = (urls && urls.length > 0
    ? urls.map((u) => ({ title: u, url: u }))
    : DEFAULT_FTA_SOURCES);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const processed: RefreshResult["processed"] = [];

  for (const src of sources) {
    try {
      const markdown = await firecrawlScrape(src.url, apiKey);
      if (!markdown || markdown.length < 100) {
        processed.push({ url: src.url, title: src.title, status: "failed", error: "Empty content" });
        continue;
      }

      const hash = contentHash(markdown);
      const { data: existing } = await supabaseAdmin
        .from("fta_documents")
        .select("id, content_hash")
        .eq("source_url", src.url)
        .maybeSingle();

      if (existing && existing.content_hash === hash) {
        processed.push({ url: src.url, title: src.title, status: "unchanged" });
        continue;
      }

      const chunks = chunkText(markdown);
      if (chunks.length === 0) {
        processed.push({ url: src.url, title: src.title, status: "failed", error: "No chunks produced" });
        continue;
      }

      let docId: string;
      if (existing) {
        await supabaseAdmin.from("fta_chunks").delete().eq("document_id", existing.id);
        await supabaseAdmin
          .from("fta_documents")
          .update({
            title: src.title,
            source_kind: "firecrawl",
            content_hash: hash,
            chunk_count: chunks.length,
          })
          .eq("id", existing.id);
        docId = existing.id;
      } else {
        const { data: ins, error } = await supabaseAdmin
          .from("fta_documents")
          .insert({
            title: src.title,
            source_url: src.url,
            source_kind: "firecrawl",
            content_hash: hash,
            chunk_count: chunks.length,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        docId = ins.id;
      }

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

      processed.push({ url: src.url, title: src.title, status: "indexed", chunks: chunks.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[fta-updater] failed", src.url, message);
      processed.push({ url: src.url, title: src.title, status: "failed", error: message });
    }
  }

  return { ok: true, processed };
}
