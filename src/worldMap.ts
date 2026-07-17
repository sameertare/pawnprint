/**
 * Self-contained dotted world map (no external tiles / requests).
 * Land is drawn as a grid of dots sampled from simplified continent polygons; visitor locations
 * are overlaid as brighter, larger dots. Equirectangular projection.
 */

const W = 1000;
const H = 500;

export interface MapPoint {
  lat: number;
  lng: number;
  city?: string;
  country?: string;
  count: number;
}

// Simplified continent outlines as [lng, lat] rings. Deliberately rough — the dot grid sampled
// from them reads as continents without needing precise geography.
const CONTINENTS: [number, number][][] = [
  // North America
  [[-168, 65], [-160, 71], [-140, 70], [-120, 71], [-95, 72], [-82, 73], [-62, 60], [-56, 52],
   [-66, 45], [-70, 42], [-75, 35], [-81, 25], [-97, 25], [-105, 20], [-112, 24], [-118, 30],
   [-124, 36], [-125, 43], [-130, 51], [-140, 58], [-152, 59], [-165, 60], [-168, 65]],
  // Greenland
  [[-45, 60], [-42, 70], [-30, 72], [-18, 70], [-20, 76], [-32, 82], [-46, 82], [-56, 76], [-50, 68], [-45, 60]],
  // South America
  [[-80, 8], [-70, 11], [-60, 10], [-50, 0], [-43, -3], [-35, -6], [-38, -14], [-48, -25],
   [-58, -35], [-66, -43], [-69, -52], [-74, -52], [-75, -45], [-72, -33], [-70, -18], [-79, -5], [-80, 8]],
  // Africa
  [[-16, 15], [-10, 28], [0, 33], [11, 34], [25, 32], [33, 31], [43, 12], [51, 12], [42, -2],
   [40, -12], [35, -22], [25, -34], [18, -35], [12, -16], [8, 4], [-8, 5], [-16, 15]],
  // Europe
  [[-10, 36], [-9, 44], [-2, 48], [2, 51], [-5, 58], [6, 62], [14, 66], [28, 70], [40, 66],
   [42, 52], [30, 46], [28, 41], [20, 40], [8, 38], [-2, 37], [-10, 36]],
  // Asia
  [[30, 46], [30, 60], [42, 66], [62, 70], [90, 73], [113, 74], [140, 72], [162, 68], [180, 66],
   [180, 60], [162, 55], [145, 44], [140, 34], [122, 30], [120, 22], [108, 20], [100, 8], [95, 15],
   [90, 22], [80, 8], [77, 8], [72, 20], [60, 25], [50, 30], [46, 40], [40, 39], [34, 43], [30, 46]],
  // Australia
  [[113, -22], [122, -18], [130, -12], [138, -12], [143, -11], [147, -20], [153, -28], [150, -38],
   [140, -38], [130, -32], [118, -35], [114, -30], [113, -22]],
  // Southeast Asia / Indonesia (rough strip)
  [[95, 6], [105, 2], [118, 2], [128, 2], [140, -4], [150, -6], [140, -9], [120, -9], [108, -7], [98, 0], [95, 6]],
  // Japan (rough)
  [[130, 32], [136, 35], [141, 40], [143, 43], [140, 37], [136, 34], [132, 31], [130, 32]],
  // Madagascar
  [[43, -13], [50, -15], [50, -25], [45, -25], [43, -13]],
];

function project(lng: number, lat: number): [number, number] {
  return [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];
}

function inPolygon(lng: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isLand(lng: number, lat: number): boolean {
  for (const c of CONTINENTS) if (inPolygon(lng, lat, c)) return true;
  return false;
}

// Precompute the land dot grid once (module load) — it never changes.
const LAND_DOTS: [number, number][] = (() => {
  const dots: [number, number][] = [];
  const step = 3.2;
  for (let lat = 80; lat >= -56; lat -= step) {
    for (let lng = -178; lng <= 178; lng += step) {
      if (isLand(lng, lat)) dots.push(project(lng, lat));
    }
  }
  return dots;
})();

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/** Build the world-map SVG string. `points` are visitor locations (aggregated by rounded coords). */
export function renderWorldMapSvg(points: MapPoint[]): string {
  const land = LAND_DOTS.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" class="wm-land"/>`).join('');

  const maxCount = points.reduce((m, p) => Math.max(m, p.count), 1);
  const hits = points
    .map((p) => {
      const [x, y] = project(p.lng, p.lat);
      const r = 3 + Math.sqrt(p.count / maxCount) * 7;
      const where = [p.city, p.country].filter(Boolean).join(', ') || 'Unknown';
      const label = `${where} — ${p.count} visit${p.count === 1 ? '' : 's'}`;
      return `<g class="wm-hit"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="wm-hit-dot"><title>${esc(label)}</title></circle></g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="world-map" role="img" aria-label="Map of visitor locations" preserveAspectRatio="xMidYMid meet">${land}${hits}</svg>`;
}
