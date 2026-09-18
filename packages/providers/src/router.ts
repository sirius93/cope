import { createAnthropicProvider } from "./anthropic.js";
import { createClaudeCodeCliProvider } from "./claude-code-cli.js";
import { createCodexCliProvider } from "./codex-cli.js";
import { createCodexCliImageProvider } from "./codex-cli-image.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";
import { createOpenAIImageProvider } from "./openai-image.js";
import type { ImageProvider, TextProvider } from "./types.js";

export type CliProtocol = "claude-code-cli" | "codex-cli";

export interface ProviderEntry {
  kind: "text" | "text+image";
  protocol: "anthropic" | "openai-compatible" | CliProtocol;
  baseUrl?: string;
  apiKeyEnv?: string; // not needed for a CLI-agent protocol
  model?: string; // anthropic-style / CLI-agent model override
  textModel?: string; // openai-compatible-style
  imageModel?: string; // openai-compatible-style, for image generation
}

const CLI_TEXT_FACTORIES: Record<CliProtocol, (model?: string) => TextProvider> = {
  "claude-code-cli": (model) => createClaudeCodeCliProvider({ model }),
  "codex-cli": (model) => createCodexCliProvider({ model }),
};

// Only codex-cli has an image_gen tool — claude-code-cli has no image capability, so it's
// absent here and routing an image stage to it is a config error (see buildImage below).
const CLI_IMAGE_FACTORIES: Partial<Record<CliProtocol, () => ImageProvider>> = {
  "codex-cli": () => createCodexCliImageProvider(),
};

export interface ProviderRouterConfig {
  providers: Record<string, ProviderEntry>;
  routing: Record<string, string>; // stage id -> provider id
}

export interface ProviderOverride {
  providerId: string;
  model?: string;
}

export interface ProviderRouter {
  textProviderFor(stage: string): TextProvider;
  imageProviderFor(stage: string): ImageProvider;
}

export function createProviderRouter(
  cfg: ProviderRouterConfig,
  opts: { env?: NodeJS.ProcessEnv; overrides?: Record<string, ProviderOverride> } = {},
): ProviderRouter {
  const env = opts.env ?? process.env;
  const overrides = opts.overrides ?? {};
  const textBuilt = new Map<string, TextProvider>();
  const imageBuilt = new Map<string, ImageProvider>();

  function getEntry(providerId: string): ProviderEntry {
    const entry = cfg.providers[providerId];
    if (!entry) {
      throw new Error(`Unknown provider "${providerId}" — check config.providers`);
    }
    return entry;
  }

  function requireApiKey(providerId: string, entry: ProviderEntry): string {
    const apiKey = entry.apiKeyEnv && env[entry.apiKeyEnv];
    if (!apiKey) {
      throw new Error(
        `Missing API key for provider "${providerId}": set ${entry.apiKeyEnv} in your environment or .env`,
      );
    }
    return apiKey;
  }

  function buildText(providerId: string, modelOverride?: string): TextProvider {
    const cacheKey = `${providerId}:${modelOverride ?? ""}`;
    const cached = textBuilt.get(cacheKey);
    if (cached) return cached;

    const entry = getEntry(providerId);
    const cliFactory = CLI_TEXT_FACTORIES[entry.protocol as CliProtocol];
    const provider = cliFactory
      ? cliFactory(modelOverride ?? entry.model)
      : entry.protocol === "anthropic"
        ? createAnthropicProvider({
            apiKey: requireApiKey(providerId, entry),
            baseUrl: entry.baseUrl,
            model: modelOverride ?? entry.model ?? "",
          })
        : createOpenAICompatibleProvider({
            id: providerId,
            apiKey: requireApiKey(providerId, entry),
            baseUrl: entry.baseUrl ?? "",
            model: modelOverride ?? entry.textModel ?? "",
          });

    textBuilt.set(cacheKey, provider);
    return provider;
  }

  function buildImage(providerId: string): ImageProvider {
    const cached = imageBuilt.get(providerId);
    if (cached) return cached;

    const entry = getEntry(providerId);
    const cliFactory = CLI_IMAGE_FACTORIES[entry.protocol as CliProtocol];
    let provider: ImageProvider;
    if (cliFactory) {
      provider = cliFactory();
    } else if (entry.protocol === "openai-compatible") {
      provider = createOpenAIImageProvider({
        apiKey: requireApiKey(providerId, entry),
        baseUrl: entry.baseUrl ?? "",
        imageModel: entry.imageModel ?? "",
        visionModel: entry.textModel ?? "",
      });
    } else {
      throw new Error(
        `Provider "${providerId}" (protocol "${entry.protocol}") has no image capability — route this stage to a codex-cli or openai-compatible provider instead`,
      );
    }

    imageBuilt.set(providerId, provider);
    return provider;
  }

  function resolveProviderId(stage: string): string {
    const override = overrides[stage];
    if (override) return override.providerId;
    const providerId = cfg.routing[stage];
    if (!providerId) {
      throw new Error(`No routing entry for stage "${stage}" — check config.routing`);
    }
    return providerId;
  }

  return {
    textProviderFor(stage: string): TextProvider {
      const override = overrides[stage];
      return buildText(resolveProviderId(stage), override?.model);
    },
    imageProviderFor(stage: string): ImageProvider {
      return buildImage(resolveProviderId(stage));
    },
  };
}
