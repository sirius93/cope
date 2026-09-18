import assert from "node:assert/strict";
import test from "node:test";
import { createProviderRouter, type ProviderRouterConfig } from "./router.js";

const cfg: ProviderRouterConfig = {
  providers: {
    claude_cli: { kind: "text", protocol: "claude-code-cli" },
    codex_cli: { kind: "text+image", protocol: "codex-cli" },
    anthropic: {
      kind: "text",
      protocol: "anthropic",
      apiKeyEnv: "TEST_ANTHROPIC_KEY",
      model: "claude-sonnet-5",
    },
    openai: {
      kind: "text+image",
      protocol: "openai-compatible",
      apiKeyEnv: "TEST_OPENAI_KEY",
      baseUrl: "https://example.invalid/v1",
      textModel: "gpt-5",
      imageModel: "gpt-image-1",
    },
  },
  routing: {
    brief: "claude_cli",
    edit: "anthropic",
    image_generate: "codex_cli",
    alt_text: "openai",
  },
};

test("textProviderFor builds a CLI-agent provider with no API key required", () => {
  const router = createProviderRouter(cfg, { env: {} });
  assert.equal(router.textProviderFor("brief").id, "claude-code-cli");
});

test("textProviderFor throws a clear error when the API key env var is unset", () => {
  const router = createProviderRouter(cfg, { env: {} });
  assert.throws(() => router.textProviderFor("edit"), /Missing API key.*TEST_ANTHROPIC_KEY/s);
});

test("textProviderFor succeeds once the API key env var is set", () => {
  const router = createProviderRouter(cfg, { env: { TEST_ANTHROPIC_KEY: "sk-test" } });
  assert.equal(router.textProviderFor("edit").id, "anthropic");
});

test("textProviderFor throws for a stage with no routing entry", () => {
  const router = createProviderRouter(cfg, { env: {} });
  assert.throws(() => router.textProviderFor("unregistered_stage"), /No routing entry/);
});

test("textProviderFor honors a per-stage override", () => {
  const router = createProviderRouter(cfg, {
    env: { TEST_ANTHROPIC_KEY: "sk-test" },
    overrides: { brief: { providerId: "anthropic" } },
  });
  assert.equal(router.textProviderFor("brief").id, "anthropic");
});

test("imageProviderFor builds a codex-cli image provider with no API key required", () => {
  const router = createProviderRouter(cfg, { env: {} });
  assert.equal(router.imageProviderFor("image_generate").id, "codex-cli");
});

test("imageProviderFor builds an openai image provider once its key is set", () => {
  const router = createProviderRouter(cfg, { env: { TEST_OPENAI_KEY: "sk-test" } });
  assert.equal(router.imageProviderFor("alt_text").id, "openai");
});

test("imageProviderFor throws a clear error for a protocol with no image capability", () => {
  const router = createProviderRouter(cfg, { env: {} });
  assert.throws(() => router.imageProviderFor("brief"), /no image capability/);
});
