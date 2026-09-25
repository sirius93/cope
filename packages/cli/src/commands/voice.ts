import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { learnVoice, loadConfig, loadEnvFile } from "@cope/core";
import { createProviderRouter } from "@cope/providers";

export async function runVoiceCommand(sources: string[], opts: { force?: boolean } = {}, cwd: string = process.cwd()): Promise<void> {
  if (sources.length === 0) throw new Error("Usage: cope voice <url|rss-feed-url|file>... [--force]");
  loadEnvFile(join(cwd, ".env"));
  const config = loadConfig(cwd);
  const router = createProviderRouter(config);
  const voicePath = join(cwd, config.voice.file);

  if (existsSync(voicePath) && !opts.force) {
    throw new Error(`${voicePath} already exists — pass --force to overwrite it`);
  }
  const existingVoice = existsSync(voicePath) ? readFileSync(voicePath, "utf-8") : "";

  const guide = await learnVoice(sources, router.textProviderFor("voice_learn"), existingVoice);
  writeFileSync(voicePath, `${guide}\n`);
  console.log(`Wrote ${voicePath} from ${sources.length} source(s):`);
  for (const source of sources) console.log(`  - ${source}`);
}
