import { describe, it, expect } from "vitest";
import {
  buildRagSystemPrompt,
  extractCitationIndices,
  isFallbackAnswer,
  NO_MATCH_FALLBACK,
  type RetrievedChunk,
} from "../rag-prompt";

function chunk(over: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunk_id: "c1",
    document_id: "d1",
    title: "Executive Regulations",
    source_url: "https://tax.gov.ae/regs",
    section: "Article 31 — Zero-rated supplies",
    content: "Exports of goods outside the GCC are zero-rated for VAT purposes.",
    similarity: 0.82,
    ...over,
  };
}

describe("buildRagSystemPrompt", () => {
  it("returns a strict fallback prompt when no chunks are retrieved", () => {
    const p = buildRagSystemPrompt([]);
    expect(p).toContain("No FTA excerpts passed the relevance threshold");
    expect(p).toContain(NO_MATCH_FALLBACK);
    expect(p).toMatch(/Do NOT guess/);
  });

  it("embeds excerpts and forces bracketed citations when chunks exist", () => {
    const p = buildRagSystemPrompt([chunk(), chunk({ chunk_id: "c2", section: "Article 45", similarity: 0.71 })]);
    expect(p).toContain("[1]");
    expect(p).toContain("[2]");
    expect(p).toContain("Executive Regulations");
    expect(p).toContain("=== RETRIEVED EXCERPTS ===");
    expect(p).toContain("=== END EXCERPTS ===");
    expect(p).toMatch(/HIGH/);
  });

  it("downgrades confidence label when top similarity is below the high threshold", () => {
    const p = buildRagSystemPrompt([chunk({ similarity: 0.55 })]);
    expect(p).toMatch(/MODERATE/);
  });

  it("keeps the fallback instruction available even when chunks exist", () => {
    const p = buildRagSystemPrompt([chunk()]);
    expect(p).toContain(NO_MATCH_FALLBACK);
  });
});

describe("extractCitationIndices", () => {
  it("returns unique sorted indices found in the answer", () => {
    expect(extractCitationIndices("Per [2] and [1], exports are zero-rated [2].")).toEqual([1, 2]);
  });
  it("returns empty array when no citations are present", () => {
    expect(extractCitationIndices("No citations here.")).toEqual([]);
  });
  it("ignores numbers that are not bracketed", () => {
    expect(extractCitationIndices("Section 31 of Article 5 is relevant.")).toEqual([]);
  });
});

describe("isFallbackAnswer", () => {
  it("matches the canonical fallback sentence", () => {
    expect(isFallbackAnswer(NO_MATCH_FALLBACK)).toBe(true);
    expect(isFallbackAnswer(`  ${NO_MATCH_FALLBACK} extra suggestion…`)).toBe(true);
  });
  it("rejects regular answers", () => {
    expect(isFallbackAnswer("The standard VAT rate is 5%. [1]")).toBe(false);
  });
});
