import { readFileSync } from "node:fs";
import { escapeXml } from "./xml.js";
import type { IMAGE_STYLES } from "./image-styles.js";

export interface Persona {
  logoFile?: string;
  primaryColor?: string;
  secondaryColor?: string;
  website?: string;
  twitter?: string;
}

type StyleColors = (typeof IMAGE_STYLES)[keyof typeof IMAGE_STYLES];

export function hasPersonaBranding(persona?: Persona): persona is Persona {
  return !!persona && !!(persona.logoFile || persona.website || persona.twitter);
}

// Brand colors read through the rest of a card's decoration (rules, accents, muted
// footer text) even where the brand bar itself doesn't reach, so a themed card doesn't
// look like generic style + a logo bolted on.
export function applyPersonaColors<T extends StyleColors>(style: T, persona?: Persona): T {
  if (!persona) return style;
  return {
    ...style,
    accent: persona.primaryColor ?? style.accent,
    muted: persona.secondaryColor ?? style.muted,
  };
}

function logoDataUri(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

// Renders a big circular photo with website/handle stacked beside it, right-aligned
// within a caller-given box, with a full-width accent rule below — clear gap between the
// content and the rule, so it drops into whichever margin a card already reserves
// instead of needing its own layout pass.
export function buildBrandBar(persona: Persona, x: number, y: number, width: number, height: number, style: StyleColors): string {
  const ruleGap = height * 0.16;
  const contentH = height - ruleGap;
  const centerY = y + contentH / 2;
  const photoSize = contentH;
  const gap = contentH * 0.16;
  const rightEdge = x + width;

  const lines = [persona.website, persona.twitter && `@${persona.twitter.replace(/^@/, "")}`].filter((l): l is string => !!l);
  const fontSize = Math.round(contentH * (lines.length > 1 ? 0.3 : 0.36));
  const lineHeight = fontSize * 1.3;
  // ponytail: char-count width estimate (matches wrapText's approach elsewhere in this
  // package) rather than real font-metrics measurement — good enough to right-align a
  // short handle/domain string.
  const textWidth = lines.length ? Math.max(...lines.map((l) => l.length * fontSize * 0.56)) : 0;
  const textLeft = rightEdge - textWidth;
  const photoLeft = persona.logoFile ? textLeft - gap - photoSize : textLeft;

  let photo = "";
  if (persona.logoFile) {
    const cx = photoLeft + photoSize / 2;
    photo = `<defs><clipPath id="personaClip"><circle cx="${cx}" cy="${centerY}" r="${photoSize / 2}"/></clipPath></defs>
    <image href="${logoDataUri(persona.logoFile)}" x="${photoLeft}" y="${centerY - photoSize / 2}" width="${photoSize}" height="${photoSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#personaClip)"/>
    <circle cx="${cx}" cy="${centerY}" r="${photoSize / 2}" fill="none" stroke="${style.accent}" stroke-width="2"/>`;
  }
  const textStartY = centerY - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.32;
  const textEl = lines.length
    ? `<text text-anchor="end" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${style.muted}">${lines.map((l, i) => `<tspan x="${rightEdge}" y="${textStartY + i * lineHeight}">${escapeXml(l)}</tspan>`).join("")}</text>`
    : "";
  const line = `<path d="M${x} ${y + height}H${rightEdge}" stroke="${style.accent}" stroke-width="1.5"/>`;
  return `<g>${photo}${textEl}${line}</g>`;
}
