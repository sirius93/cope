import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, runCope } from "@cope/core";
import { runRunCommand } from "./commands/run.js";
import { writeResults } from "./output.js";

const brief = { coreClaim: "A repeatable claim", keyPoints: ["One", "Two"], audience: "Developers",
  tone: "Direct", cta: null, quotableLines: [], immutableFacts: [], visualConcepts: [] };

test("partial config merges defaults and rejects invalid or unsupported limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "cope-config-test-"));
  try {
    writeFileSync(join(dir, "cope.config.yaml"), "limits:\n  maxImagesPerRun: 1\nproviders:\n  openai:\n    textModel: test-model\n");
    const cfg = loadConfig(dir);
    assert.equal(cfg.limits.maxImagesPerRun, 1);
    assert.equal(cfg.providers.openai.protocol, "openai-compatible");
    assert.equal(cfg.images.mode, "cards");
    assert.equal(cfg.images.style, "editorial");
    writeFileSync(join(dir, "cope.config.yaml"), "images:\n  style: sketch\n");
    assert.equal(loadConfig(dir).images.style, "sketch");
    writeFileSync(join(dir, "cope.config.yaml"), "images:\n  style: unknown\n");
    assert.throws(() => loadConfig(dir), /Unknown image style/);
    for (const value of ["maxImagesPerRun: -1", "maxRepairPasses: 100", "maxTokensPerRun: 100"]) {
      writeFileSync(join(dir, "cope.config.yaml"), `limits:\n  ${value}\n`);
      assert.throws(() => loadConfig(dir));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run isolates outputs, keeps text successes after provider failure and enforces total image budget", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cope-run-test-"));
  const envKey = "COPE_TEST_KEY";
  const previousKey = process.env[envKey];
  process.env[envKey] = "test";
  try {
    writeFileSync(join(dir, "source.txt"), "Source notes");
    const cfg = loadConfig(dir);
    cfg.providers.test = { kind: "text+image", protocol: "openai-compatible", baseUrl: "https://example.invalid/v1", apiKeyEnv: envKey, textModel: "test" };
    cfg.routing.brief = cfg.routing.shortform = cfg.routing.midform = "test";
    cfg.limits.maxImagesPerRun = 1;
    let calls = 0;
    void globalThis.fetch; // Materialize Node 20's lazy fetch before mocking.
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (calls === 3) return new Response("unauthorized", { status: 401 });
      const content = calls === 1 || calls === 4 ? JSON.stringify(brief) : "A valid short post.";
      return Response.json({ choices: [{ message: { content } }] });
    });
    const first = await runCope(join(dir, "source.txt"), ["x_post", "linkedin_post", "og_image", "quote_card"], cfg, dir);
    assert.equal(first.results[0].valid, true);
    assert.equal(first.results[1].valid, false);
    assert.equal(calls, 3, "401 must not be retried; cards must not call any provider");
    assert.equal(first.imageResults[0].images.length, 1);
    assert.match(first.imageResults[1].error!, /maxImagesPerRun/);
    const firstDir = join(dir, "out", first.slug);
    writeResults(firstDir, first.results, first.imageResults);
    assert.ok(existsSync(join(firstDir, "x_post.txt")));
    assert.ok(existsSync(join(firstDir, "invalid", "linkedin_post.txt")));
    assert.ok(!existsSync(join(firstDir, "linkedin_post.txt")));
    const second = await runCope(join(dir, "source.txt"), ["og_image"], cfg, dir);
    assert.notEqual(first.slug, second.slug);
    assert.equal(readFileSync(join(firstDir, "x_post.txt"), "utf8"), "A valid short post.");
    await assert.rejects(runCope(join(dir, "source.txt"), ["../bad"], cfg, dir), /Unknown format/);
    assert.equal(calls, 4);
  } finally {
    if (previousKey === undefined) delete process.env[envKey]; else process.env[envKey] = previousKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI rejects an unknown image style before reading the source or invoking providers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cope-style-cli-test-"));
  try {
    await assert.rejects(runRunCommand("missing-source", { formats: ["og_image"], imageStyle: "invalid" }, dir), /Unknown image style/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("card-mode carousel uses one copy call and no image or vision calls", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cope-carousel-routing-test-"));
  const envKey = "COPE_CAROUSEL_TEST_KEY";
  const previousKey = process.env[envKey];
  process.env[envKey] = "test";
  try {
    writeFileSync(join(dir, "source.txt"), "Source notes");
    const cfg = loadConfig(dir);
    cfg.providers.test = { kind: "text+image", protocol: "openai-compatible", baseUrl: "https://example.invalid/v1", apiKeyEnv: envKey, textModel: "test" };
    cfg.routing.brief = cfg.routing.image_prompt = "test";
    let calls = 0;
    void globalThis.fetch;
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      calls++;
      assert.ok(String(url).endsWith("/chat/completions"));
      const content = calls === 1 ? JSON.stringify(brief) : JSON.stringify([
        { headline: "One Source Becomes Every Required Format", subhead: "COPE turns one source into several reviewed formats.", imagePrompt: "cover" },
        { headline: "Clear Summaries Preserve Every Important Detail", subhead: "Each point remains complete while the title stays concise.", imagePrompt: "detail" },
        { headline: "Review Every Result Before You Publish", subhead: "Check the completed carousel against the original source.", imagePrompt: "closing" },
      ]);
      return Response.json({ choices: [{ message: { content } }] });
    });
    const result = await runCope(join(dir, "source.txt"), ["carousel"], cfg, dir);
    assert.equal(calls, 2);
    assert.equal(result.imageResults[0].images.length, 3);
    assert.equal(result.imageResults[0].error, undefined);
  } finally {
    if (previousKey === undefined) delete process.env[envKey]; else process.env[envKey] = previousKey;
    rmSync(dir, { recursive: true, force: true });
  }
});
