/**
 * Split long text into overlapping chunks suitable for embedding.
 * Pure function — covered by tests in src/lib/__tests__/chunker.test.ts
 *
 * Strategy:
 *  1. Normalise whitespace.
 *  2. Split on blank-line paragraph boundaries.
 *  3. Greedy-pack paragraphs up to `maxChars`.
 *  4. When a single paragraph exceeds `maxChars`, hard-slice it.
 *  5. Carry `overlap` chars of tail context onto the next chunk so
 *     citations spanning a boundary are still retrievable.
 */

export interface Chunk {
  index: number;
  content: string;
  section?: string;
}

export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

const DEFAULT_MAX_CHARS = 3500; // ~1000 tokens
const DEFAULT_OVERLAP = 500; // ~150 tokens

/**
 * Heuristically detect a section heading from the first line of a chunk.
 * Recognises "Article 12", "Section 3.2", "Chapter Two", "VATP015 — ...".
 */
export function detectSection(text: string): string | undefined {
  const firstLine = text.split("\n", 1)[0]?.trim();
  if (!firstLine) return undefined;
  const m = firstLine.match(
    /^(article|section|chapter|clause|part|annex|vatp\s*\d+|cabinet decision[^\n]*)/i,
  );
  return m ? firstLine.slice(0, 160) : undefined;
}

export function chunkText(input: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = Math.min(opts.overlap ?? DEFAULT_OVERLAP, Math.floor(maxChars / 2));

  const normalised = input.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalised) return [];

  // Paragraph split, keep blank-line separators implicit.
  const paragraphs = normalised
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buffer = "";

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({
      index: chunks.length,
      content,
      section: detectSection(content),
    });
    // carry overlap onto next buffer
    buffer = overlap > 0 ? content.slice(-overlap) : "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Hard-slice oversized paragraph
      if (buffer.trim()) flush();
      let cursor = 0;
      while (cursor < para.length) {
        const slice = para.slice(cursor, cursor + maxChars);
        buffer = (buffer ? buffer + "\n\n" : "") + slice;
        flush();
        cursor += Math.max(1, maxChars - overlap);
      }
      continue;
    }

    const candidate = buffer ? buffer + "\n\n" + para : para;
    if (candidate.length > maxChars) {
      flush();
      buffer = (buffer ? buffer + "\n\n" : "") + para;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim()) {
    chunks.push({
      index: chunks.length,
      content: buffer.trim(),
      section: detectSection(buffer),
    });
  }

  return chunks;
}

/** Cheap stable hash for change detection (not for crypto). */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
