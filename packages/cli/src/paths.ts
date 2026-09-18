import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = dirname(fileURLToPath(import.meta.url)); // packages/cli/src
export const repoRoot = join(srcDir, "../../..");
export const bundledEnvExample = join(repoRoot, ".env.example");
export const bundledDefaultsConfig = join(repoRoot, "config/defaults.yaml");
