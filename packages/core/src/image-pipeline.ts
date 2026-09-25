import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate, type ImageFormatDefinition } from "@cope/formats";
import type { ImageProvider, TextMessage, TextProvider } from "@cope/providers";
import { buildPdfFromImages, renderTextOverlay, renderInfoCard, normalizeImage, IMAGE_STYLES, parseImageStyle, type ImageStyle, type Persona } from "@cope/render";
import { extractJsonBlock } from "./json.js";
import type { Brief, GeneratedImage, ImageAdaptResult, ImageConcept } from "./types.js";

function formatList(items: string[], fallback = "(none)"): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function parseSize(size: string): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) throw new Error(`Invalid size "${size}", expected "WIDTHxHEIGHT"`);
  return { width, height };
}

async function generateConcepts(
  brief: Brief,
  def: ImageFormatDefinition,
  provider: TextProvider,
  maxRepairPasses: number,
  style: ImageStyle,
): Promise<ImageConcept[]> {
  const prompt = renderTemplate(def.promptTemplate, {
    brief: JSON.stringify(brief, null, 2),
    size: def.size,
    slideCount: def.slides ? `${def.slides.min}-${def.slides.max}` : "1",
    rules: formatList([...def.rules, `Visual style: ${style}. ${IMAGE_STYLES[style].direction}`, "Keep palette, medium and composition consistent across all slides. Ground visuals in the source; do not invent numbers, charts, or logos."]),
  });
  const messages: TextMessage[] = [{ role: "user", content: prompt }];

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRepairPasses; attempt++) {
    const res = await provider.complete({ messages, maxTokens: 2048 });
    try {
      const parsed = JSON.parse(extractJsonBlock(res.text, "[", "]")) as ImageConcept[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Expected a non-empty JSON array of image concepts");
      }
      const min = def.slides?.min ?? 1;
      const max = def.slides?.max ?? 1;
      if (parsed.length < min || parsed.length > max) throw new Error(`Expected ${min}-${max} concepts, got ${parsed.length}`);
      for (const concept of parsed) {
        if (!concept || typeof concept.imagePrompt !== "string" || !concept.imagePrompt.trim()) throw new Error("Every concept needs a non-empty imagePrompt string");
        for (const key of ["headline", "subhead"] as const) {
          if (concept[key] === null) delete concept[key];
          if (concept[key] !== undefined && typeof concept[key] !== "string") throw new Error(`${key} must be a string`);
        }
        if (concept.negativeCues !== undefined && (!Array.isArray(concept.negativeCues) || concept.negativeCues.some((cue) => typeof cue !== "string"))) throw new Error("negativeCues must be strings");
        if (def.slides) {
          const headlineWords = concept.headline?.trim().split(/\s+/) ?? [];
          const incompleteEnding = /\b(?:a|an|and|at|by|for|from|in|of|on|or|the|to|with)$/i;
          if (
            !concept.headline ||
            headlineWords.length < 5 ||
            headlineWords.length > 6 ||
            /(?:\.\.\.|…)/.test(concept.headline) ||
            incompleteEnding.test(concept.headline)
          ) {
            throw new Error("Every carousel headline must be a complete 5-6 word summary with no ellipsis");
          }
          if (
            !concept.subhead?.trim() ||
            concept.subhead.length > 240 ||
            /(?:\.\.\.|…)/.test(concept.subhead) ||
            !/[.!?]$/.test(concept.subhead.trim())
          ) {
            throw new Error("Every carousel description must be complete, at most 240 characters, end with punctuation, and contain no ellipsis");
          }
        }
      }
      return parsed;
    } catch (err) {
      lastError = err;
      if (attempt === maxRepairPasses) break;
      messages.push({ role: "assistant", content: res.text });
      messages.push({
        role: "user",
        content: `That wasn't valid: ${err instanceof Error ? err.message : String(err)}. Output only the corrected JSON array.`,
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildImagePrompt(concept: ImageConcept, style: ImageStyle, hasOverlay: boolean): string {
  const negatives = concept.negativeCues?.length ? ` Avoid: ${concept.negativeCues.join(", ")}.` : "";
  return `${concept.imagePrompt}${negatives}\nVisual style: ${style}. ${IMAGE_STYLES[style].direction}\n${hasOverlay ? "Keep the lower third quiet; a text panel will be added there locally." : "Use a balanced composition with generous negative space."} Do not render any text, letters, numbers, logos, or words in the image itself.`;
}

// ponytail: word-boundary truncation, no layout-aware line breaking. Keeps card
// text short enough to fit info-card.ts's font-shrink floor; raise the caps if a
// wider/taller card size ever needs more room.
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`;
}

function informationConcepts(brief: Brief, def: ImageFormatDefinition): ImageConcept[] {
  const headlineMax = def.id === "og_image" ? 70 : 120;
  const bodyMax = def.id === "og_image" ? 90 : 140;
  const concept = (headline: string, subhead: string): ImageConcept => ({
    headline: truncate(headline, headlineMax),
    subhead: truncate(subhead, bodyMax),
    imagePrompt: "",
  });
  if (!def.slides) {
    return [concept(def.id === "quote_card" ? brief.quotableLines[0] ?? brief.coreClaim : brief.coreClaim,
      def.id === "quote_card" ? brief.audience : brief.keyPoints[0] ?? brief.audience)];
  }
  throw new Error("Carousel cards require the image_prompt text provider to summarize slide copy");
}

export async function adaptImageFormat(
  brief: Brief,
  def: ImageFormatDefinition,
  conceptProvider: TextProvider | undefined, // image_prompt stage
  imageProvider: ImageProvider | undefined, // image_generate stage
  altTextProvider: ImageProvider | undefined, // alt_text stage
  outDir: string,
  opts: { maxRepairPasses?: number; mode?: "cards" | "generated"; style?: ImageStyle; persona?: Persona; reserveImages?: (count: number) => void } = {},
): Promise<ImageAdaptResult> {
  const maxRepairPasses = opts.maxRepairPasses ?? 2;
  const cards = opts.mode === "cards";
  const style = parseImageStyle(opts.style ?? "editorial");
  if (!cards && (!conceptProvider || !imageProvider || !altTextProvider)) throw new Error("Generated mode requires image and text providers");
  if (def.slides && !conceptProvider) throw new Error("Carousel generation requires the image_prompt text provider");
  const concepts = cards && !def.slides
    ? informationConcepts(brief, def)
    : await generateConcepts(brief, def, conceptProvider!, maxRepairPasses, style);
  opts.reserveImages?.(concepts.length);
  const { width, height } = parseSize(def.size);

  mkdirSync(outDir, { recursive: true });
  const images: GeneratedImage[] = [];

  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i];
    const suffix = concepts.length > 1 ? `-${i + 1}` : "";
    const outFile = join(outDir, `${def.id}${suffix}.png`);
    const hasOverlay = !!(def.textOverlay && (concept.headline || concept.subhead));

    if (cards) {
      await renderInfoCard(outFile, { headline: concept.headline!, body: concept.subhead ?? "", width, height, index: i + 1, total: concepts.length, style, persona: opts.persona });
    } else {
      const rawFile = join(outDir, `${def.id}${suffix}.raw.png`);
      try {
        await imageProvider!.generate({ prompt: buildImagePrompt(concept, style, hasOverlay), outFile: rawFile, size: def.size });
        if (hasOverlay) {
          await renderTextOverlay(rawFile, outFile, { headline: concept.headline, subhead: concept.subhead, width, height, style, persona: opts.persona });
        } else {
          await normalizeImage(rawFile, outFile, width, height);
        }
      } finally {
        rmSync(rawFile, { force: true });
      }
    }

    const altText = cards ? [concept.headline, concept.subhead].filter(Boolean).join(". ") : await altTextProvider!.describe({ imageFile: outFile });
    writeFileSync(
      outFile.replace(/\.png$/, ".json"),
      JSON.stringify({ mode: opts.mode ?? "generated", style, concept, altText, size: def.size, generatedAt: new Date().toISOString() }, null, 2),
    );
    images.push({ file: outFile, altText, concept });
  }

  let pdfFile: string | undefined;
  if (def.bundlePdf && images.length > 1) {
    pdfFile = join(outDir, `${def.id}.pdf`);
    await buildPdfFromImages(
      images.map((img) => img.file),
      pdfFile,
    );
  }

  return { formatId: def.id, images, pdfFile };
}
