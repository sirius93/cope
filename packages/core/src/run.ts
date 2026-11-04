import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isImageFormat, listAllFormatIds, loadFormat, loadImageFormat } from "@cope/formats";
import { createProviderRouter } from "@cope/providers";
import { generateBrief } from "./brief.js";
import { type CopeConfig, loadPersona, loadVoice } from "./config.js";
import { adaptImageFormat, planImageFormat, planPath, renderImagePlan, type ImagePlan } from "./image-pipeline.js";
import { ingest } from "./ingest.js";
import { adaptFormat } from "./pipeline.js";
import { slugify } from "./slug.js";
import type { AdaptResult, Brief, ImageAdaptResult, RunResult } from "./types.js";

// Formats that need the full source text (not just the compressed brief) — blog is long
// enough that the brief alone would lose real detail.
const FULL_SOURCE_FORMATS = new Set(["blog_md"]);

// Rejects unknown formats and resolves every provider the run will need, before anything
// is spent on the brief.
export function preflight(formatIds: string[], config: CopeConfig): void {
  for (const id of formatIds) {
    if (!listAllFormatIds().includes(id)) throw new Error(`Unknown format: ${id}`);
  }
  const router = createProviderRouter(config);
  const cards = config.images.mode === "cards";
  router.textProviderFor("brief");
  for (const id of formatIds) {
    if (!isImageFormat(id)) router.textProviderFor(loadFormat(id).kind);
    else if (!cards || loadImageFormat(id).slides) {
      router.textProviderFor("image_prompt");
    }
    if (isImageFormat(id) && !cards) {
      router.imageProviderFor("image_generate");
      router.imageProviderFor("alt_text");
    }
  }
}

export async function runCope(
  inputPath: string,
  formatIds: string[],
  config: CopeConfig,
  cwd: string = process.cwd(),
): Promise<RunResult> {
  formatIds = [...new Set(formatIds)];
  preflight(formatIds, config);
  const { text: source } = await ingest(inputPath);
  const draft = await draftRun(source, formatIds.filter((id) => !isImageFormat(id)), config, cwd);
  const imageResults = await renderImages(join(cwd, "out", draft.slug), formatIds.filter(isImageFormat), config, cwd);
  return { ...draft, imageResults };
}

// Phase one: brief + text formats. Saves the brief and source in the run folder so
// renderImages can run later (e.g. after review), against the same material.
export async function draftRun(
  source: string,
  textFormatIds: string[],
  config: CopeConfig,
  cwd: string = process.cwd(),
): Promise<RunResult> {
  const router = createProviderRouter(config);
  const voice = loadVoice(config, cwd);
  const brief = await generateBrief(source, router.textProviderFor("brief"), voice, config.limits.maxRepairPasses);
  mkdirSync(join(cwd, "out"), { recursive: true });
  const runDir = mkdtempSync(join(cwd, "out", `${slugify(brief.coreClaim)}-`));
  writeFileSync(join(runDir, "brief.json"), JSON.stringify(brief, null, 2));
  writeFileSync(join(runDir, "source.txt"), source);

  const results: AdaptResult[] = [];
  for (const formatId of textFormatIds) {
    try {
      const def = loadFormat(formatId);
      results.push(await adaptFormat(brief, def, router.textProviderFor(def.kind), {
        source: FULL_SOURCE_FORMATS.has(def.id) ? source : undefined,
        voice,
        maxRepairPasses: config.limits.maxRepairPasses,
      }));
    } catch (err) {
      results.push({ formatId, output: "", valid: false, repairPasses: 0,
        violations: [err instanceof Error ? err.message : String(err)] });
    }
  }
  return { slug: basename(runDir), brief, results, imageResults: [] };
}

