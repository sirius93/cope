import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { loadImageFormat } from "@cope/formats";
import type { ImageProvider, TextProvider } from "@cope/providers";
import { IMAGE_STYLES, parseImageStyle } from "@cope/render";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { adaptImageFormat } from "./image-pipeline.js";
import type { Brief, ImageConcept } from "./types.js";

// A real, sharp-decodable PNG fixture — renderTextOverlay reads generated images through
// sharp, so a hand-rolled/truncated base64 literal isn't good enough here.
const TINY_PNG = await sharp({
  create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
})
  .png()
  .toBuffer();

function stubImageProvider(): ImageProvider {
  return {
    id: "stub",
    async generate(req) {
      mkdirSync(dirname(req.outFile), { recursive: true });
      writeFileSync(req.outFile, TINY_PNG);
      return { files: [req.outFile] };
    },
    async describe() {
      return "stub alt text";
    },
  };
}

function stubConceptProvider(concepts: ImageConcept[]): TextProvider {
  return {
    id: "stub",
    async complete() {
      return { text: JSON.stringify(concepts) };
    },
  };
}

const brief: Brief = {
  coreClaim: "test claim",
  keyPoints: ["a", "b", "c"],
  audience: "devs",
  tone: "direct",
  cta: null,
  quotableLines: ["a quote"],
  immutableFacts: [],
  visualConcepts: [],
};

function makeConcepts(n: number): ImageConcept[] {
  return Array.from({ length: n }, (_, i) => ({
    headline: `Clear Summary For Slide ${i + 1}`,
    subhead: `Supporting detail for slide ${i + 1}.`,
    imagePrompt: `background for slide ${i + 1}`,
  }));
}

test("adaptImageFormat bundles a PDF when the spec opts in and there's more than one image", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "cope-image-pipeline-test-"));
  try {
    const def = loadImageFormat("carousel"); // bundlePdf: true in its spec
    const result = await adaptImageFormat(
      brief,
      def,
      stubConceptProvider(makeConcepts(3)),
      stubImageProvider(),
      stubImageProvider(),
      outDir,
    );

    assert.equal(result.images.length, 3);
    assert.ok(result.pdfFile, "expected pdfFile to be set");
    assert.ok(existsSync(result.pdfFile!), "expected the PDF file to actually exist on disk");

    const pdf = await PDFDocument.load(readFileSync(result.pdfFile!));
    assert.equal(pdf.getPageCount(), 3);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("adaptImageFormat does not bundle a PDF for a single-image format", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "cope-image-pipeline-test-"));
  try {
    const def = loadImageFormat("og_image"); // bundlePdf not set
    const result = await adaptImageFormat(
      brief,
      def,
      stubConceptProvider(makeConcepts(1)),
      stubImageProvider(),
      stubImageProvider(),
      outDir,
    );

    assert.equal(result.images.length, 1);
    assert.equal(result.pdfFile, undefined);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("rejects out-of-range concepts before generating any images", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "cope-image-pipeline-test-"));
  try {
    const provider = stubImageProvider();
    provider.generate = async () => { assert.fail("must validate before spending"); };
    for (const count of [1, 10]) {
      await assert.rejects(adaptImageFormat(brief, loadImageFormat("carousel"),
        stubConceptProvider(makeConcepts(count)), provider, provider, outDir,
        { maxRepairPasses: 0 }), /Expected 3-9 concepts/);
    }
  } finally { rmSync(outDir, { recursive: true, force: true }); }
});

