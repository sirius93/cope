import sharp from "sharp";
import { IMAGE_STYLES, parseImageStyle, type ImageStyle } from "./image-styles.js";
import { applyPersonaColors, buildBrandBar, hasPersonaBranding, type Persona } from "./persona.js";
import { wrapText } from "./wrap-text.js";
import { escapeXml } from "./xml.js";

const CODE_FONT = "Menlo, Consolas, 'DejaVu Sans Mono', 'Courier New', monospace";
const CODE_GAP = 36;
const CODE_LEADING = 1.45;

export interface InfoCard {
  headline: string;
  body: string;
  code?: string; // rendered verbatim in a monospace panel: indentation kept, never wrapped
  width: number;
  height: number;
  index: number;
  total: number;
  style?: ImageStyle;
  persona?: Persona;
}

export function buildInfoCardSvg(card: InfoCard): string {
  const { width, height, index, total } = card;
  const name = parseImageStyle(card.style ?? "editorial");
  const style = applyPersonaColors(IMAGE_STYLES[name], card.persona);
  const branded = hasPersonaBranding(card.persona);
  const shortSide = Math.min(width, height);
  const brandBarH = branded ? Math.round(shortSide * 0.09) : 0;
  const brandGap = branded ? Math.round(shortSide * 0.02) : 0;
  const pad = Math.round(width * 0.085);
  const usable = width - pad * 2;
  const centered = name === "minimal";
  const x = centered ? width / 2 : pad;
  // ponytail: conservative font-width estimates; use measured glyph widths for custom fonts.
  function lines(text: string, size: number): string[] {
    const count = Math.max(1, Math.floor(usable / (size * 0.68)));
    return text.split(/\n\s*\n/).flatMap((paragraph, p) => {
      const words = paragraph.split(/\s+/).flatMap((word) => {
        const chars = Array.from(word);
        return Array.from({ length: Math.ceil(chars.length / count) }, (_, i) => chars.slice(i * count, (i + 1) * count).join(""));
      });
      return [...(p ? [""] : []), ...wrapText(words.join(" "), count)];
    });
  }
  // ponytail: monospace advance estimated at 0.6em; measure glyphs if a font ever overflows.
  const codeLines = card.code ? card.code.replace(/\t/g, "  ").replace(/\s+$/, "").split("\n") : [];
  const codeCols = Math.max(1, ...codeLines.map((line) => Array.from(line).length));
  const codeInset = Math.round(width * 0.03);
  let codeSize = Math.min(Math.round(width * 0.024), Math.floor((usable - codeInset * 2) / (codeCols * 0.6)));
  if (codeLines.length && codeSize < 16) throw new Error("Code line too wide for an information card; use shorter lines");
  const codeHeight = () => codeLines.length ? CODE_GAP + codeLines.length * codeSize * CODE_LEADING + codeInset * 2 : 0;
  let titleSize = Math.round(width * (name === "blueprint" ? 0.052 : 0.063));
  let bodySize = Math.round(width * 0.032);
  let title = lines(card.headline, titleSize);
  let body = lines(card.body, bodySize);
  const topEdge = pad + (height > width ? height * 0.12 : 22);
  const bottomLimit = height - pad - (branded ? brandBarH + brandGap : 0);
  const available = bottomLimit - pad * 0.3 - topEdge;
  const textHeight = () => title.length * titleSize * 1.18 + (body.length ? body.length * bodySize * 1.5 + 42 : 0);
  const blockHeight = () => textHeight() + codeHeight();
  while (blockHeight() > available) {
    titleSize -= 2;
    bodySize -= 1;
    codeSize = Math.max(16, codeSize - 1);
    if (bodySize < 22 || titleSize < 28) throw new Error("Too much text for an information card; shorten the source or split its key points");
    title = lines(card.headline, titleSize);
    body = lines(card.body, bodySize);
  }
  const top = centered ? Math.min((height - blockHeight()) / 2 - 20, bottomLimit - blockHeight()) : topEdge;
  const titleY = top + titleSize;
  const bodyY = titleY + (title.length - 1) * titleSize * 1.18 + 42 + bodySize;
  const text = (rows: string[], y: number, size: number, gap: number) => rows.map((line, i) =>
    `<tspan x="${x}" y="${y + i * size * gap}">${escapeXml(line)}</tspan>`).join("");
  const panelY = top + textHeight() + CODE_GAP;
  // librsvg drops leading whitespace (even NBSP), so indentation becomes an x offset;
  // inner runs use NBSP because SVG collapses ordinary repeated spaces.
  const code = codeLines.length ? `<rect x="${pad}" y="${panelY}" width="${usable}" height="${codeHeight() - CODE_GAP}" rx="10" fill="${style.ink}" fill-opacity="0.06" stroke="${style.rule}"/>
  <text text-anchor="start" font-family="${CODE_FONT}" font-size="${codeSize}" fill="${style.ink}">${codeLines.map((line, i) => {
    const indent = line.length - line.trimStart().length;
    return `<tspan x="${pad + codeInset + indent * codeSize * 0.6}" y="${panelY + codeInset + codeSize * (0.9 + i * CODE_LEADING)}">${escapeXml(line.trimStart().replace(/ /g, "\u00a0"))}</tspan>`;
  }).join("")}</text>` : "";
  const footer = total > 1 ? `<text x="${width - pad}" y="${height - pad / 2}" text-anchor="end" font-family="Arial, sans-serif" font-size="18" fill="${style.muted}">${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>` : "";
  let decoration = "";
  if (name === "editorial") decoration = `<path d="M${pad} ${pad}H${width - pad}" stroke="${style.rule}"/>`;
  if (name === "minimal") decoration = `<path d="M${width / 2 - 20} ${height - pad}h40" stroke="${style.accent}" stroke-width="2"/>`;
  if (name === "blueprint") decoration = `<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${style.rule}" stroke-opacity="0.3"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)"/><path d="M${pad} ${pad + 12}V${pad}h48" fill="none" stroke="${style.accent}"/>`;
  if (name === "sketch") decoration = `<path d="M${pad} ${pad + 3}Q${width / 2} ${pad - 3} ${width - pad} ${pad + 1}" fill="none" stroke="${style.rule}" stroke-width="1.5"/><path d="M${pad} ${height - pad}q55 -4 110 0" fill="none" stroke="${style.accent}" stroke-width="2"/>`;
  const brand = branded ? buildBrandBar(card.persona!, pad, bottomLimit, width - pad * 2, brandBarH, style) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="${style.background}"/>
  ${decoration}
  <g text-anchor="${centered ? "middle" : "start"}">
    <text font-family="${style.headlineFont}" font-weight="${style.weight}" font-size="${titleSize}" fill="${style.ink}">${text(title, titleY, titleSize, 1.18)}</text>
    <text font-family="${style.bodyFont}" font-size="${bodySize}" fill="${style.muted}">${text(body, bodyY, bodySize, 1.5)}</text>
  </g>
  ${code}
  ${footer}
  ${brand}
</svg>`;
}

export function infoCardPng(card: InfoCard): Promise<Buffer> {
  return sharp(Buffer.from(buildInfoCardSvg(card))).png().toBuffer();
}

export async function renderInfoCard(outFile: string, card: InfoCard): Promise<void> {
  await sharp(Buffer.from(buildInfoCardSvg(card))).png().toFile(outFile);
}
