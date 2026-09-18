export function extractJsonBlock(text: string, open: "{" | "[", close: "}" | "]"): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf(open);
  const end = candidate.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON ${open === "{" ? "object" : "array"} found in model output`);
  }
  return candidate.slice(start, end + 1);
}
