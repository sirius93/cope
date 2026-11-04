import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate, type ImageFormatDefinition } from "@cope/formats";
import type { ImageProvider, TextMessage, TextProvider } from "@cope/providers";
import { buildPdfFromImages, renderTextOverlay, renderInfoCard, infoCardPng, overlayPreviewPng, downscalePng, normalizeImage, IMAGE_STYLES, parseImageStyle, type ImageStyle, type Persona } from "@cope/render";
import { extractJsonBlock } from "./json.js";
import type { Brief, GeneratedImage, ImageAdaptResult, ImageConcept } from "./types.js";

function formatList(items: string[], fallback = "(none)"): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

// Fenced Markdown code blocks (``` or ~~~). URL sources get fences from stripHtml's <pre> handling.
export function extractCodeBlocks(source: string): string[] {
  return [...source.matchAll(/^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm)]
    .map((m) => m[2].replace(/\t/g, "  ").replace(/\s+$/, ""))
    .filter(Boolean);
}

const MAX_CODE_LINES = 12;
const MAX_CODE_COLUMNS = 60;

function parseSize(size: string): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) throw new Error(`Invalid size "${size}", expected "WIDTHxHEIGHT"`);
  return { width, height };
}

export interface ImagePlan {
  formatId: string;
  mode: "cards" | "generated";
  style: ImageStyle;
  slides: ImageConcept[];
}

// The editable source of truth for a format's images: images/<formatId>.plan.json.
export const planPath = (outDir: string, formatId: string) => join(outDir, `${formatId}.plan.json`);

// Validates and normalizes concepts, throwing on the first problem. Runs on model output
// (driving the repair loop) and again on every human edit before anything is rendered.
export function checkConcepts(
  def: ImageFormatDefinition,
  concepts: unknown,
  codeBlocks: string[],
  { requireImagePrompt }: { requireImagePrompt: boolean },
): ImageConcept[] {
  if (!Array.isArray(concepts) || concepts.length === 0) {
    throw new Error("Expected a non-empty JSON array of image concepts");
  }
  const min = def.slides?.min ?? 1;
  const max = def.slides?.max ?? 1;
  if (concepts.length < min || concepts.length > max) throw new Error(`Expected ${min}-${max} concepts, got ${concepts.length}`);
  // Indentation may be re-based for an excerpt; the content of each line may not change.
  const sourceLines = new Set(codeBlocks.flatMap((block) => block.split("\n").map((line) => line.trim())));
  for (const concept of concepts as ImageConcept[]) {
    if (!concept || typeof concept !== "object") throw new Error("Every concept must be an object");
    if ((concept.imagePrompt as unknown) == null) concept.imagePrompt = "";
    if (typeof concept.imagePrompt !== "string") throw new Error("imagePrompt must be a string");
    if (!def.slides) delete concept.code;
    for (const key of ["headline", "subhead", "code"] as const) {
      if (concept[key] === null || concept[key] === "") delete concept[key];
      if (concept[key] !== undefined && typeof concept[key] !== "string") throw new Error(`${key} must be a string`);
    }
    if (requireImagePrompt && !concept.code && !concept.imagePrompt.trim()) throw new Error("Every concept needs a non-empty imagePrompt string");
    if (concept.negativeCues !== undefined && (!Array.isArray(concept.negativeCues) || concept.negativeCues.some((cue) => typeof cue !== "string"))) throw new Error("negativeCues must be strings");
    if (!def.slides && !requireImagePrompt && !concept.headline?.trim()) throw new Error("A card needs a headline");
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
      if (concept.code !== undefined) {
        const lines = concept.code.replace(/\t/g, "  ").replace(/\s+$/, "").split("\n");
        if (lines.length > MAX_CODE_LINES || lines.some((line) => Array.from(line).length > MAX_CODE_COLUMNS)) {
          throw new Error(`Slide code must be at most ${MAX_CODE_LINES} lines of at most ${MAX_CODE_COLUMNS} characters; excerpt fewer lines`);
        }
        const invented = lines.find((line) => line.trim() && !sourceLines.has(line.trim()));
        if (invented !== undefined) throw new Error(`Slide code must be copied exactly from the source's code blocks; not found: ${invented.trim()}`);
      }
    }
  }
  return concepts as ImageConcept[];
}

