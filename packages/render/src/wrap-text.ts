// ponytail: greedy word-wrap by estimated character width, not real font-metrics
// measurement. Good enough for a scrim-backed overlay where a slightly loose fit still
// reads fine; swap in real text-measurement (e.g. via a headless canvas) if a format ever
// needs pixel-tight wrapping.
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Truncates wrapped lines to maxLines, marking a cut with an ellipsis instead of just
// silently dropping the rest of the sentence — caught in practice: a long model-written
// subhead got hard-sliced to "...incorrect TXT" with no indication it was cut off.
export function truncateLines(lines: string[], maxLines: number, maxCharsPerLine: number): string[] {
  if (lines.length <= maxLines || maxLines <= 0) return lines.slice(0, maxLines);
  const kept = lines.slice(0, maxLines);
  const ellipsis = "…";
  const last = kept[maxLines - 1];
  kept[maxLines - 1] =
    last.length + ellipsis.length > maxCharsPerLine
      ? last.slice(0, Math.max(0, maxCharsPerLine - ellipsis.length)).trimEnd() + ellipsis
      : last + ellipsis;
  return kept;
}
