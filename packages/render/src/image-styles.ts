// Shared by local cards, generated-image prompts, and text overlays.
export const IMAGE_STYLES = {
  editorial: {
    description: "Warm paper, serif headlines, quiet magazine layout (default)",
    background: "#f5f2eb", ink: "#242522", muted: "#555750", accent: "#80604a", rule: "#d7d1c5",
    headlineFont: "Georgia, 'Times New Roman', serif", bodyFont: "Arial, sans-serif", weight: 400,
    direction: "Restrained editorial illustration for a thoughtful print magazine. Warm ivory paper, charcoal ink, muted earth accents, flat forms and generous negative space. One relevant visual idea, composed asymmetrically. No glossy 3D, stock-business imagery, decorative gradients, or visual clutter.",
  },
  minimal: {
    description: "White space, crisp sans-serif type, monochrome geometry",
    background: "#ffffff", ink: "#17191b", muted: "#50545a", accent: "#343b43", rule: "#e0e3e6",
    headlineFont: "Arial, sans-serif", bodyFont: "Arial, sans-serif", weight: 700,
    direction: "Minimal Swiss graphic design. White or very light neutral background, near-black flat geometric forms, strict alignment and abundant negative space. Reduce the subject to one clear silhouette or arrangement. No gradients, textures, shadows, glossy 3D, or ornamental icons.",
  },
  blueprint: {
    description: "Dark navy, fine construction lines, technical typography",
    background: "#132a38", ink: "#ecf2f4", muted: "#b9cad3", accent: "#91b7c7", rule: "#34515f",
    headlineFont: "'Courier New', monospace", bodyFont: "'Courier New', monospace", weight: 400,
    direction: "Restrained technical blueprint. Deep slate navy paper, thin pale-blue construction lines, orthographic or exploded-view geometry and sparse precise detail. Depict only relationships supported by the brief. No neon glow, futuristic HUDs, fake charts, decorative dashboards, or glossy 3D.",
  },
  sketch: {
    description: "Off-white paper, graphite lines, understated notebook feel",
    background: "#faf8f1", ink: "#30312d", muted: "#5d5e56", accent: "#666a59", rule: "#cbc9bd",
    headlineFont: "Georgia, 'Times New Roman', serif", bodyFont: "Arial, sans-serif", weight: 400,
    direction: "Observational graphite sketch on off-white paper. Delicate pencil contours, sparse cross-hatching and a single muted sage accent. A careful explanatory notebook drawing with plenty of blank paper. No cartoon mascots, stickers, scribble clutter, fake handwriting, photorealism, or glossy 3D.",
  },
} as const;

export type ImageStyle = keyof typeof IMAGE_STYLES;

export function parseImageStyle(value: unknown): ImageStyle {
  if (typeof value !== "string" || !Object.hasOwn(IMAGE_STYLES, value)) {
    throw new Error(`Unknown image style "${String(value)}". Choose: ${Object.keys(IMAGE_STYLES).join(", ")}`);
  }
  return value as ImageStyle;
}
