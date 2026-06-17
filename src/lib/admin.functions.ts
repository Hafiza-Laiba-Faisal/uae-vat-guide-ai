import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { chunkText, contentHash } from "./chunker";
import { embedTexts } from "./embeddings.server";

const IngestSchema = z.object({
  title: z.string().min(2).max(300),
  content: z.string().min(20),
  sourceUrl: z.string().url().optional().nullable(),
  sourceKind: z.enum(["manual", "upload", "firecrawl"]).default("manual"),
});

async function assertAdmin(
  supabase: Parameters<Parameters<typeof createServerFn>[0] extends never ? never : never>[number] extends never
    ? never
    : never,
  // The above is a hack — we just inline the real check below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<void> {
  void supabase;
}

export const ingestDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IngestSchema.parse(input))
  .handler(async ({ data, context }) => {
    void assertAdmin;
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const chunks = chunkText(data.content);
    if (chunks.length === 0) throw new Error("Content produced no chunks");
    if (chunks.length > 200) throw new Error("Document too large (max 200 chunks)");

    const hash = contentHash(data.content);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Upsert document by source_url when supplied, else insert.
    let docId: string;
    if (data.sourceUrl) {
      const { data: existing } = await supabaseAdmin
        .from("fta_documents")
        .select("id, content_hash")
        .eq("source_url", data.sourceUrl)
        .maybeSingle();
      if (existing) {
        if (existing.content_hash === hash) {
          return { documentId: existing.id, chunks: 0, status: "unchanged" as const };
        }
        // Replace chunks for the existing doc
        await supabaseAdmin.from("fta_chunks").delete().eq("document_id", existing.id);
        await supabaseAdmin
          .from("fta_documents")
          .update({
            title: data.title,
            content_hash: hash,
            source_kind: data.sourceKind,
            chunk_count: chunks.length,
          })
          .eq("id", existing.id);
        docId = existing.id;
      } else {
        const { data: ins, error } = await supabaseAdmin
          .from("fta_documents")
          .insert({
            title: data.title,
            source_url: data.sourceUrl,
            source_kind: data.sourceKind,
            content_hash: hash,
            chunk_count: chunks.length,
            created_by: userId,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        docId = ins.id;
      }
    } else {
      const { data: ins, error } = await supabaseAdmin
        .from("fta_documents")
        .insert({
          title: data.title,
          source_kind: data.sourceKind,
          content_hash: hash,
          chunk_count: chunks.length,
          created_by: userId,
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

    return { documentId: docId, chunks: chunks.length, status: "indexed" as const };
  });

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { data, error } = await supabase
      .from("fta_documents")
      .select("id, title, source_url, source_kind, chunk_count, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin role required");
    const { error } = await supabase.from("fta_documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const claimInitialAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("claim_initial_admin");
    if (error) throw new Error(error.message);
    return { claimed: data === true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    return { userId, isAdmin: Boolean(isAdmin) };
  });

const RefreshSchema = z.object({
  urls: z.array(z.string().url()).max(20).optional(),
});

export const triggerFtaRefresh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RefreshSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { refreshFtaFromFirecrawl } = await import("./fta-updater.server");
    return refreshFtaFromFirecrawl(data.urls);
  });
