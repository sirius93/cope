import { join } from "node:path";
import { loadConfig, loadEnvFile, parseImageStyle, runCope } from "@cope/core";
import { listAllFormatIds } from "@cope/formats";
import { outDir, writeBrief, writeResults } from "../output.js";

export async function runRunCommand(
  inputPath: string,
  opts: { formats?: string[]; all?: boolean; imageMode?: string; imageStyle?: string },
  cwd: string = process.cwd(),
): Promise<void> {
  loadEnvFile(join(cwd, ".env"));
  const config = loadConfig(cwd);
  if (opts.imageMode !== undefined) {
    if (opts.imageMode !== "cards" && opts.imageMode !== "generated") throw new Error("--image-mode must be cards or generated");
    config.images.mode = opts.imageMode;
  }
  if (opts.imageStyle !== undefined) config.images.style = parseImageStyle(opts.imageStyle);
  const formatIds = opts.all ? listAllFormatIds() : (opts.formats ?? []);
  if (formatIds.length === 0) {
    throw new Error("No formats requested. Use -f <id,id,...> or --all.");
  }

  const result = await runCope(inputPath, formatIds, config, cwd);
  const dir = outDir(cwd, result.slug);
  writeBrief(dir, result.brief);
  writeResults(dir, result.results, result.imageResults);

  console.log(`Wrote ${dir}/`);
  for (const r of result.results) {
    const status = r.valid
      ? "ok"
      : `FAILED (${r.violations.length} violation(s) after ${r.repairPasses} repair pass(es))`;
    console.log(`  ${r.formatId}: ${status}`);
  }
  for (const r of result.imageResults) {
    const pdfNote = r.pdfFile ? `, ${r.pdfFile}` : "";
    const status = r.error ? `FAILED (${r.error})` : `ok (${r.images.length} image(s)${pdfNote})`;
    console.log(`  ${r.formatId}: ${status}`);
  }

  const failed = result.results.some((r) => !r.valid) || result.imageResults.some((r) => r.error);
  if (failed) {
    process.exitCode = 1;
  }
}
