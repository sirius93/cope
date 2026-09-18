import sharp from "sharp";
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
