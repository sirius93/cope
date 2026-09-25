import { IMAGE_STYLES, parseImageStyle, type ImageStyle } from "./image-styles.js";
import { applyPersonaColors, buildBrandBar, hasPersonaBranding, type Persona } from "./persona.js";
import { wrapText } from "./wrap-text.js";
import { escapeXml } from "./xml.js";

export interface OverlaySpec {
  headline?: string;
  subhead?: string;
  width: number;
  height: number;
  style?: ImageStyle;
  persona?: Persona;
}

export { escapeXml };

// A quiet, opaque caption panel keeps type readable without a heavy gradient scrim.
export function buildOverlaySvg({ headline, subhead, width, height, style: styleName = "editorial", persona }: OverlaySpec): string {
  const style = applyPersonaColors(IMAGE_STYLES[parseImageStyle(styleName)], persona);
  const pad = Math.round(width * 0.06);
  const inset = Math.round(width * 0.03);
  const branded = hasPersonaBranding(persona);
  const shortSide = Math.min(width, height);
  const brandBarH = branded ? Math.round(shortSide * 0.09) : 0;
  const brandGap = branded ? Math.round(shortSide * 0.02) : 0;
  let headlineSize = Math.round(width * 0.05);
  let subheadSize = Math.round(width * 0.03);
  let headlineLines: string[] = [];
  let subheadLines: string[] = [];
  let textBlockHeight = 0;
  while (true) {
    const maxCharsHeadline = Math.max(1, Math.floor((width - pad * 2) / (headlineSize * 0.68)));
    const maxCharsSubhead = Math.max(1, Math.floor((width - pad * 2) / (subheadSize * 0.68)));
    headlineLines = headline ? wrapText(headline, maxCharsHeadline) : [];
    subheadLines = subhead ? wrapText(subhead, maxCharsSubhead) : [];
    textBlockHeight = headlineLines.length * headlineSize * 1.2 +
      (subheadLines.length ? subheadLines.length * subheadSize * 1.4 + subheadSize * 0.6 : 0);
    if (textBlockHeight + (textBlockHeight ? brandBarH + brandGap : 0) <= height * 0.42) break;
    headlineSize -= 2;
    subheadSize -= 1;
    if (headlineSize < 28 || subheadSize < 20) {
      throw new Error("Too much text for the generated-image caption panel; shorten the complete description");
    }
  }
  const blockHeight = textBlockHeight + (textBlockHeight ? brandBarH + brandGap : 0);
  const lineGapH = headlineSize * 1.2;
  const lineGapS = subheadSize * 1.4;
  const startY = height - pad - blockHeight + headlineSize * 0.85;
  const panelY = height - blockHeight - pad - inset;
  const headlineTspans = headlineLines.map((line, i) => `<tspan x="${pad}" y="${startY + i * lineGapH}">${escapeXml(line)}</tspan>`).join("");
  const subheadStartY = startY + headlineLines.length * lineGapH + subheadSize * 0.7;
  const subheadTspans = subheadLines.map((line, i) => `<tspan x="${pad}" y="${subheadStartY + i * lineGapS}">${escapeXml(line)}</tspan>`).join("");
  const brand = branded ? buildBrandBar(persona!, pad, height - pad - brandBarH, width - pad * 2, brandBarH, style) : "";
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${blockHeight ? `<rect x="${inset}" y="${panelY}" width="${width - inset * 2}" height="${height - panelY - inset}" fill="${style.background}"/>` : ""}
  ${headlineLines.length ? `<text font-family="${style.headlineFont}" font-weight="${style.weight}" font-size="${headlineSize}" fill="${style.ink}">${headlineTspans}</text>` : ""}
  ${subheadLines.length ? `<text font-family="${style.bodyFont}" font-size="${subheadSize}" fill="${style.muted}">${subheadTspans}</text>` : ""}
  ${brand}
</svg>`;
}
