import assert from "node:assert/strict";
import test from "node:test";
import { parseBriefJson } from "./brief.js";

const validBrief = {
  coreClaim: "Ship small, ship often.",
  keyPoints: ["point a", "point b", "point c"],
  audience: "engineers",
  tone: "direct",
  cta: "Try it today",
  quotableLines: ["ship small, ship often"],
  immutableFacts: ["v1.0 released 2026-09-15"],
  visualConcepts: ["a rocket made of small boxes"],
};

test("parseBriefJson parses a raw JSON object", () => {
  const brief = parseBriefJson(JSON.stringify(validBrief));
  assert.equal(brief.coreClaim, validBrief.coreClaim);
  assert.deepEqual(brief.keyPoints, validBrief.keyPoints);
});

test("parseBriefJson unwraps a fenced ```json block", () => {
  const text = `Sure, here you go:\n\`\`\`json\n${JSON.stringify(validBrief)}\n\`\`\`\nHope that helps.`;
  const brief = parseBriefJson(text);
  assert.equal(brief.coreClaim, validBrief.coreClaim);
});

test("parseBriefJson defaults a missing cta to null", () => {
  const { cta, ...rest } = validBrief;
  const brief = parseBriefJson(JSON.stringify(rest));
  assert.equal(brief.cta, null);
});

test("parseBriefJson throws when a required field is missing", () => {
  const { immutableFacts, ...rest } = validBrief;
  assert.throws(() => parseBriefJson(JSON.stringify(rest)), /immutableFacts/);
});

test("parseBriefJson throws when there's no JSON object at all", () => {
  assert.throws(() => parseBriefJson("sorry, I can't do that"), /No JSON object/);
});

test("parseBriefJson rejects wrong field types", () => {
  for (const patch of [{ coreClaim: 42 }, { keyPoints: null }, { immutableFacts: [1] }, { cta: {} }]) {
    assert.throws(() => parseBriefJson(JSON.stringify({ ...validBrief, ...patch })));
  }
});
