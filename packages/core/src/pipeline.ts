import { renderTemplate, validate, type FormatDefinition } from "@cope/formats";
import type { TextMessage, TextProvider } from "@cope/providers";
import { extractJsonBlock } from "./json.js";
import type { AdaptResult, Brief } from "./types.js";

function formatList(items: string[], fallback = "(none)"): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function parseOutput(def: FormatDefinition, text: string): string | string[] {
  if (def.outputSchema === "string[]") {
    return JSON.parse(extractJsonBlock(text, "[", "]"));
  }
  return text.trim();
}

export async function adaptFormat(
  brief: Brief,
  def: FormatDefinition,
  provider: TextProvider,
  opts: { source?: string; voice?: string; maxRepairPasses?: number } = {},
): Promise<AdaptResult> {
  const maxRepairPasses = opts.maxRepairPasses ?? 2;
  const prompt = renderTemplate(def.promptTemplate, {
    brief: JSON.stringify(brief, null, 2),
    limits: formatList(Object.entries(def.limits).map(([k, v]) => `${k}: ${v}`)),
    rules: formatList(def.rules),
    voice: opts.voice ?? "",
    source: opts.source ?? "",
  });

  const messages: TextMessage[] = [{ role: "user", content: prompt }];
  let output: string | string[] = "";
  let result = { valid: false, violations: ["not yet generated"] };
  let pass = 0;

  for (; pass <= maxRepairPasses; pass++) {
    const res = await provider.complete({ messages, maxTokens: 4096 });
    try {
      output = parseOutput(def, res.text);
      result = validate(def, output);
    } catch (err) {
      result = { valid: false, violations: [err instanceof Error ? err.message : String(err)] };
    }
    if (result.valid || pass === maxRepairPasses) break;
    messages.push({ role: "assistant", content: res.text });
    messages.push({
      role: "user",
      content: `That violates the hard limits:\n${formatList(result.violations)}\nOutput a corrected version, same format as before, nothing else.`,
    });
  }

  return {
    formatId: def.id,
    output,
    valid: result.valid,
    violations: result.violations,
    repairPasses: pass,
  };
}
