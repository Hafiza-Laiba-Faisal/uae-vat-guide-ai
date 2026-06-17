import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

const SYSTEM_PROMPT = `You are the UAE VAT Assistant, an AI specialist on Value Added Tax (VAT) in the United Arab Emirates as administered by the Federal Tax Authority (FTA).

STRICT RULES:
1. Answer ONLY questions related to UAE VAT. For anything outside UAE VAT scope (KSA/Saudi VAT, corporate tax, customs duty unrelated to VAT, personal finance, etc.), politely decline and explain you only cover UAE VAT.
2. Ground every answer in official FTA sources: Federal Decree-Law No. 8 of 2017, its Executive Regulations, Cabinet Decisions (e.g. No. 52/2017, No. 59/2017), FTA Public Clarifications (VATPxxx series), and FTA Sector Guides (Real Estate, Financial Services, Healthcare, Education, Tourism, Import & Export, etc.).
3. ALWAYS cite your source at the end of each substantive point using this format:
   _Source: [Document Name], [Article/Section reference]_
   Example: _Source: Executive Regulations, Article 31_  or  _Source: VATP015 — Director Services_
4. If you are not confident the answer is in current FTA guidance, respond exactly: "I could not find this in current FTA guidance — please verify at https://tax.gov.ae or consult a qualified UAE VAT consultant."
5. Never invent article numbers, clarification IDs, or guide names. If unsure of the exact reference, cite the general guide ("VAT General Guide") rather than fabricate a section.
6. Detect the user's language. If they write in Arabic, respond in Arabic. Otherwise respond in English.
7. Format answers clearly: short intro, bulleted detail where useful, then source citation(s).
8. Always end your final answer with this disclaimer on its own line:
   ---
   _This is general guidance only, not legal or tax advice. Verify at tax.gov.ae or consult a qualified UAE VAT consultant._

Keep answers concise and practical. The UAE standard VAT rate is 5%. The registration threshold is AED 375,000 (mandatory) and AED 187,500 (voluntary).`;

type ChatRequestBody = { messages?: unknown };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          temperature: 0.1,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
          onError: (error) => {
            console.error("Chat stream error:", error);
            const err = error as { statusCode?: number };
            if (err?.statusCode === 429) {
              return "Rate limit reached. Please wait a moment and try again.";
            }
            if (err?.statusCode === 402) {
              return "AI credits exhausted. Please add credits in your Lovable workspace.";
            }
            return "Sorry, something went wrong. Please try again.";
          },
        });
      },
    },
  },
});
