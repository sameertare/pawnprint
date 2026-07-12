/** Shared multi-series line chart — used for the report trend chart (Compare Reports) and the
 *  time-usage-by-move chart (Performance Analysis). Deliberately generic: callers pass already-
 *  computed numeric series, this only handles layout/scaling/rendering. */

export interface ChartSeries {
  label: string;
  values: (number | null)[];
  color: string; // CSS color or var(--x)
}

export interface LineChartOptions {
  width?: number;
  height?: number;
  xLabels?: string[];
  yMin?: number;
  yMax?: number;
  ySuffix?: string;
}

function buildPath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  let drawing = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { drawing = false; continue; }
    d += (drawing ? ' L ' : ' M ') + x(i).toFixed(2) + ' ' + y(v).toFixed(2);
    drawing = true;
  }
  return d.trim();
}

export function renderLineChartSvg(series: ChartSeries[], opts: LineChartOptions = {}): string {
  const w = opts.width ?? 640;
  const h = opts.height ?? 200;
  const padL = 40, padR = 12, padT = 12, padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const allVals = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!allVals.length) return `<p class="hint">Not enough data to chart yet.</p>`;
  const yMin = opts.yMin ?? Math.min(0, ...allVals);
  const yMax = opts.yMax ?? Math.max(...allVals, yMin + 1);
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const gridVals = [yMin, (yMin + yMax) / 2, yMax];
  const grid = gridVals
    .map(
      (v) =>
        `<line x1="${padL}" y1="${y(v).toFixed(2)}" x2="${w - padR}" y2="${y(v).toFixed(2)}" class="chart-grid" />
         <text x="${padL - 6}" y="${(y(v) + 3).toFixed(2)}" class="chart-axis-label" text-anchor="end">${Math.round(v)}${opts.ySuffix ?? ''}</text>`
    )
    .join('');

  const xLabels = opts.xLabels ?? [];
  const labelEvery = Math.max(1, Math.ceil(xLabels.length / 8));
  const xLabelEls = xLabels
    .map((lbl, i) => {
      if (i % labelEvery !== 0 && i !== xLabels.length - 1) return '';
      return `<text x="${x(i).toFixed(2)}" y="${h - 4}" class="chart-axis-label" text-anchor="middle">${lbl}</text>`;
    })
    .join('');

  const lines = series
    .map((s) => {
      const path = buildPath(s.values, x, y);
      const dots = s.values
        .map((v, i) => (v == null ? '' : `<circle cx="${x(i).toFixed(2)}" cy="${y(v).toFixed(2)}" r="2.8" fill="${s.color}" />`))
        .join('');
      return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" />${dots}`;
    })
    .join('');

  const legend = series
    .map((s) => `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${s.color}"></span>${s.label}</span>`)
    .join('');

  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${w} ${h}" class="linechart" preserveAspectRatio="xMidYMid meet">
      ${grid}
      ${lines}
      ${xLabelEls}
    </svg>
    ${series.length > 1 ? `<div class="chart-legend">${legend}</div>` : ''}
  </div>`;
}
