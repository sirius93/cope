import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bundledDefaultsConfig, bundledEnvExample } from "../paths.js";

export function runInit(targetDir: string): void {
  const configPath = join(targetDir, "cope.config.yaml");
  const envPath = join(targetDir, ".env.example");

  for (const [dest, src] of [
    [configPath, bundledDefaultsConfig],
    [envPath, bundledEnvExample],
  ] as const) {
    if (existsSync(dest)) {
      console.log(`skip  ${dest} (already exists)`);
    } else {
      copyFileSync(src, dest);
      console.log(`wrote ${dest}`);
    }
  }
  console.log("\nNext: authenticate the configured local CLI, or copy .env.example to .env for API providers.");
}