// Phase two: image formats, from the run folder's brief.json and source.txt.
export async function renderImages(
  runDir: string,
  imageFormatIds: string[],
  config: CopeConfig,
  cwd: string = process.cwd(),
): Promise<ImageAdaptResult[]> {
  if (!imageFormatIds.length) return [];
  const { router, cards, source, persona, reserveImages } = imageContext(runDir, config, cwd);
  const brief = JSON.parse(readFileSync(join(runDir, "brief.json"), "utf-8")) as Brief;

  const imageResults: ImageAdaptResult[] = [];
  for (const formatId of imageFormatIds) {
    const def = loadImageFormat(formatId);
    try {
      imageResults.push(await adaptImageFormat(
        brief,
        def,
        cards && !def.slides ? undefined : router.textProviderFor("image_prompt"),
        cards ? undefined : router.imageProviderFor("image_generate"),
        cards ? undefined : router.imageProviderFor("alt_text"),
        join(runDir, "images"),
        { maxRepairPasses: config.limits.maxRepairPasses, mode: config.images.mode, style: config.images.style, persona, reserveImages, source },
      ));
    } catch (err) {
      // One format's provider hiccup (network, CLI error) shouldn't abort a run that
      // also asked for other formats — same resilience the text path gets from its
      // repair loop, just without a "violations" concept to repair against.
      imageResults.push({ formatId, images: [], error: err instanceof Error ? err.message : String(err) });
    }
  }
  return imageResults;
}

function imageContext(runDir: string, config: CopeConfig, cwd: string) {
  const sourceFile = join(runDir, "source.txt");
  let reservedImages = 0;
  return {
    router: createProviderRouter(config),
    cards: config.images.mode === "cards",
    source: existsSync(sourceFile) ? readFileSync(sourceFile, "utf-8") : undefined,
    persona: loadPersona(cwd),
    reserveImages: (count: number) => {
      if (reservedImages + count > config.limits.maxImagesPerRun) throw new Error("maxImagesPerRun exceeded; reduce formats/slides or raise the limit");
      reservedImages += count;
    },
  };
}

// Studio step one: write images/<format>.plan.json for each format, for a person to edit.
// A format whose plan fails is reported in `failed` instead of blocking the others.
export async function planImages(
  runDir: string,
  imageFormatIds: string[],
  config: CopeConfig,
  cwd: string = process.cwd(),
): Promise<{ planned: string[]; failed: ImageAdaptResult[] }> {
  const ctx = imageContext(runDir, config, cwd);
  const brief = JSON.parse(readFileSync(join(runDir, "brief.json"), "utf-8")) as Brief;
  const outDir = join(runDir, "images");
  mkdirSync(outDir, { recursive: true });
  const planned: string[] = [];
  const failed: ImageAdaptResult[] = [];
  for (const formatId of imageFormatIds) {
    const def = loadImageFormat(formatId);
    try {
      const plan = await planImageFormat(brief, def, ctx.cards && !def.slides ? undefined : ctx.router.textProviderFor("image_prompt"),
        { maxRepairPasses: config.limits.maxRepairPasses, mode: config.images.mode, style: config.images.style, source: ctx.source });
      writeFileSync(planPath(outDir, formatId), JSON.stringify(plan, null, 2));
      planned.push(formatId);
    } catch (err) {
      failed.push({ formatId, images: [], error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { planned, failed };
}

// Studio step two: render each format from its (possibly edited) plan file.
export async function renderPlans(
  runDir: string,
  imageFormatIds: string[],
  config: CopeConfig,
  cwd: string = process.cwd(),
): Promise<ImageAdaptResult[]> {
  const ctx = imageContext(runDir, config, cwd);
  const outDir = join(runDir, "images");
  const results: ImageAdaptResult[] = [];
  for (const formatId of imageFormatIds) {
    try {
      const plan = JSON.parse(readFileSync(planPath(outDir, formatId), "utf-8")) as ImagePlan;
      const generated = plan.mode === "generated";
      results.push(await renderImagePlan(loadImageFormat(formatId), plan,
        generated ? ctx.router.imageProviderFor("image_generate") : undefined,
        generated ? ctx.router.imageProviderFor("alt_text") : undefined,
        outDir, { persona: ctx.persona, reserveImages: ctx.reserveImages, source: ctx.source }));
    } catch (err) {
      results.push({ formatId, images: [], error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
