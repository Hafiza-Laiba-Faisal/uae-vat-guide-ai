/**
 * Server-only RAG retrieval.
 * Embeds a query and calls match_fta_chunks() which returns
 * priority-boosted results (high-tier law chunks rank first).
 */
import { embedOne } from "./embeddings.server";
import { SIMILARITY_THRESHOLD, type RetrievedChunk } from "./rag-prompt";

export async function retrieveChunks(
  query: string,
  matchCount = 8,
  threshold = SIMILARITY_THRESHOLD,
): Promise<RetrievedChunk[]> {
  if (!query.trim()) return [];

  const embedding = await embedOne(query);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin.rpc("match_fta_chunks", {
    query_embedding: embedding as unknown as string,
    match_count: matchCount,
    similarity_threshold: threshold,
  });

  if (error) {
    console.error("[rag] match_fta_chunks failed", error);
    return [];
  }
  return (data ?? []) as RetrievedChunk[];
}
