// OKLab measures perceptual distance, unlike RGB or a hash of the tool name.
// Allocate against the complete session so custom tools get distinct colors too.
export const LLM_COLOR = '#6b7280';
export const ERROR_COLOR = '#ef4444';
type Lab = readonly [number, number, number];
export interface ToolStyle { backgroundColor: string; backgroundImage?: string }

export function toOklab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function colorDistance(a: Lab, b: Lab): number {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}

const reserved = [LLM_COLOR, ERROR_COLOR].map(toOklab);
const candidates: { color: string; lab: Lab }[] = [];
// Sample the actual sRGB gamut; keep bright, saturated colors on the dark chart.
for (let r = 0; r <= 255; r += 17) {
  for (let g = 0; g <= 255; g += 17) {
    for (let b = 0; b <= 255; b += 17) {
      const color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      const lab = toOklab(color);
      if (lab[0] >= 0.67 && lab[0] <= 0.9 && Math.hypot(lab[1], lab[2]) >= 0.12
        && reserved.every(other => colorDistance(lab, other) >= 0.18)) {
        candidates.push({ color, lab });
      }
    }
  }
}

/** Deterministic for a tool set, independent of API ordering or duplicate calls.
 * Greedy maximin selection separates each color from ALL previously used colors.
 * A finite display cannot offer unlimited distinguishable colors: once distance
 * falls below 0.12 OKLab units, add a distinct stripe angle/spacing as a second cue.
 */
export function createToolStyles(names: readonly string[]): ReadonlyMap<string, ToolStyle> {
  const styles = new Map<string, ToolStyle>();
  const pool = candidates.map(candidate => ({ ...candidate,
    distance: Math.min(...reserved.map(other => colorDistance(candidate.lab, other))),
  }));
  for (const name of [...new Set(names)].sort()) {
    let best = pool[0];
    for (const candidate of pool) if (candidate.distance > best.distance) best = candidate;
    const index = styles.size;
    styles.set(name, {
      backgroundColor: best.color,
      ...(best.distance < 0.12 ? {
        backgroundImage: `repeating-linear-gradient(${45 + (index % 4) * 45}deg, transparent 0 ${3 + Math.floor(index / 4)}px, rgba(0,0,0,.55) ${3 + Math.floor(index / 4)}px ${5 + Math.floor(index / 4)}px)`,
      } : {}),
    });
    for (const candidate of pool) {
      candidate.distance = Math.min(candidate.distance, colorDistance(candidate.lab, best.lab));
    }
  }
  return styles;
}
