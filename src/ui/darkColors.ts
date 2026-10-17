/*
 * The document's own colours in dark mode. The converter writes the document's text colours,
 * highlights and shading into its stylesheet (and the odd `style` attribute), as hex or one of a
 * few CSS names; Word's "auto" colour comes out as `black` text or a `white` background. On a dark
 * page these would be unreadable, so each one gets its lightness inverted, keeping its hue and
 * saturation: dark text turns light, light shading dark, and text keeps its contrast with the
 * shading behind it.
 */

/** The names WmlToHtmlConverter emits (its `NamedColors`), as RGB. */
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  blue: [0, 0, 255],
  aqua: [0, 255, 255],
  green: [0, 128, 0],
  fuchsia: [255, 0, 255],
  red: [255, 0, 0],
  yellow: [255, 255, 0],
};

const COLOR = new RegExp(`#[0-9a-f]{3,8}\\b|rgba?\\([^)]*\\)|\\b(?:${Object.keys(NAMED).join('|')})\\b`, 'gi');
// A declaration of a property that takes a colour; custom properties (`--…`) don't match.
const DECLARATION = /(^|[;{\s])((?:background(?:-color)?|color|border(?:-[a-z]+)*|outline(?:-color)?|text-decoration(?:-color)?|column-rule(?:-color)?)\s*:)([^;{}]*)/gi;

type Rgba = [number, number, number, number];

function parse(color: string): Rgba | null {
  const lower = color.toLowerCase();
  const named = NAMED[lower];
  if (named) return [...named, 1];
  if (lower.startsWith('#')) {
    let hex = lower.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((digit) => digit + digit).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const value = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return [value(0), value(2), value(4), hex.length === 8 ? value(6) / 255 : 1];
  }
  const parts = lower.replace(/^rgba?\(|\)$/g, '').split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.slice(0, 3).some((part) => part.endsWith('%'))) return null;
  const [r, g, b] = parts.slice(0, 3).map(Number) as [number, number, number];
  const alphaPart = parts[3];
  const alpha = alphaPart === undefined ? 1 : alphaPart.endsWith('%') ? parseFloat(alphaPart) / 100 : Number(alphaPart);
  return [r, g, b, alpha].some(Number.isNaN) ? null : [r, g, b, alpha];
}

type Lab = [number, number, number];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** sRGB (0–255) to OKLab, whose L is perceived lightness (0–1). */
function toOklab([r, g, b]: Rgba): Lab {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to linear sRGB, unclamped (outside 0–1 when out of gamut). */
function toLinearRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The colour of lightness `L` and the hue of `a`, `b`, with as much of their chroma as sRGB holds. */
function inGamut(L: number, a: number, b: number): [number, number, number] {
  const fits = (k: number) => toLinearRgb([L, a * k, b * k]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let k = 1;
  if (!fits(1)) {
    let [low, high] = [0, 1];
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    k = low;
  }
  return toLinearRgb([L, a * k, b * k]).map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255)) as [number, number, number];
}

function format([r, g, b]: [number, number, number], alpha: number): string {
  if (alpha >= 1) return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `rgb(${r} ${g} ${b} / ${Math.round(alpha * 1000) / 1000})`;
}

// OKLab lightness ranges: text and lines end up in the light one, backgrounds in the dark one,
// which keeps them apart. Colours already in their range stay as they are.
const TEXT_MIN = 0.72;
const TEXT_MAX = 0.95;
const BACKGROUND_MIN = 0.2;
const BACKGROUND_MAX = 0.38;

/**
 * One colour for a dark page, with its hue. Text and lines darker than the light range are
 * lightened into it, the darkest the most (black becomes near-white); backgrounds lighter than
 * the dark range are darkened into it, the lightest the most (white becomes near-black), except
 * that vivid ones keep some lightness.
 */
export function darkColor(color: string, background: boolean): string {
  const rgba = parse(color);
  if (!rgba) return color;
  const [L, a, b] = toOklab(rgba);
  let lightness = L;
  if (background && L > BACKGROUND_MAX) {
    // Vivid ones (highlights) a little less, so that they still show.
    const chroma = Math.hypot(a, b);
    lightness = BACKGROUND_MAX - ((L - BACKGROUND_MAX) / (1 - BACKGROUND_MAX)) * (BACKGROUND_MAX - BACKGROUND_MIN);
    lightness = Math.min(BACKGROUND_MAX, lightness + chroma);
  } else if (!background && L < TEXT_MIN) {
    lightness = TEXT_MAX - (L / TEXT_MIN) * (TEXT_MAX - TEXT_MIN);
  } else {
    return color;
  }
  return format(inGamut(lightness, a, b), rgba[3]);
}

/** CSS declarations (a stylesheet, or a `style` attribute's value) with every colour made dark. */
export function darkColors(css: string): string {
  return css.replace(DECLARATION, (_match, before: string, property: string, value: string) => {
    const background = /^background/i.test(property);
    return before + property + value.replace(COLOR, (color) => darkColor(color, background));
  });
}
