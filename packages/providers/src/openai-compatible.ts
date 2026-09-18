import { ProviderError, type TextProvider, type TextRequest, type TextResponse } from "./types.js";
import { fetchJson } from "./http.js";
import { withRetry } from "./retry.js";

// Generic OpenAI-compatible chat-completions provider. Works for OpenAI itself and any
// gateway (OpenRouter, LiteLLM, self-hosted proxy) that speaks the same wire format —
// that's the "plug-through" fallback the provider abstraction promises.
export interface OpenAICompatibleConfig {
  id?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): TextProvider {
  const id = config.id ?? "openai";

  return {
    id,
    async complete(req: TextRequest): Promise<TextResponse> {
      const messages = [
        ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
        ...req.messages,
      ];

      try {
        const res = await withRetry(async () => {
          return fetchJson<ChatCompletionResponse>(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages,
              max_tokens: req.maxTokens ?? 4096,
            }),
          });
        });

        return {
          text: res.choices[0]?.message.content ?? "",
          usage: res.usage
            ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
            : undefined,
        };
      } catch (err) {
        throw new ProviderError(id, err instanceof Error ? err.message : String(err), err);
      }
    },
  };
}
