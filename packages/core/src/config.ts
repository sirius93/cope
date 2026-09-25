import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parseImageStyle, type ImageStyle, type Persona } from "@cope/render";
import type { ProviderRouterConfig } from "@cope/providers";

const srcDir = dirname(fileURLToPath(import.meta.url));
const bundledDefaultsPath = join(srcDir, "../../../config/defaults.yaml");

export interface CopeConfig extends ProviderRouterConfig {
  limits: {
    maxRepairPasses: number;
    maxImagesPerRun: number;
  };
  images: { mode: "cards" | "generated"; style: ImageStyle };
  voice: {
    file: string;
  };
}

export function loadConfig(cwd: string = process.cwd()): CopeConfig {
  const localPath = join(cwd, "cope.config.yaml");
  const defaults = parse(readFileSync(bundledDefaultsPath, "utf-8"));
  const local = existsSync(localPath) ? parse(readFileSync(localPath, "utf-8")) : {};
  const object = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (!object(local)) throw new Error("cope.config.yaml must contain a mapping");
  for (const key of Object.keys(local)) {
    if (!(key in defaults) || !object(local[key])) throw new Error(`Invalid config section: ${key}`);
  }
  const config = { ...defaults };
  for (const key of Object.keys(local)) config[key] = { ...defaults[key], ...local[key] };
  for (const [id, entry] of Object.entries(local.providers ?? {})) {
    if (!object(entry)) throw new Error(`Invalid provider: ${id}`);
    config.providers[id] = { ...defaults.providers[id], ...entry };
  }
  if ("maxTokensPerRun" in config.limits) {
    throw new Error("maxTokensPerRun is unsupported by CLI providers; remove it and use provider-side spending limits");
  }
  for (const [key, value] of Object.entries(config.limits)) {
    if (!["maxRepairPasses", "maxImagesPerRun"].includes(key) || !Number.isSafeInteger(value) || (value as number) < 0) {
      throw new Error(`Invalid non-negative integer limit: ${key}`);
    }
  }
  if (config.limits.maxRepairPasses > 10) throw new Error("maxRepairPasses must be at most 10");
  if (!["cards", "generated"].includes(config.images.mode)) throw new Error("images.mode must be cards or generated");
  config.images.style = parseImageStyle(config.images.style);
  if (typeof config.voice.file !== "string") throw new Error("voice.file must be a string");
  for (const [id, entry] of Object.entries(config.providers) as [string, Record<string, unknown>][]) {
    if (!object(entry) || !["anthropic", "openai-compatible", "claude-code-cli", "codex-cli"].includes(String(entry.protocol))) {
      throw new Error(`Invalid provider protocol: ${id}`);
    }
    if (!["text", "text+image"].includes(String(entry.kind))) throw new Error(`Invalid provider kind: ${id}`);
    for (const key of ["baseUrl", "apiKeyEnv", "model", "textModel", "imageModel"]) {
      if (entry[key] !== undefined && (typeof entry[key] !== "string" || !entry[key].trim())) throw new Error(`Invalid ${id}.${key}`);
    }
    if (entry.baseUrl && !/^https?:\/\//.test(String(entry.baseUrl))) throw new Error(`Invalid baseUrl: ${id}`);
  }
  for (const [stage, id] of Object.entries(config.routing)) {
    if (typeof id !== "string" || !Object.hasOwn(config.providers, id)) throw new Error(`Unknown provider for stage: ${stage}`);
  }
  return config as CopeConfig;
}

export function loadVoice(config: CopeConfig, cwd: string = process.cwd()): string {
  const path = join(cwd, config.voice.file);
  if (!existsSync(path)) return "";
  return `Brand voice:\n${readFileSync(path, "utf-8")}`;
}

// Brand identity for image formats: logo, colors, handle, website. Optional — a project
// with no persona/persona.yaml just renders undecorated cards, same as today.
export function loadPersona(cwd: string = process.cwd()): Persona | undefined {
  const dir = join(cwd, "persona");
  const path = join(dir, "persona.yaml");
  if (!existsSync(path)) return undefined;
  const raw = parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const persona: Persona = {};
  for (const key of ["primaryColor", "secondaryColor", "website", "twitter"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string" || !raw[key].trim()) throw new Error(`persona.${key} must be a non-empty string`);
    persona[key] = raw[key] as string;
  }
  if (raw.logo !== undefined) {
    if (typeof raw.logo !== "string" || !raw.logo.trim()) throw new Error("persona.logo must be a non-empty string");
    const logoFile = join(dir, raw.logo);
    if (!existsSync(logoFile)) throw new Error(`persona.logo file not found: ${logoFile}`);
    persona.logoFile = logoFile;
  }
  return persona;
}

// ponytail: hand-rolled instead of the `dotenv` package — it's a dozen lines and this is
// the only place we need it.
export function loadEnvFile(path?: string): void {
  const envPath = path ?? join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
