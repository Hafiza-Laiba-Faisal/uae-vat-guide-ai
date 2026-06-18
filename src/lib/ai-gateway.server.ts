import { createMistral } from "@ai-sdk/mistral";

/**
 * Returns a Mistral chat model instance.
 * Requires MISTRAL_API_KEY in environment.
 */
export function createChatModel() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not configured");
  const mistral = createMistral({ apiKey });
  return mistral("mistral-large-latest");
}
