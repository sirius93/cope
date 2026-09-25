import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { FormatDefinition, FormatSpec, ImageFormatDefinition, ImageFormatSpec } from "./types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const specsDir = join(packageRoot, "specs");
const promptsDir = join(packageRoot, "prompts");
const imageSpecsDir = join(packageRoot, "image-specs");
const imagePromptsDir = join(packageRoot, "image-prompts");

function idsInDir(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));
}

export function listFormatIds(): string[] {
  return idsInDir(specsDir);
}

export function loadFormat(id: string): FormatDefinition {
  if (!listFormatIds().includes(id)) throw new Error(`Unknown text format: ${id}`);
  const spec = parse(readFileSync(join(specsDir, `${id}.yaml`), "utf-8")) as FormatSpec;
  const promptTemplate = readFileSync(join(promptsDir, `${id}.md`), "utf-8");
  return { ...spec, promptTemplate };
}

export function listImageFormatIds(): string[] {
  return idsInDir(imageSpecsDir);
}

export function loadImageFormat(id: string): ImageFormatDefinition {
  if (!listImageFormatIds().includes(id)) throw new Error(`Unknown image format: ${id}`);
  const spec = parse(readFileSync(join(imageSpecsDir, `${id}.yaml`), "utf-8")) as ImageFormatSpec;
  const promptTemplate = readFileSync(join(imagePromptsDir, `${id}.md`), "utf-8");
  return { ...spec, promptTemplate };
}

export function isImageFormat(id: string): boolean {
  return listImageFormatIds().includes(id);
}

export function listAllFormatIds(): string[] {
  return [...listFormatIds(), ...listImageFormatIds()];
}

export function loadBriefPromptTemplate(): string {
  return readFileSync(join(promptsDir, "brief.md"), "utf-8");
}

export function loadVoicePromptTemplate(): string {
  return readFileSync(join(promptsDir, "voice.md"), "utf-8");
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export * from "./types.js";
export * from "./validate.js";
