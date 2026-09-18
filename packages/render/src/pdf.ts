import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

// Bundles a sequence of same-format PNGs into a single multi-page PDF, one image per
// page sized to that image's own pixel dimensions — e.g. a carousel's slides, for
// platforms (LinkedIn document posts) that render an uploaded PDF as a swipeable
// carousel instead of taking separate image attachments.
export async function buildPdfFromImages(imageFiles: string[], outFile: string): Promise<void> {
  const pdf = await PDFDocument.create();
  for (const file of imageFiles) {
    const png = await pdf.embedPng(readFileSync(file));
    const page = pdf.addPage([png.width, png.height]);
    page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
  }
  writeFileSync(outFile, await pdf.save());
}
