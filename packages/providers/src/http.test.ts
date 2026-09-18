import assert from "node:assert/strict";
import test from "node:test";
import { fetchBytes } from "./http.js";
import { withRetry } from "./retry.js";

test("HTTP responses are bounded and error bodies stay out of messages", async (t) => {
  void globalThis.fetch; // Materialize Node 20's lazy fetch before mocking.
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.ok(init.signal);
    return new Response("too large");
  });
  await assert.rejects(fetchBytes("https://example.invalid", {}, 3), /byte limit/);
  t.mock.method(globalThis, "fetch", async () => new Response("sensitive upstream body", { status: 401 }));
  await assert.rejects(fetchBytes("https://example.invalid"), { message: "HTTP 401" });
});

test("only transient HTTP statuses are retried", async () => {
  for (const status of [400, 401, 403, 429, 503, undefined]) {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error("failed"), { status }); }, { baseDelayMs: 0 }));
    assert.equal(calls, status === 429 || status === 503 ? 3 : 1);
  }
});
