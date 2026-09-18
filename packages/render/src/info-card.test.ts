import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_STYLES, parseImageStyle } from "./image-styles.js";
import { buildOverlaySvg } from "./svg-overlay.js";
import { buildInfoCardSvg } from "./info-card.js";

test("cards escape source text and reject overflow instead of dropping information", () => {
  const card = { headline: '<script> & "quote"', body: "A useful fact", width: 1080, height: 1350, index: 1, total: 3 };
  const svg = buildInfoCardSvg(card);
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("A useful fact"));
  assert.throws(() => buildInfoCardSvg({ ...card, body: "long text ".repeat(3000) }), /Too much text/);
});

test("presets produce distinct unbranded layouts and matching caption panels", () => {
  const card = { headline: "A quieter visual", body: "A useful fact", width: 1080, height: 1350, index: 1, total: 3 };
  const outputs = new Set<string>();
  for (const key of Object.keys(IMAGE_STYLES)) {
    const name = parseImageStyle(key);
    const svg = buildInfoCardSvg({ ...card, style: name });
    assert.ok(svg.includes(IMAGE_STYLES[name].background));
    assert.ok(svg.includes(IMAGE_STYLES[name].headlineFont));
    assert.ok(!svg.includes("COPE"));
    const overlay = buildOverlaySvg({ ...card, style: name });
    assert.ok(overlay.includes(IMAGE_STYLES[name].background));
    assert.ok(!overlay.includes("linearGradient"));
    outputs.add(svg);
  }
  assert.equal(outputs.size, 4);
  assert.throws(() => parseImageStyle("__proto__"), /Unknown image style/);
  assert.throws(() => parseImageStyle("neon"), /editorial, minimal, blueprint, sketch/);
});

test("generated-image caption panels preserve complete descriptions without ellipses", () => {
  const description = "Shared caching reduced the build from eleven minutes to four minutes while preserving the exact qualification and measured result.";
  const svg = buildOverlaySvg({
    headline: "Shared Caching Makes Builds Much Faster",
    subhead: description,
    width: 1080,
    height: 1350,
  });
  for (const word of description.split(/\s+/)) assert.ok(svg.includes(word));
  assert.ok(!svg.includes("…"));
});
