/**
 * Shared evaluation-sparkline rendering — a compact line chart of white-perspective centipawns
 * across a game, used by both the Analyze report (static, per game) and the Live board
 * (interactive, click-to-seek on the currently loaded line).
 */

const CLAMP_CP = 1000; // ±10 pawns — keeps mate-score outliers from squashing the visual scale

function clampCp(cp: number): number {
  return Math.max(-CLAMP_CP, Math.min(CLAMP_CP, cp));
}

/** Map a (possibly null/unevaluated) eval array to an SVG path's "d" string over a 0..w × 0..h box. */
function buildPath(values: (number | null)[], w: number, h: number): string {
  const n = values.length;
  if (n < 2) return '';
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (cp: number) => h / 2 - (clampCp(cp) / CLAMP_CP) * (h / 2);
  let d = '';
  let drawing = false;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v == null) { drawing = false; continue; }
    d += (drawing ? ' L ' : ' M ') + x(i).toFixed(2) + ' ' + y(v).toFixed(2);
    drawing = true;
  }
  return d.trim();
}

export interface SparklineOptions {
  width?: number;
  height?: number;
  markIndex?: number; // draws a dot at this ply, e.g. the currently viewed position
}

/** A static (non-interactive) sparkline as a standalone SVG string — for the Analyze report. */
export function renderSparklineSvg(values: (number | null)[], opts: SparklineOptions = {}): string {
  const w = opts.width ?? 160;
  const h = opts.height ?? 32;
  if (values.length < 2) return `<svg class="sparkline" viewBox="0 0 ${w} ${h}"></svg>`;
  const path = buildPath(values, w, h);
  const mark = opts.markIndex != null && values[opts.markIndex] != null
    ? `<circle cx="${((opts.markIndex / (values.length - 1)) * w).toFixed(2)}" cy="${(h / 2 - (clampCp(values[opts.markIndex]!) / CLAMP_CP) * (h / 2)).toFixed(2)}" r="2.4" fill="var(--gold)" />`
    : '';
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" class="spark-zero" />
    <path d="${path}" class="spark-line" fill="none" />
    ${mark}
  </svg>`;
}

/**
 * An interactive sparkline mounted into `container`: renders on every call and wires up a click
 * handler that maps the click's x-position back to the nearest ply index, via `onSeek`.
 */
export function mountInteractiveSparkline(
  container: HTMLElement,
  values: (number | null)[],
  markIndex: number,
  onSeek: (index: number) => void
) {
  const w = 400, h = 48;
  container.innerHTML = renderSparklineSvg(values, { width: w, height: h, markIndex });
  const svg = container.querySelector('svg');
  if (!svg || values.length < 2) return;
  svg.style.cursor = 'pointer';
  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (values.length - 1));
    onSeek(Math.max(0, Math.min(values.length - 1, idx)));
  });
}
