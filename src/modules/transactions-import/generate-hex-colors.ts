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
 * Drawn from a band of the HSL space rather than the whole of it — mid lightness, decent saturation
 * — so every category tag stays legible against both themes.
 */
export function generateUniqueHexColors(count: number, existingHexes: Iterable<string>): string[] {
  const used = new Set(existingHexes);
  const result: string[] = [];
  let attempts = 0;

  while (result.length < count && attempts < count * 50 + 200) {
    attempts++;
    const hue = Math.floor(Math.random() * 360);
    const saturation = 55 + Math.floor(Math.random() * 25);
    const lightness = 45 + Math.floor(Math.random() * 15);
    const hex = hslToHex(hue, saturation, lightness);
    if (used.has(hex)) continue;
    used.add(hex);
    result.push(hex);
  }

  if (result.length < count) throw new Error("Could not generate enough unique category colors.");
  return result;
}
