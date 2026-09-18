export interface TextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TextRequest {
  system?: string;
  messages: TextMessage[];
  maxTokens?: number;
}

export interface TextResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface TextProvider {
  id: string;
  complete(req: TextRequest): Promise<TextResponse>;
}

export interface ImageRequest {
  prompt: string;
  outFile: string; // where the generated image file must end up
  size?: string; // e.g. "1200x630"; best-effort — not every protocol can enforce it exactly
}

export interface ImageResponse {
  files: string[]; // paths to generated image files (usually just [outFile])
}

export interface DescribeRequest {
  imageFile: string;
  maxChars?: number;
}

export interface ImageProvider {
  id: string;
  generate(req: ImageRequest): Promise<ImageResponse>;
  describe(req: DescribeRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    public providerId: string,
    message: string,
    public cause?: unknown,
  ) {
    super(`[${providerId}] ${message}`);
    this.name = "ProviderError";
  }
}
