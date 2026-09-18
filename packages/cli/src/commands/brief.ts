import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { generateBrief, ingest, loadConfig, loadEnvFile, loadVoice, slugify } from "@cope/core";
import { createProviderRouter } from "@cope/providers";
import { writeBrief } from "../output.js";

export async function runBriefCommand(inputPath: string, cwd: string = process.cwd()): Promise<void> {
  loadEnvFile(join(cwd, ".env"));
  const config = loadConfig(cwd);
  const router = createProviderRouter(config);
  const { text: source } = await ingest(inputPath);
  const voice = loadVoice(config, cwd);

  const brief = await generateBrief(
    source,
    router.textProviderFor("brief"),
    voice,
    config.limits.maxRepairPasses,
  );
  mkdirSync(join(cwd, "out"), { recursive: true });
  const dir = mkdtempSync(join(cwd, "out", `${slugify(brief.coreClaim)}-`));
  writeBrief(dir, brief);

  console.log(JSON.stringify(brief, null, 2));
  console.log(`\nWrote ${dir}/brief.json`);
}
