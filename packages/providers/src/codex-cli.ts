import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliAgent, transcript } from "./cli-agent.js";
import { ProviderError, type TextProvider, type TextRequest, type TextResponse } from "./types.js";

// Runs text completions through the local `codex` CLI (`codex exec`) instead of the
// OpenAI API — uses whatever auth codex already has (ChatGPT subscription, or its own API
// key), so COPE needs no OPENAI_API_KEY when this provider is selected. Codex exec has no
// dedicated system-prompt flag, so system content is folded into the prompt transcript,
// and there's no flag to disable tool use entirely (unlike Claude's --tools=), so we run
// it read-only-sandboxed against a scratch dir instead of the caller's cwd.
export interface CodexCliConfig {
  binary?: string; // default "codex"
  model?: string; // optional --model override; omit to use the CLI's own default
  timeoutMs?: number;
}

export function createCodexCliProvider(config: CodexCliConfig = {}): TextProvider {
  const binary = config.binary ?? "codex";

  return {
    id: "codex-cli",
    async complete(req: TextRequest): Promise<TextResponse> {
      const scratchDir = mkdtempSync(join(tmpdir(), "cope-codex-"));
      const outFile = join(scratchDir, "output.txt");
      try {
        const prompt = req.system
          ? `<system>\n${req.system}\n</system>\n\n${transcript(req.messages)}`
          : transcript(req.messages);

        const args = [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--ephemeral",
          "--color",
          "never",
          "-C",
          scratchDir,
          "-o",
          outFile,
        ];
        if (config.model) args.push("--model", config.model);
        args.push(prompt);

        await runCliAgent(binary, args, { timeoutMs: config.timeoutMs, cwd: scratchDir });
        return { text: readFileSync(outFile, "utf-8").trim() };
      } catch (err) {
        throw new ProviderError("codex-cli", err instanceof Error ? err.message : String(err), err);
      } finally {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    },
  };
}