test("local carousel cards use one copy provider and produce exact dimensions and PDF", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "cope-cards-test-"));
  try {
    let count = 0;
    const result = await adaptImageFormat(brief, loadImageFormat("carousel"), stubConceptProvider(makeConcepts(5)), undefined, undefined,
      outDir, { mode: "cards", reserveImages: (n) => { count += n; } });
    assert.equal(count, 5);
    assert.equal(result.images.length, 5);
    const metadata = await sharp(result.images[1].file).metadata();
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1350);
    assert.ok(result.images[1].altText.includes("Supporting detail"));
    assert.equal((await PDFDocument.load(readFileSync(result.pdfFile!))).getPageCount(), 5);
    await assert.rejects(adaptImageFormat(brief, loadImageFormat("carousel"), stubConceptProvider(makeConcepts(5)), undefined, undefined,
      outDir, { mode: "cards", reserveImages: () => { throw new Error("budget exhausted"); } }), /budget exhausted/);
  } finally { rmSync(outDir, { recursive: true, force: true }); }
});

test("local carousel keeps a complete 5-6 word headline and full description", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "cope-carousel-copy-test-"));
  const point = "Shared dependency caching cut builds from eleven minutes to four minutes.";
  try {
    const concepts: ImageConcept[] = [
      { headline: "One Source Becomes Every Required Format", subhead: "COPE turns one source into several reviewed formats.", imagePrompt: "cover" },
      { headline: "Shared Caching Makes Builds Much Faster", subhead: point, imagePrompt: "cache" },
      { headline: "Measure Results Before Making The Move", subhead: "Compare build and release times before migrating.", imagePrompt: "closing" },
    ];
    const result = await adaptImageFormat(
      { ...brief, keyPoints: [point] },
      loadImageFormat("carousel"),
      stubConceptProvider(concepts),
      undefined,
      undefined,
      outDir,
      { mode: "cards", style: "editorial" },
    );
    assert.equal(result.images[1].concept.headline, "Shared Caching Makes Builds Much Faster");
    assert.equal(result.images[1].concept.subhead, point);
    assert.equal(result.images[1].concept.headline!.split(/\s+/).length, 6);
    assert.ok(!result.images[1].concept.subhead!.includes("…"));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("carousel rejects truncated titles and descriptions before rendering", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "cope-carousel-copy-validation-test-"));
  try {
    for (const bad of [
      { headline: "Shared Caching Makes Builds Much Faster…", subhead: "The full detail is present.", imagePrompt: "x" },
      { headline: "Shared Caching Makes Builds Much Faster", subhead: "The important result was…", imagePrompt: "x" },
      { headline: "Shared Caching Makes Builds Much Faster", subhead: "This sentence has no ending", imagePrompt: "x" },
    ]) {
      await assert.rejects(
        adaptImageFormat(brief, loadImageFormat("carousel"), stubConceptProvider([bad, ...makeConcepts(2)]), undefined, undefined, outDir, { mode: "cards", maxRepairPasses: 0 }),
        /carousel (?:headline|description)/,
      );
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("every preset reaches both generated-image stages and is recorded in metadata", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "cope-style-test-"));
  try {
    for (const name of Object.keys(IMAGE_STYLES)) {
      const style = parseImageStyle(name);
      const provider = stubImageProvider();
      const generate = provider.generate;
      provider.generate = async (req) => {
        assert.ok(req.prompt.includes(IMAGE_STYLES[style].direction));
        assert.ok(req.prompt.includes("Do not render any text"));
        return generate(req);
      };
      const conceptProvider: TextProvider = {
        id: "test",
        async complete(req) {
          assert.ok(req.messages[0].content.includes(IMAGE_STYLES[style].direction));
          return { text: JSON.stringify([{ headline: "A useful quote", subhead: null, imagePrompt: "A simple shape" }]) };
        },
      };
      const result = await adaptImageFormat(brief, loadImageFormat("quote_card"), conceptProvider, provider, provider,
        join(outDir, style), { style, maxRepairPasses: 0 });
      const metadata = JSON.parse(readFileSync(result.images[0].file.replace(/\.png$/, ".json"), "utf8"));
      assert.equal(metadata.style, style);
      assert.equal(metadata.mode, "generated");
      assert.equal((await sharp(result.images[0].file).metadata()).width, 1080);
    }
  } finally { rmSync(outDir, { recursive: true, force: true }); }
});
