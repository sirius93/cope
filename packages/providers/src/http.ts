// Bound both elapsed time and streamed response bytes, including chunked responses.
export async function fetchBytes(url: string, init: RequestInit = {}, maxBytes = 8 * 1024 * 1024, timeoutMs = 180_000): Promise<Buffer> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}

export async function fetchJson<T>(url: string, init: RequestInit, maxBytes?: number): Promise<T> {
  return JSON.parse((await fetchBytes(url, init, maxBytes)).toString("utf-8")) as T;
}
