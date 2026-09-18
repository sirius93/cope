import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdaptResult, Brief, ImageAdaptResult } from "@cope/core";

export function outDir(cwd: string, slug: string): string {
  return join(cwd, "out", slug);
}

export function writeBrief(dir: string, brief: Brief): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brief.json"), JSON.stringify(brief, null, 2));
}

function extensionFor(result: AdaptResult): string {
  if (Array.isArray(result.output)) return ".json";
  return result.formatId === "blog_md" ? ".md" : ".txt";
}

// Text outputs are written here; image files are already on disk by the time this runs —
// adaptImageFormat writes them directly (see core/src/image-pipeline.ts) since an
// ImageProvider needs a real path up front, not a string to write later.
export function writeResults(dir: string, results: AdaptResult[], imageResults: ImageAdaptResult[]): void {
  mkdirSync(dir, { recursive: true });
  for (const result of results) {
    const content = Array.isArray(result.output)
      ? JSON.stringify(result.output, null, 2)
      : result.output;
    const target = result.valid ? dir : join(dir, "invalid");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, `${result.formatId}${extensionFor(result)}`), content);
  }

  writeFileSync(
    join(dir, "run-summary.json"),
    JSON.stringify(
      {
        text: results.map(({ formatId, valid, violations, repairPasses }) => ({
          formatId,
          valid,
          violations,
          repairPasses,
        })),
        images: imageResults.map(({ formatId, images, pdfFile, error }) => ({
          formatId,
          images: images.map(({ file, altText }) => ({ file, altText })),
          ...(pdfFile ? { pdfFile } : {}),
          ...(error ? { error } : {}),
        })),
      },
      null,
      2,
    ),
  );
}
