import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isImageFormat, listAllFormatIds, loadFormat, loadImageFormat } from "@cope/formats";
import { createProviderRouter } from "@cope/providers";
import { generateBrief } from "./brief.js";
import { type CopeConfig, loadPersona, loadVoice } from "./config.js";
import { adaptImageFormat } from "./image-pipeline.js";
import { ingest } from "./ingest.js";
import { adaptFormat } from "./pipeline.js";
import { slugify } from "./slug.js";
import type { AdaptResult, ImageAdaptResult, RunResult } from "./types.js";

// Formats that need the full source text (not just the compressed brief) — blog is long
// enough that the brief alone would lose real detail.
const FULL_SOURCE_FORMATS = new Set(["blog_md"]);

export async function runCope(
  inputPath: string,
  formatIds: string[],
  config: CopeConfig,
  cwd: string = process.cwd(),
): Promise<RunResult> {
  formatIds = [...new Set(formatIds)];
  for (const id of formatIds) {
    if (!listAllFormatIds().includes(id)) throw new Error(`Unknown format: ${id}`);
  }
  const router = createProviderRouter(config);
  const cards = config.images.mode === "cards";
  // Resolve selected providers before spending anything on the brief.
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
  let reservedImages = 0;
  const reserveImages = (count: number) => {
    if (reservedImages + count > config.limits.maxImagesPerRun) throw new Error("maxImagesPerRun exceeded; reduce formats/slides or raise the limit");
    reservedImages += count;
  };
  const { text: source } = await ingest(inputPath);
  const voice = loadVoice(config, cwd);
  const persona = loadPersona(cwd);

  const brief = await generateBrief(
    source,
    router.textProviderFor("brief"),
    voice,
    config.limits.maxRepairPasses,
  );
  mkdirSync(join(cwd, "out"), { recursive: true });
  const runDir = mkdtempSync(join(cwd, "out", `${slugify(brief.coreClaim)}-`));
  const slug = basename(runDir);
  writeFileSync(join(runDir, "brief.json"), JSON.stringify(brief, null, 2));
  const imageOutDir = join(runDir, "images");

  const results: AdaptResult[] = [];
  const imageResults: ImageAdaptResult[] = [];

  for (const formatId of formatIds) {
    if (isImageFormat(formatId)) {
      const def = loadImageFormat(formatId);
      try {
        const result = await adaptImageFormat(
          brief,
          def,
          cards && !def.slides ? undefined : router.textProviderFor("image_prompt"),
          cards ? undefined : router.imageProviderFor("image_generate"),
          cards ? undefined : router.imageProviderFor("alt_text"),
          imageOutDir,
          { maxRepairPasses: config.limits.maxRepairPasses, mode: config.images.mode, style: config.images.style, persona, reserveImages },
        );
        imageResults.push(result);
      } catch (err) {
        // One format's provider hiccup (network, CLI error) shouldn't abort a run that
        // also asked for other formats — same resilience the text path gets from its
        // repair loop, just without a "violations" concept to repair against.
        imageResults.push({
          formatId,
          images: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
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
  }

  return { slug, brief, results, imageResults };
}
