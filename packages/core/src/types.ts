export interface Brief {
  coreClaim: string;
  keyPoints: string[];
  audience: string;
  tone: string;
  cta: string | null;
  quotableLines: string[];
  immutableFacts: string[];
  visualConcepts: string[];
}

export interface AdaptResult {
  formatId: string;
  output: string | string[];
  valid: boolean;
  violations: string[];
  repairPasses: number;
}

export interface ImageConcept {
  headline?: string;
  subhead?: string;
  imagePrompt: string;
  negativeCues?: string[];
}

export interface GeneratedImage {
  file: string;
  altText: string;
  concept: ImageConcept;
}

export interface ImageAdaptResult {
  formatId: string;
  images: GeneratedImage[];
  pdfFile?: string; // set when the spec's bundlePdf produced a multi-page PDF
  error?: string; // set (with images: []) if this format's generation failed outright
}

export interface RunResult {
  slug: string;
  brief: Brief;
  results: AdaptResult[];
  imageResults: ImageAdaptResult[];
}
