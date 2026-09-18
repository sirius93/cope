// ponytail: fixed exponential backoff, no jitter/circuit-breaker. Upgrade if we start
// hammering rate limits in parallel runs.
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 500 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error("attempts must be a positive integer");
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number } | null)?.status;
      if (status !== 408 && status !== 429 && !(status && status >= 500 && status <= 599)) throw err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}
