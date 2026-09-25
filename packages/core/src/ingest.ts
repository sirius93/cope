import { fetchBytes } from "@cope/providers";
import { readFileSync, statSync } from "node:fs";

export interface IngestResult {
  text: string;
  sourceType: "file" | "url";
}

export async function ingest(source: string): Promise<IngestResult> {
  if (/^https?:\/\//i.test(source)) {
    return { text: stripHtml(await fetchUrl(source)), sourceType: "url" };
  }
  if (statSync(source).size > 2 * 1024 * 1024) throw new Error("Source exceeds 2 MiB limit");
  return { text: readFileSync(source, "utf-8"), sourceType: "file" };
}

export async function fetchUrl(url: string): Promise<string> {
  return (await fetchBytes(url, {}, 2 * 1024 * 1024, 30_000)).toString("utf-8");
}

// ponytail: regex tag-stripping instead of a full Readability extraction — good enough
// for simple article pages. Swap in @mozilla/readability + jsdom if extraction quality
// on complex pages (nav/ads bleeding into the text) turns out to matter.
export function stripHtml(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