async function generateConcepts(
  brief: Brief,
  def: ImageFormatDefinition,
  provider: TextProvider,
  maxRepairPasses: number,
  style: ImageStyle,
  codeBlocks: string[],
): Promise<ImageConcept[]> {
  const prompt = renderTemplate(def.promptTemplate, {
    code: codeBlocks.length ? codeBlocks.map((block, i) => `[${i + 1}]\n${block}`).join("\n\n") : "(none — set code to null on every slide)",
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
      return checkConcepts(def, JSON.parse(extractJsonBlock(res.text, "[", "]")), codeBlocks, { requireImagePrompt: true });
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

type ImageOpts = { maxRepairPasses?: number; mode?: "cards" | "generated"; style?: ImageStyle; persona?: Persona; reserveImages?: (count: number) => void; source?: string };

// Step one: write the copy (and, in generated mode, art direction) for every slide.
export async function planImageFormat(
  brief: Brief,
  def: ImageFormatDefinition,
  conceptProvider: TextProvider | undefined, // image_prompt stage
  opts: ImageOpts = {},
): Promise<ImagePlan> {
  const mode = opts.mode ?? "generated";
  const style = parseImageStyle(opts.style ?? "editorial");
  if (def.slides && !conceptProvider) throw new Error("Carousel generation requires the image_prompt text provider");
  if (mode === "generated" && !conceptProvider) throw new Error("Generated mode requires image and text providers");
  const slides = mode === "cards" && !def.slides
    ? informationConcepts(brief, def)
    : await generateConcepts(brief, def, conceptProvider!, opts.maxRepairPasses ?? 2, style, extractCodeBlocks(opts.source ?? ""));
  return { formatId: def.id, mode, style, slides };
}

// Step two: render exactly what the plan says. The plan is re-checked first, since a
// person may have edited it, and saved beside the images it produced.
export async function renderImagePlan(
  def: ImageFormatDefinition,
  plan: ImagePlan,
  imageProvider: ImageProvider | undefined, // image_generate stage
  altTextProvider: ImageProvider | undefined, // alt_text stage
  outDir: string,
  opts: ImageOpts = {},
): Promise<ImageAdaptResult> {
  const cards = plan.mode === "cards";
  const style = parseImageStyle(plan.style);
  const concepts = checkConcepts(def, plan.slides, extractCodeBlocks(opts.source ?? ""), { requireImagePrompt: !cards });
  if (!cards && concepts.some((c) => !c.code) && (!imageProvider || !altTextProvider)) throw new Error("Generated mode requires image and text providers");
  opts.reserveImages?.(concepts.length);
  const { width, height } = parseSize(def.size);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(planPath(outDir, def.id), JSON.stringify({ ...plan, slides: concepts }, null, 2));
  const images: GeneratedImage[] = [];

  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i];
    const suffix = concepts.length > 1 ? `-${i + 1}` : "";
    const outFile = join(outDir, `${def.id}${suffix}.png`);
    const hasOverlay = !!(def.textOverlay && (concept.headline || concept.subhead));

    // Code slides are always local cards: generated art can't hold legible code.
    const card = cards || !!concept.code;
    if (card) {
      await renderInfoCard(outFile, { headline: concept.headline!, body: concept.subhead ?? "", code: concept.code, width, height, index: i + 1, total: concepts.length, style, persona: opts.persona });
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

    const altText = card ? [concept.headline, concept.subhead, concept.code && `Code:\n${concept.code}`].filter(Boolean).join(". ") : await altTextProvider!.describe({ imageFile: outFile });
    writeFileSync(
      outFile.replace(/\.png$/, ".json"),
      JSON.stringify({ mode: plan.mode, style, concept, altText, size: def.size, generatedAt: new Date().toISOString() }, null, 2),
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

// A fast, local preview of one slide (half size) for the studio's editor. Generated-mode
// slides show their caption panel over a flat placeholder where the artwork will go.
export async function previewSlide(def: ImageFormatDefinition, plan: ImagePlan, index: number, persona?: Persona): Promise<Buffer> {
  const concept = plan.slides[index];
  if (!concept) throw new Error(`No slide ${index + 1}`);
  const { width, height } = parseSize(def.size);
  const style = parseImageStyle(plan.style);
  const png = plan.mode === "cards" || concept.code
    ? await infoCardPng({ headline: concept.headline ?? "", body: concept.subhead ?? "", code: concept.code, width, height, index: index + 1, total: plan.slides.length, style, persona })
    : await overlayPreviewPng({ headline: concept.headline, subhead: concept.subhead, width, height, style, persona });
  return downscalePng(png, Math.round(width / 2));
}

export async function adaptImageFormat(
  brief: Brief,
  def: ImageFormatDefinition,
  conceptProvider: TextProvider | undefined, // image_prompt stage
  imageProvider: ImageProvider | undefined, // image_generate stage
  altTextProvider: ImageProvider | undefined, // alt_text stage
  outDir: string,
  opts: ImageOpts = {},
): Promise<ImageAdaptResult> {
  if (opts.mode !== "cards" && (!conceptProvider || !imageProvider || !altTextProvider)) throw new Error("Generated mode requires image and text providers");
  const plan = await planImageFormat(brief, def, conceptProvider, opts);
  return renderImagePlan(def, plan, imageProvider, altTextProvider, outDir, opts);
}
