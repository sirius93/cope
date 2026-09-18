export interface FormatSpec {
  id: string;
  platform: string;
  kind: "longform" | "midform" | "shortform" | "visual" | "meta";
  outputSchema: "string" | "string[]";
  limits: Record<string, number>;
  rules: string[];
}

export interface FormatDefinition extends FormatSpec {
  promptTemplate: string;
}

export interface ImageFormatSpec {
  id: string;
  platform: string;
  kind: "visual";
  size: string; // "WIDTHxHEIGHT"
  textOverlay: boolean; // whether the local renderer should composite headline/subhead
  slides?: { min: number; max: number }; // only for multi-slide formats (e.g. carousel)
  bundlePdf?: boolean; // also assemble all slides into one PDF (e.g. LinkedIn document posts)
  rules: string[];
}

export interface ImageFormatDefinition extends ImageFormatSpec {
  promptTemplate: string;
}
