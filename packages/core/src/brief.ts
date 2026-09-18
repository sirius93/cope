import { loadBriefPromptTemplate, renderTemplate } from "@cope/formats";
import type { TextMessage, TextProvider } from "@cope/providers";
import { extractJsonBlock } from "./json.js";
import type { Brief } from "./types.js";

export function parseBriefJson(text: string): Brief {
  const parsed = JSON.parse(extractJsonBlock(text, "{", "}"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Brief must be a JSON object");
  }
  for (const field of ["coreClaim", "audience", "tone"]) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      throw new Error(`Brief field "${field}" must be a non-empty string`);
    }
  }
  for (const field of ["keyPoints", "quotableLines", "immutableFacts", "visualConcepts"]) {
    if (!Array.isArray(parsed[field]) || parsed[field].some((item: unknown) => typeof item !== "string" || !item.trim())) {
      throw new Error(`Brief field "${field}" must be an array of non-empty strings`);
    }
  }
  if (parsed.cta != null && typeof parsed.cta !== "string") {
    throw new Error("Brief cta must be a string or null");
  }
  return { ...parsed, cta: parsed.cta ?? null };
}

export async function generateBrief(
  source: string,
  provider: TextProvider,
  voice: string,
  maxRepairPasses = 2,
): Promise<Brief> {
  const prompt = renderTemplate(loadBriefPromptTemplate(), { source, voice });
  const messages: TextMessage[] = [{ role: "user", content: prompt }];

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRepairPasses; attempt++) {
    const res = await provider.complete({ messages, maxTokens: 2048 });
    try {
      return parseBriefJson(res.text);
    } catch (err) {
      lastError = err;
      if (attempt === maxRepairPasses) break;
      messages.push({ role: "assistant", content: res.text });
      messages.push({
        role: "user",
        content: `That wasn't valid JSON matching the required shape: ${
          err instanceof Error ? err.message : String(err)
        }. Output only the corrected JSON object, nothing else.`,
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
