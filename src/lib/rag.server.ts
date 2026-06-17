/**
 * Server-only RAG retrieval. Embeds a query and calls the
 * match_fta_chunks() SQL function via the Supabase admin client.
 */
import { embedOne } from "./embeddings.server";
import { SIMILARITY_THRESHOLD, type RetrievedChunk } from "./rag-prompt";

export async function retrieveChunks(
  query: string,
  matchCount = 5,
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
