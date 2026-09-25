import { readFileSync, statSync } from "node:fs";
import { loadVoicePromptTemplate, renderTemplate } from "@cope/formats";
import type { TextProvider } from "@cope/providers";
import { fetchUrl, stripHtml } from "./ingest.js";

const MAX_SOURCE_CHARS = 20_000; // per-source cap, keeps the combined prompt bounded
const MAX_FEED_ITEMS = 8;

async function readSource(source: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) return fetchUrl(source);
  if (statSync(source).size > 2 * 1024 * 1024) throw new Error(`Source exceeds 2 MiB limit: ${source}`);
  return readFileSync(source, "utf-8");
}

function isFeed(raw: string): boolean {
  return /<rss[\s>]|<feed[\s>]/i.test(raw.slice(0, 2000));
}

// ponytail: regex item extraction instead of a real XML parser — RSS/Atom item
// boundaries are simple enough that this holds up. Swap in `fast-xml-parser` if a feed's
// markup turns out too irregular for it.
export function feedItemsText(raw: string, max = MAX_FEED_ITEMS): string {
  const clean = (s: string) => stripHtml(s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1"));
  const blocks = [...raw.matchAll(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi)].slice(0, max);
  return blocks
    .map(([block]) => {
      const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
      const content =
        block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i)?.[1] ??
        block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ??
        block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ??
        block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ??
        "";
      return `## ${clean(title)}\n\n${clean(content)}`;
    })
    .join("\n\n---\n\n");
}

export async function gatherVoiceSources(sources: string[]): Promise<string> {
  const parts: string[] = [];
  for (const source of sources) {
    const raw = await readSource(source);
    const text = isFeed(raw) ? feedItemsText(raw) : stripHtml(raw);
    parts.push(`### Source: ${source}\n\n${text.slice(0, MAX_SOURCE_CHARS)}`);
  }
  return parts.join("\n\n===\n\n");
}

export async function learnVoice(sources: string[], provider: TextProvider, existingVoice = ""): Promise<string> {
  if (sources.length === 0) throw new Error("learnVoice requires at least one source");
  const source = await gatherVoiceSources(sources);
  const existing = existingVoice.trim()
    ? `\nExisting voice guide to refine rather than contradict:\n---\n${existingVoice.trim()}\n---\n`
    : "";
  const prompt = renderTemplate(loadVoicePromptTemplate(), { source, existing });
  const res = await provider.complete({ messages: [{ role: "user", content: prompt }], maxTokens: 1024 });
  const fenced = res.text.trim().match(/^```(?:markdown)?\s*([\s\S]*?)\s*```$/);
  return (fenced ? fenced[1] : res.text).trim();
}
