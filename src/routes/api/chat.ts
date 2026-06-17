import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { retrieveChunks } from "@/lib/rag.server";
import { buildRagSystemPrompt } from "@/lib/rag-prompt";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

type ChatRequestBody = { messages?: unknown };

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const txt = m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .trim();
    if (txt) return txt;
  }
  return "";
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const uiMessages = messages as UIMessage[];
        const query = lastUserText(uiMessages);

        // RAG retrieval (best-effort — empty chunks triggers fallback prompt)
        let chunks: Awaited<ReturnType<typeof retrieveChunks>> = [];
        try {
          chunks = query ? await retrieveChunks(query, 5) : [];
        } catch (err) {
          console.error("[chat] retrieval error", err);
        }

        const system = buildRagSystemPrompt(chunks);

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const result = streamText({
          model,
          system,
          temperature: 0.1,
          messages: await convertToModelMessages(uiMessages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: uiMessages,
          messageMetadata: () => ({
            sources: chunks.map((c) => ({
              index: chunks.indexOf(c) + 1,
              title: c.title,
              section: c.section,
              url: c.source_url,
              similarity: Number(c.similarity.toFixed(3)),
            })),
          }),
          onError: (error) => {
            console.error("[chat] stream error", error);
            const err = error as { statusCode?: number };
            if (err?.statusCode === 429)
              return "Rate limit reached. Please wait a moment and try again.";
            if (err?.statusCode === 402)
              return "AI credits exhausted. Please add credits in your workspace.";
            return "Sorry, something went wrong. Please try again.";
          },
        });
      },
    },
  },
});
