import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "./slug.js";

test("slugify lowercases, strips accents, and hyphenates", () => {
  assert.equal(slugify("Café Launch Day!"), "cafe-launch-day");
});

test("slugify truncates and trims a trailing hyphen", () => {
  assert.equal(slugify("a".repeat(70), 10), "aaaaaaaaaa");
});

test("slugify falls back to 'untitled' for empty/symbol-only input", () => {
  assert.equal(slugify("*** ---"), "untitled");
});
