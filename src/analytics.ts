/**
 * Home-page visitor analytics widget: total views + a world map of visitor locations.
 * Talks to the optional Node backend (/api/analytics). On a static host (no backend) it falls
 * back to a per-device localStorage count and a note that the live map needs the backend.
 */

import { renderWorldMapSvg } from './worldMap';
import type { MapPoint } from './worldMap';

interface AnalyticsData {
  totalViews: number;
  points: MapPoint[];
}

const SESSION_KEY = 'openfile-counted-session';
const LOCAL_VIEWS_KEY = 'openfile-local-views';

function fmt(n: number): string {
  return n.toLocaleString();
}

/** Record one visit per browser session, then return the latest aggregate stats. */
async function recordAndFetch(): Promise<AnalyticsData> {
  const firstThisSession = !sessionStorage.getItem(SESSION_KEY);
  if (firstThisSession) {
    // Record the hit first; only mark the session counted once the backend actually accepts it,
    // so a static host (no backend) still falls through to the local per-device counter.
    const post = await fetch('/api/analytics/hit', { method: 'POST' });
    if (!post.ok) throw new Error(`analytics hit ${post.status}`);
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private mode */ }
  }
  const r = await fetch('/api/analytics');
  if (!r.ok) throw new Error(`analytics ${r.status}`);
  return (await r.json()) as AnalyticsData;
}

function localFallback(): number {
  let n = 0;
  try {
    n = parseInt(localStorage.getItem(LOCAL_VIEWS_KEY) || '0', 10) || 0;
    if (!sessionStorage.getItem(SESSION_KEY)) {
      n += 1;
      localStorage.setItem(LOCAL_VIEWS_KEY, String(n));
      sessionStorage.setItem(SESSION_KEY, '1');
    }
  } catch { n = 1; }
  return n;
}

function statTile(value: string, label: string): string {
  return `<div class="an-stat"><div class="an-stat-num">${value}</div><div class="an-stat-label">${label}</div></div>`;
}

export async function initAnalytics(containerId: string): Promise<void> {
  const el = document.getElementById(containerId);
  if (!el) return;

  try {
    const data = await recordAndFetch();
    const countries = new Set(data.points.map((p) => p.country).filter(Boolean));
    el.innerHTML = `
      <div class="an-stats">
        ${statTile(fmt(data.totalViews), 'Total visits')}
        ${statTile(fmt(data.points.length), 'Locations')}
        ${statTile(fmt(countries.size), 'Countries')}
      </div>
      <div class="an-map">${renderWorldMapSvg(data.points)}</div>
      ${data.points.length === 0 ? '<p class="an-note hint">No mapped locations yet — dots appear here as visitors arrive.</p>' : ''}
    `;
  } catch {
    // No backend (static host) — show a per-device count and an empty map with a note.
    const local = localFallback();
    el.innerHTML = `
      <div class="an-stats">
        ${statTile(fmt(local), 'Your visits (this device)')}
      </div>
      <div class="an-map">${renderWorldMapSvg([])}</div>
      <p class="an-note hint">Live global counts and the visitor map need the OpenFile backend running (this static build tracks visits per device only).</p>
    `;
  }
}
