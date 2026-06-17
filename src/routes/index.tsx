import { useChat } from "@ai-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { useMemo, useState } from "react";
import { ScalesIcon, SendIcon, SparklesIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UAE VAT Assistant — Ask any FTA VAT question" },
      {
        name: "description",
        content:
          "Free AI assistant for UAE VAT questions. Grounded in Federal Tax Authority (FTA) law, regulations and public clarifications. Answers in English or Arabic.",
      },
      { property: "og:title", content: "UAE VAT Assistant — Ask any FTA VAT question" },
      {
        property: "og:description",
        content:
          "AI-powered guidance on UAE Value Added Tax, citing official FTA sources. Not legal advice.",
      },
    ],
  }),
  component: ChatPage,
});

const SUGGESTIONS = [
  "What is the standard VAT rate in the UAE?",
  "Is residential property rental exempt from VAT?",
  "What documents are needed for VAT registration?",
  "How do I treat an export to a non-GCC country?",
  "What is the VAT treatment for healthcare services?",
  "What is a designated zone and how is VAT applied?",
];

function ChatPage() {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error } = useChat({ transport });
  const [input, setInput] = useState("");

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = messages.length === 0;

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/40">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-sm">
            <ScalesIcon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold leading-tight text-foreground">
              UAE VAT Assistant
            </h1>
            <p className="text-xs text-muted-foreground">
              Grounded in Federal Tax Authority (FTA) guidance · EN / العربية
            </p>
          </div>
          <span className="hidden rounded-full border bg-accent px-3 py-1 text-[11px] font-medium text-accent-foreground sm:inline-block">
            Guidance only · Not legal advice
          </span>
        </div>
      </header>

      {/* Chat area */}
      <main className="flex flex-1 flex-col">
        <Conversation className="mx-auto w-full max-w-3xl flex-1">
          <ConversationContent className="px-4 py-6">
            {isEmpty ? (
              <EmptyState onPick={submit} />
            ) : (
              <div className="space-y-6">
                {messages.map((m) => {
                  const text = m.parts
                    .map((p) => (p.type === "text" ? p.text : ""))
                    .join("");
                  const isArabic = /[\u0600-\u06FF]/.test(text);
                  return (
                    <Message key={m.id} from={m.role === "user" ? "user" : "assistant"}>
                      {m.role === "user" ? (
                        <MessageContent
                          className="bg-chat-user text-chat-user-foreground"
                          lang={isArabic ? "ar" : undefined}
                        >
                          <p className="whitespace-pre-wrap">{text}</p>
                        </MessageContent>
                      ) : (
                        <div
                          className="w-full max-w-full"
                          lang={isArabic ? "ar" : undefined}
                        >
                          <MessageResponse>{text || " "}</MessageResponse>
                        </div>
                      )}
                    </Message>
                  );
                })}
                {status === "submitted" && (
                  <Message from="assistant">
                    <div className="w-full">
                      <Shimmer>Searching FTA guidance…</Shimmer>
                    </div>
                  </Message>
                )}
                {error && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Could not get an answer. Please try again.
                  </div>
                )}
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Composer */}
        <div className="border-t bg-card/60 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            <PromptInput
              onSubmit={(msg) => submit(msg.text ?? input)}
              className="bg-background"
            >
              <PromptInputTextarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a UAE VAT question… (English or العربية)"
                disabled={isBusy}
              />
              <PromptInputFooter className="justify-between">
                <p className="text-[11px] text-muted-foreground">
                  Answers cite FTA sources. Verify at{" "}
                  <a
                    href="https://tax.gov.ae"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    tax.gov.ae
                  </a>
                  .
                </p>
                <PromptInputSubmit
                  status={status}
                  disabled={!input.trim() || isBusy}
                >
                  <SendIcon className="h-4 w-4" />
                </PromptInputSubmit>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </main>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-brand-foreground shadow-md">
        <SparklesIcon className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Ask anything about UAE VAT
        </h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Get instant, source-cited answers grounded in Federal Tax Authority
          law, regulations and public clarifications.
        </p>
      </div>
      <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((q) => (
          <Button
            key={q}
            variant="outline"
            className="h-auto justify-start whitespace-normal py-3 text-left text-sm font-normal text-foreground hover:bg-accent"
            onClick={() => onPick(q)}
          >
            {q}
          </Button>
        ))}
      </div>
      <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">
        This chatbot provides general guidance based on publicly available FTA
        documentation. It does not constitute legal or tax advice and is not
        affiliated with the Federal Tax Authority. Always verify at tax.gov.ae
        or consult a qualified UAE VAT consultant.
      </p>
    </div>
  );
}
