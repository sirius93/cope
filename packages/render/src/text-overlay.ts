import sharp from "sharp";
import { IMAGE_STYLES, parseImageStyle } from "./image-styles.js";
import { buildOverlaySvg, type OverlaySpec } from "./svg-overlay.js";

export type RenderTextOverlayOptions = OverlaySpec;

// Renders headline/subhead text locally onto a background image and writes a PNG — the
// image model is instructed never to render its own text (models are unreliable at
// legible text), so every word on the final image comes from here, not the model.
export async function renderTextOverlay(
  backgroundFile: string,
  outFile: string,
  opts: RenderTextOverlayOptions,
): Promise<void> {
  const svg = buildOverlaySvg(opts);
  await sharp(backgroundFile, { limitInputPixels: 40_000_000 })
    .resize(opts.width, opts.height, { fit: "cover" })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outFile);
}

export async function normalizeImage(inputFile: string, outFile: string, width: number, height: number): Promise<void> {
  await sharp(inputFile, { limitInputPixels: 40_000_000 }).resize(width, height, { fit: "cover" }).png().toFile(outFile);
}

// Caption panel over a flat placeholder, so text can be previewed before paying for artwork.
export function overlayPreviewPng(opts: OverlaySpec): Promise<Buffer> {
  const background = IMAGE_STYLES[parseImageStyle(opts.style ?? "editorial")].rule;
  return sharp({ create: { width: opts.width, height: opts.height, channels: 3, background } })
    .composite([{ input: Buffer.from(buildOverlaySvg(opts)), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

export function downscalePng(png: Buffer, width: number): Promise<Buffer> {
  return sharp(png).resize(width).png().toBuffer();
}
