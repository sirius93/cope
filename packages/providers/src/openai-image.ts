import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ProviderError,
  type DescribeRequest,
  type ImageProvider,
  type ImageRequest,
  type ImageResponse,
} from "./types.js";
import { fetchBytes, fetchJson } from "./http.js";
import { withRetry } from "./retry.js";

export interface OpenAIImageConfig {
  apiKey: string;
  baseUrl: string;
  imageModel: string;
  visionModel: string; // for describe() — a chat model that accepts image input
}

interface ImagesResponse {
  data: { b64_json?: string; url?: string }[];
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

export function createOpenAIImageProvider(config: OpenAIImageConfig): ImageProvider {
  const base = config.baseUrl.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  return {
    id: "openai",
    async generate(req: ImageRequest): Promise<ImageResponse> {
      try {
        // No automatic replay of image generation: a timeout may still incur a charge.
        // Use a supported square generation size; the render pipeline crops to the format.
        const res = await fetchJson<ImagesResponse>(`${base}/images/generations`, {
          method: "POST", headers,
          body: JSON.stringify({ model: config.imageModel, prompt: req.prompt,
            size: "1024x1024", n: 1 }),
        }, 64 * 1024 * 1024);

        const item = res.data[0];
        if (!item) throw new Error("OpenAI returned no image data");

        const outFile = resolve(req.outFile);
        mkdirSync(dirname(outFile), { recursive: true });
        if (item.b64_json) {
          writeFileSync(outFile, Buffer.from(item.b64_json, "base64"));
        } else if (item.url) {
          writeFileSync(outFile, await fetchBytes(item.url, {}, 64 * 1024 * 1024));
        } else {
          throw new Error("OpenAI image response had neither b64_json nor url");
        }
        return { files: [outFile] };
      } catch (err) {
        throw new ProviderError("openai", err instanceof Error ? err.message : String(err), err);
      }
    },

    async describe(req: DescribeRequest): Promise<string> {
      try {
        const base64 = readFileSync(resolve(req.imageFile)).toString("base64");
        const maxChars = req.maxChars ?? 125;
        const res = await withRetry(async () => {
          return fetchJson<ChatCompletionResponse>(`${base}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: config.visionModel,
              max_tokens: 128,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Write concise, descriptive alt-text for this image, ${maxChars} characters or fewer. Output only the alt-text, nothing else.`,
                    },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
                  ],
                },
              ],
            }),
          });
        });
        return res.choices[0]?.message.content.trim() ?? "";
      } catch (err) {
        throw new ProviderError("openai", err instanceof Error ? err.message : String(err), err);
      }
    },
  };
}
