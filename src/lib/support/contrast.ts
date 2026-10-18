// WCAG contrast helpers. The widget lets owners pick one accent colour; we
// darken it until white text on it passes 4.5:1.

export function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function lin(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(rgb: [number, number, number]): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: [number, number, number] = [255, 255, 255];
const DARK_BG: [number, number, number] = [17, 24, 39]; // gray-900

function mix(c: [number, number, number], to: [number, number, number], t: number): [number, number, number] {
  return [c[0] + (to[0] - c[0]) * t, c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t];
}

// Darkest-needed adjustment so white text on `hex` reaches `min`.
export function accentForWhiteText(hex: string, fallback = "#047857", min = 4.5): string {
  const rgb = parseHex(hex) ?? parseHex(fallback)!;
  let cur = rgb;
  for (let i = 0; i <= 40 && contrastRatio(cur, WHITE) < min; i++) cur = mix(rgb, [0, 0, 0], (i + 1) / 40);
  return toHex(cur);
}

// A lightened variant for links and outlines on the dark theme background.
export function accentForDarkBackground(hex: string, fallback = "#047857", min = 4.5): string {
  const rgb = parseHex(hex) ?? parseHex(fallback)!;
  let cur = rgb;
  for (let i = 0; i <= 40 && contrastRatio(cur, DARK_BG) < min; i++) cur = mix(rgb, WHITE, (i + 1) / 40);
  return toHex(cur);
}

export function isHexColor(input: unknown): input is string {
  return typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input.trim());
}
