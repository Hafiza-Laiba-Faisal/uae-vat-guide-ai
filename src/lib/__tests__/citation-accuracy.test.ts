/**
 * Citation accuracy contract tests.
 *
 * These tests do NOT call the live LLM. They validate the *contract* the chat
 * pipeline enforces: given a set of retrieved chunks, the system prompt
 * guarantees:
 *   1. Empty retrieval → model is forced to emit the no-match fallback.
 *   2. Non-empty retrieval → model is forced to cite by [N] index and the
 *      indices supplied to the model always map 1:1 to a retrievable chunk.
 *   3. Confidence labelling matches the top chunk similarity.
 */
import { describe, it, expect } from "vitest";
import {
  buildRagSystemPrompt,
  extractCitationIndices,
  HIGH_CONFIDENCE_THRESHOLD,
  isFallbackAnswer,
  NO_MATCH_FALLBACK,
  type RetrievedChunk,
} from "../rag-prompt";

const seed = (sims: number[]): RetrievedChunk[] =>
  sims.map((s, i) => ({
    chunk_id: `c${i}`,
    document_id: `d${i}`,
    title: `FTA Doc ${i}`,
    source_url: `https://tax.gov.ae/doc-${i}`,
    section: `Article ${10 + i}`,
    content: `Excerpt body ${i} discussing VAT.`,
    similarity: s,
  }));

describe("citation accuracy contract", () => {
  it("forces the exact fallback line when no chunks are retrieved", () => {
    const prompt = buildRagSystemPrompt([]);
    expect(prompt).toContain(NO_MATCH_FALLBACK);
    // Simulated model output that follows the contract:
    expect(isFallbackAnswer(NO_MATCH_FALLBACK)).toBe(true);
  });

  it("every [N] index a model emits must exist in the supplied chunks", () => {
    const chunks = seed([0.9, 0.85, 0.8]);
    // Expert query so citation contract is enforced in prompt
    const prompt = buildRagSystemPrompt(chunks, "cite the article and legal basis for each point");
    // Valid simulated answer
    const valid = "Exports outside the GCC are zero-rated [1] and the registration threshold is AED 375,000 [3].";
    const cited = extractCitationIndices(valid);
    cited.forEach((idx) => {
      expect(idx).toBeGreaterThanOrEqual(1);
      expect(idx).toBeLessThanOrEqual(chunks.length);
      // The prompt must list that index so the model knows about it
      expect(prompt).toContain(`[${idx}]`);
    });
  });

  it("flags HIGH confidence only when top similarity ≥ threshold", () => {
    const expertQ = "which article number applies here?";
    const high = buildRagSystemPrompt(seed([HIGH_CONFIDENCE_THRESHOLD + 0.05, 0.6]), expertQ);
    const low = buildRagSystemPrompt(seed([HIGH_CONFIDENCE_THRESHOLD - 0.05, 0.4]), expertQ);
    expect(high).toMatch(/HIGH/);
    expect(low).toMatch(/MODERATE/);
  });

  it("prompt is grounded — refuses general-knowledge answers", () => {
    const prompt = buildRagSystemPrompt(seed([0.8]), "cite the legal basis and article number");
    expect(prompt).toMatch(/Only cite indices listed in VALID CITATION INDICES/i);
    expect(prompt).toMatch(/then stop/i);
  });

  it("an answer with no [N] citations against a non-empty chunk set is detectable", () => {
    // This is what the test harness would assert after a real model call.
    const fakeAnswer = "The standard rate is 5%.";
    const indices = extractCitationIndices(fakeAnswer);
    expect(indices).toEqual([]); // -> caller should flag as ungrounded
  });
});
