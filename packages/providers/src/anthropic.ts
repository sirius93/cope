import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type TextProvider, type TextRequest, type TextResponse } from "./types.js";
import { withRetry } from "./retry.js";

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export function createAnthropicProvider(config: AnthropicProviderConfig): TextProvider {
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, maxRetries: 0, timeout: 180_000 });

  return {
    id: "anthropic",
    async complete(req: TextRequest): Promise<TextResponse> {
      try {
        const res = await withRetry(() =>
          client.messages.create({
            model: config.model,
            max_tokens: req.maxTokens ?? 4096,
            system: req.system,
            messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        );
        const text = res.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");
        return {
          text,
          usage: {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
          },
        };
      } catch (err) {
        throw new ProviderError("anthropic", err instanceof Error ? err.message : String(err), err);
      }
    },
  };
}
