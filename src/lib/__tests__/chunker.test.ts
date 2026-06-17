import { describe, it, expect } from "vitest";
import { chunkText, contentHash, detectSection } from "../chunker";

describe("chunkText", () => {
  it("returns empty array on empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n   ")).toEqual([]);
  });

  it("keeps short documents as a single chunk", () => {
    const text = "Article 12 — Tax Period\n\nThe standard VAT rate is 5%.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("standard VAT rate");
    expect(chunks[0].section).toBe("Article 12 — Tax Period");
    expect(chunks[0].index).toBe(0);
  });

  it("splits long content into multiple sequentially-indexed chunks", () => {
    const para = "X".repeat(800);
    const text = Array.from({ length: 10 }, () => para).join("\n\n");
    const chunks = chunkText(text, { maxChars: 1500, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.content.length).toBeLessThanOrEqual(1500);
    });
  });

  it("creates overlapping chunks so cross-boundary citations survive", () => {
    const a = "AAA".repeat(400);
    const b = "BBB".repeat(400);
    const chunks = chunkText(`${a}\n\n${b}`, { maxChars: 1200, overlap: 300 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Second chunk should start with the overlap tail of the first
    const tail = chunks[0].content.slice(-100);
    expect(chunks[1].content.startsWith(tail.slice(0, 50))).toBe(true);
  });

  it("hard-slices a single paragraph larger than maxChars", () => {
    const huge = "Z".repeat(5000);
    const chunks = chunkText(huge, { maxChars: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(1000));
  });
});

describe("detectSection", () => {
  it("recognises common FTA heading prefixes", () => {
    expect(detectSection("Article 31 — Zero-rated supplies\nBody…")).toMatch(/Article 31/);
    expect(detectSection("Section 3.2: Reverse Charge\nBody…")).toMatch(/Section 3.2/);
    expect(detectSection("VATP015 — Director Services\nBody…")).toMatch(/VATP015/);
    expect(detectSection("Cabinet Decision No. 52 of 2017\nBody…")).toMatch(/Cabinet Decision/);
  });
  it("returns undefined when no heading prefix is present", () => {
    expect(detectSection("This is a regular paragraph.")).toBeUndefined();
  });
});

describe("contentHash", () => {
  it("is deterministic for equal inputs and differs for different inputs", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
    expect(contentHash("hello")).not.toBe(contentHash("hello!"));
  });
});
