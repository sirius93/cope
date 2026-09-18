import assert from "node:assert/strict";
import test from "node:test";
import { countChars, validate } from "./validate.js";
import type { FormatSpec } from "./types.js";

const xPostSpec: FormatSpec = {
  id: "x_post",
  platform: "x",
  kind: "shortform",
  outputSchema: "string",
  limits: { maxChars: 280 },
  rules: [],
};

const xThreadSpec: FormatSpec = {
  id: "x_thread",
  platform: "x",
  kind: "shortform",
  outputSchema: "string[]",
  limits: { maxPostChars: 280, minPosts: 3, maxPosts: 12 },
  rules: [],
};

test("countChars treats a URL as 23 chars on x", () => {
  const withUrl = "check this out https://example.com/a/very/long/path/that/would/blow/the/limit";
  const withoutUrl = "check this out ";
  assert.equal(countChars(withUrl, "x"), countChars(withoutUrl, "x") + 23);
});

test("countChars counts graphemes, not UTF-16 code units, elsewhere", () => {
  // "👨‍👩‍👧‍👦" is one grapheme cluster but many UTF-16 code units.
  assert.equal(countChars("👨‍👩‍👧‍👦", "linkedin"), 1);
});

test("validate flags an over-limit single-string output", () => {
  const result = validate(xPostSpec, "a".repeat(281));
  assert.equal(result.valid, false);
  assert.match(result.violations[0], /281 chars, over the 280 limit/);
});

test("validate passes a within-limit single-string output", () => {
  const result = validate(xPostSpec, "a".repeat(280));
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test("validate enforces minPosts/maxPosts and per-post length on thread output", () => {
  const tooFew = validate(xThreadSpec, ["one", "two"]);
  assert.equal(tooFew.valid, false);
  assert.match(tooFew.violations[0], /at least 3 posts/);

  const oneTooLong = validate(xThreadSpec, ["a".repeat(280), "b".repeat(281), "c".repeat(10)]);
  assert.equal(oneTooLong.valid, false);
  assert.match(oneTooLong.violations[0], /Post 2 is 281 chars/);

  const ok = validate(xThreadSpec, ["a".repeat(280), "b".repeat(280), "c".repeat(10)]);
  assert.equal(ok.valid, true);
});

test("validate rejects mismatched output shape", () => {
  assert.equal(validate(xPostSpec, ["not", "a", "string"]).valid, false);
  assert.equal(validate(xThreadSpec, "not an array").valid, false);
});
