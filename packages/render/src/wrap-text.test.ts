import assert from "node:assert/strict";
import test from "node:test";
import { truncateLines, wrapText } from "./wrap-text.js";

test("wrapText keeps short text on one line", () => {
  assert.deepEqual(wrapText("hello world", 40), ["hello world"]);
});

test("wrapText breaks at a word boundary once the line is full", () => {
  const lines = wrapText("the quick brown fox jumps over the lazy dog", 15);
  for (const line of lines) {
    assert.ok(line.length <= 15 || !line.includes(" "), `line too long: "${line}"`);
  }
  assert.equal(lines.join(" "), "the quick brown fox jumps over the lazy dog");
});

test("wrapText never drops a word, even one longer than the line width", () => {
  const lines = wrapText("short reallyreallyreallylongword end", 10);
  assert.ok(lines.includes("reallyreallyreallylongword"));
});

test("wrapText collapses extra whitespace and trims", () => {
  assert.deepEqual(wrapText("  hello   world  ", 40), ["hello world"]);
});

test("wrapText returns an empty array for empty input", () => {
  assert.deepEqual(wrapText("", 40), []);
});

test("truncateLines leaves short line sets untouched", () => {
  assert.deepEqual(truncateLines(["one", "two"], 3, 40), ["one", "two"]);
});

test("truncateLines marks a cut with an ellipsis instead of silently dropping text", () => {
  const lines = wrapText(
    "Manual verification, DNS, propagation, and MX work invites skipped domains, incorrect TXT values, wrong parent domains, and overwritten mail records.",
    49,
  );
  const result = truncateLines(lines, 3, 49);
  assert.equal(result.length, 3);
  assert.ok(result[2].endsWith("…"), `expected an ellipsis, got "${result[2]}"`);
  // the old bug: a hard .slice(0, n) would end mid-word/mid-clause with no indication of
  // truncation at all
  assert.notEqual(result[2], lines[2]);
});

test("truncateLines never produces a line longer than maxCharsPerLine, for properly wrappable text", () => {
  const lines = wrapText("the quick brown fox jumps over the lazy dog again and again", 40);
  const result = truncateLines(lines, 2, 40);
  for (const line of result) {
    assert.ok(line.length <= 40, `line too long: "${line}" (${line.length} chars)`);
  }
});
