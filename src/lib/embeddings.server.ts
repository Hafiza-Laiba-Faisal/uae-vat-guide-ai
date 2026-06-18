/**
 * Server-only embeddings using Mistral mistral-embed.
 * Same provider as chat — no extra API key needed.
 * Output dims: 1024
 */
import { createMistral } from "@ai-sdk/mistral";
import { embed, embedMany } from "ai";

export const EMBEDDING_MODEL = "mistral-embed";
export const EMBEDDING_DIMS = 1024;

function getModel() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not configured");
  const mistral = createMistral({ apiKey });
  return mistral.textEmbeddingModel(EMBEDDING_MODEL);
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const { embeddings } = await embedMany({ model: getModel(), values: inputs });
  return embeddings;
}

export async function embedOne(input: string): Promise<number[]> {
  const { embedding } = await embed({ model: getModel(), value: input });
  return embedding;
}
