/** Text helpers for titles / descriptions / JSON-LD. Pure (unit-tested in text.test.ts). */

const words = new Intl.Segmenter("th", { granularity: "word" });

/**
 * Shorten to at most `max` UTF-16 units without cutting a Thai word (or a vowel/tone mark off its
 * consonant): cuts at the last word boundary that fits and adds "…".
 */
export function clampText(input: string, max: number): string {
  const s = input.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let out = "";
  for (const { segment } of words.segment(s)) {
    if (out.length + segment.length > max - 1) break;
    out += segment;
  }
  out = out.replace(/[\s,.;:·—–-]+$/u, "");
  return out ? `${out}…` : `${s.slice(0, max - 1)}…`;
}

/** Plain text from the minimal product markdown (paragraphs, "- " bullets, **bold**, [links](url), # headings). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
