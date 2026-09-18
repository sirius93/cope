import { runCliAgent, transcript } from "./cli-agent.js";
import { ProviderError, type TextProvider, type TextRequest, type TextResponse } from "./types.js";

// Runs text completions through the local `claude` CLI in print mode instead of the
// Anthropic API. Uses whatever auth the CLI already has (Pro/Max subscription OAuth, or
// an API key it's configured with) — so COPE needs no ANTHROPIC_API_KEY of its own when
// this provider is selected. Trade-off: no direct control over billing/rate limits, and
// each call pays the CLI's session/tool-definition overhead (mitigated by Anthropic's
// server-side prompt caching across calls within ~1h).
export interface ClaudeCodeCliConfig {
  binary?: string; // default "claude"
  model?: string; // optional --model override; omit to use the CLI's own default
  timeoutMs?: number;
}

interface ClaudePrintResult {
  result: string;
  is_error: boolean;
  usage?: { input_tokens: number; output_tokens: number };
}

export function createClaudeCodeCliProvider(config: ClaudeCodeCliConfig = {}): TextProvider {
  const binary = config.binary ?? "claude";

  return {
    id: "claude-code-cli",
    async complete(req: TextRequest): Promise<TextResponse> {
      // "--tools=" (single token) not "--tools", "" (two tokens): the latter lets
      // --tools's variadic parser swallow the trailing prompt argument as another
      // "tool name", which then leaves no positional prompt and --print errors out.
      const args = ["-p", "--output-format", "json", "--tools="];
      if (req.system) args.push("--system-prompt", req.system);
      if (config.model) args.push("--model", config.model);
      args.push(transcript(req.messages));

      try {
        const stdout = await runCliAgent(binary, args, { timeoutMs: config.timeoutMs });
        const parsed = JSON.parse(stdout) as ClaudePrintResult;
        if (parsed.is_error) {
          throw new Error(parsed.result || "claude -p reported an error with no message");
        }
        return {
          text: parsed.result,
          usage: parsed.usage
            ? { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens }
            : undefined,
        };
      } catch (err) {
        throw new ProviderError("claude-code-cli", err instanceof Error ? err.message : String(err), err);
      }
    },
  };
}
