import { CATEGORY_DISPLAY_COLORS } from "~/modules/categories/category-palette";

/**
 * Colors for the categories a CSV import invents.
 *
 * The palette starts empty and only ever grows here, which is why `colors` is re-read on every pull
 * rather than once — a client holding a stale palette would draw the new categories untinted. The
 * ids belong to the server (`colors` is keyed by a serial and shared by every user), so what the
 * client mints is the hex; `pushChanges` turns it into a row, and `hex` being unique is what makes
 * two devices importing the same file converge on one palette entry rather than two.
 */

function toHex(x: number): string {
  return Math.round(255 * x)
    .toString(16)
    .padStart(2, "0");
}

function hslToHex(hue: number, saturationPct: number, lightnessPct: number): string {
  const s = saturationPct / 100;
  const l = lightnessPct / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Generates `count` random hex colors that collide with neither `existingHexes` nor each other.
 *
 * The established proof-sheet colors are used first. Larger imports continue through restrained
 * baked, husk, and dry-ink hue bands instead of introducing arbitrary neon or cool colors.
 */
export function generateUniqueHexColors(count: number, existingHexes: Iterable<string>): string[] {
  const used = new Set(existingHexes);
  const result: string[] = [];

  for (const color of CATEGORY_DISPLAY_COLORS) {
    if (result.length >= count) break;
    if (used.has(color)) continue;
    used.add(color);
    result.push(color);
  }

  const hueBands = [
    { start: 22, width: 24 },
    { start: 52, width: 38 },
    { start: 98, width: 28 },
    { start: 330, width: 24 },
  ] as const;
  let attempts = 0;

  while (result.length < count && attempts < count * 50 + 200) {
    attempts++;
    const band = hueBands[Math.floor(Math.random() * hueBands.length)];
    const hue = band.start + Math.floor(Math.random() * band.width);
    const saturation = 34 + Math.floor(Math.random() * 22);
    const lightness = 38 + Math.floor(Math.random() * 16);
    const hex = hslToHex(hue, saturation, lightness);
    if (used.has(hex)) continue;
    used.add(hex);
    result.push(hex);
  }

  if (result.length < count) throw new Error("Could not generate enough unique category colors.");
  return result;
}
