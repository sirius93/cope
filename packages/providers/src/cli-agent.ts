import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TextMessage } from "./types.js";

const execFileAsync = promisify(execFile);

export function transcript(messages: TextMessage[]): string {
  return messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n\n");
}

export interface RunCliAgentOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
}

// Shared exec wrapper for both `claude -p` and `codex exec`: closes stdin immediately
// (both CLIs otherwise wait to see if input is piped in) and returns stdout.
export async function runCliAgent(
  binary: string,
  args: string[],
  opts: RunCliAgentOptions = {},
): Promise<string> {
  // Do not replay a subprocess: it may have completed a billable operation.
  try {
    const child = execFileAsync(binary, args, {
      cwd: opts.cwd,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 180_000,
    });
    child.child.stdin?.end();
    const { stdout } = await child;
    return stdout;
  } catch {
    // execFile errors include the entire prompt/argv; keep source material out of logs.
    throw new Error(`${binary} failed or timed out; check CLI installation and authentication`);
  }
}
