import { createChatModel } from "@/lib/ai-gateway.server";
import { retrieveChunks } from "@/lib/rag.server";
import { buildRagSystemPrompt, filterChunks } from "@/lib/rag-prompt";
import { detectIntent, buildRuleContext } from "@/lib/vat-rules";
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
        try {
          const { messages } = (await request.json()) as ChatRequestBody;
          if (!Array.isArray(messages)) {
            return new Response("Messages are required", { status: 400 });
          }

          const uiMessages = messages as UIMessage[];
          const query = lastUserText(uiMessages);

          console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          console.log("[chat] query:", query);

          // ── Layer 3+7: Intent detection + Rule engine ──────────────────
          const intent = detectIntent(query);
          console.log(`[intent] ${intent.intent} | confidence: ${intent.confidence} | deterministic: ${intent.is_deterministic}`);

          // Out of scope — return immediately without RAG
          if (intent.intent === "out_of_scope" && intent.rule_engine_answer) {
            console.log("[chat] out of scope — short circuit");
            const result = streamText({
              model: createChatModel(),
              system: "You are a UAE VAT assistant. Answer only what is provided.",
              temperature: 0,
              messages: await convertToModelMessages([
                ...uiMessages.slice(0, -1),
                {
                  id: "scope",
                  role: "user",
                  parts: [{ type: "text", text: intent.rule_engine_answer }],
                },
              ]),
            });
            return result.toUIMessageStreamResponse({
              originalMessages: uiMessages,
              messageMetadata: () => ({ sources: [], intent: intent.intent }),
              onError: () => "Sorry, something went wrong.",
            });
          }

          // ── Layer 2: RAG retrieval (with doc_type filter from intent) ──
          let chunks: Awaited<ReturnType<typeof retrieveChunks>> = [];
          try {
            chunks = query ? await retrieveChunks(query, 8) : [];
            // Filter by intent-suggested doc types if available
            if (intent.suggested_doc_types?.length && chunks.length > 0) {
              const typed = chunks.filter((c) =>
                intent.suggested_doc_types!.includes(c.doc_type ?? ""),
              );
              // Only apply filter if we still have enough chunks
              if (typed.length >= 2) chunks = typed;
            }
            // Apply similarity threshold filter
            chunks = filterChunks(chunks).slice(0, 5);
            console.log(`[rag] ${chunks.length} chunks after filtering`);
            chunks.forEach((c, i) => {
              console.log(
                `  [${i + 1}] sim=${c.similarity.toFixed(3)} P${c.priority ?? "?"} ${c.doc_type ?? ""} | ${c.title} — ${c.section ?? "no section"}`,
              );
            });
          } catch (err) {
            console.error("[chat] retrieval error", err);
          }

          // ── Layer 4: Build system prompt with rule context ─────────────
          const ruleContext = buildRuleContext(intent);
          const ragPrompt = buildRagSystemPrompt(chunks, query);

          // Prepend deterministic rule answer if available
          const deterministicPrefix = intent.rule_engine_answer && intent.is_deterministic
            ? `\n\n=== RULE ENGINE ANSWER (USE THIS AS BASIS) ===\n${intent.rule_engine_answer}\n=== END RULE ENGINE ===\n`
            : "";

          const system = `${ragPrompt}\n\n${ruleContext}${deterministicPrefix}`;

          console.log(`[chat] intent=${intent.intent} chunks=${chunks.length} deterministic=${intent.is_deterministic}`);
          console.log("[chat] calling Mistral mistral-large-latest…");

          const model = createChatModel();
          const result = streamText({
            model,
            system,
            temperature: 0.1,
            messages: await convertToModelMessages(uiMessages),
          });

          return result.toUIMessageStreamResponse({
            originalMessages: uiMessages,
            messageMetadata: () => {
              // Deduplicate sources by document
              const seen = new Map<string, typeof chunks[0]>();
              for (const c of chunks) {
                const existing = seen.get(c.document_id);
                if (!existing || c.similarity > existing.similarity) {
                  seen.set(c.document_id, c);
                }
              }
              const deduped = [...seen.values()].sort((a, b) => b.similarity - a.similarity);
              return {
                sources: deduped.map((c, i) => ({
                  index: i + 1,
                  title: c.title,
                  section: c.section,
                  url: c.source_url,
                  similarity: Number(c.similarity.toFixed(3)),
                  doc_type: c.doc_type,
                  priority: c.priority,
                })),
                intent: intent.intent,
                confidence: intent.confidence,
              };
            },
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
        } catch (err) {
          console.error("[chat] handler error", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
