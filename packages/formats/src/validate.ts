import type { FormatSpec } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

const URL_REGEX = /https?:\/\/\S+/g;
// ponytail: fixed t.co length instead of calling X's URL-shortening API. Revisit if the
// real count ever drifts from 23.
const X_URL_LENGTH = 23;

export function countChars(text: string, platform: string): number {
  const normalized = platform === "x" ? text.replace(URL_REGEX, "x".repeat(X_URL_LENGTH)) : text;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(normalized)].length;
}

// Validates the spec's hard numeric limits only. `rules` (tone/style guidance) are
// enforced via the prompt and repair pass, not checked here — see §5 of the build plan:
// only hard limits need a code validator for v1.
export function validate(spec: FormatSpec, output: string | string[]): ValidationResult {
  const violations: string[] = [];
  const limits = spec.limits ?? {};

  if (spec.outputSchema === "string[]") {
    if (!Array.isArray(output)) {
      return { valid: false, violations: ["Expected an array of posts, got a single string."] };
    }
    if (output.some((post) => typeof post !== "string" || !post.trim())) {
      return { valid: false, violations: ["Every post must be a non-empty string."] };
    }
    if (limits.minPosts != null && output.length < limits.minPosts) {
      violations.push(`Expected at least ${limits.minPosts} posts, got ${output.length}.`);
    }
    if (limits.maxPosts != null && output.length > limits.maxPosts) {
      violations.push(`Expected at most ${limits.maxPosts} posts, got ${output.length}.`);
    }
    if (limits.maxPostChars != null) {
      output.forEach((post, i) => {
        const len = countChars(post, spec.platform);
        if (len > limits.maxPostChars) {
          violations.push(`Post ${i + 1} is ${len} chars, over the ${limits.maxPostChars} limit.`);
        }
      });
    }
    return { valid: violations.length === 0, violations };
  }

  if (typeof output !== "string" || !output.trim()) {
    return { valid: false, violations: ["Expected a single string, got an array."] };
  }
  if (limits.maxChars != null) {
    const len = countChars(output, spec.platform);
    if (len > limits.maxChars) {
      violations.push(`Output is ${len} chars, over the ${limits.maxChars} limit.`);
    }
  }
  if (limits.minChars != null) {
    const len = countChars(output, spec.platform);
    if (len < limits.minChars) {
      violations.push(`Output is ${len} chars, under the ${limits.minChars} minimum.`);
    }
  }
  return { valid: violations.length === 0, violations };
}
