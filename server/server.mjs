/**
 * OpenFile backend (optional) — serves the built SPA and persists markdown reports.
 * The app also runs fully static; this backend only adds server-side report storage.
 */
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REPORTS_DIR = path.join(ROOT, 'reports');
const ANALYTICS_FILE = path.join(ROOT, 'analytics.json');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

const app = express();
app.set('trust proxy', true); // so req.ip reflects X-Forwarded-For behind a host's proxy
app.use(express.json());
app.use(express.text({ type: ['text/markdown', 'text/plain'], limit: '20mb' }));

const safeName = (name) => /^[\w.-]{1,80}$/.test(name);

// ---- Visitor analytics (aggregated; no raw IPs are ever persisted) ----
// Stored shape: { totalViews, points: { "lat,lng": { lat, lng, city, country, count } } }
let analytics = { totalViews: 0, points: {} };
const geoCache = new Map(); // ip -> { lat, lng, city, country } | null (in-memory only)

async function loadAnalytics() {
  try {
    analytics = JSON.parse(await fs.readFile(ANALYTICS_FILE, 'utf8'));
    if (!analytics.points) analytics.points = {};
    if (typeof analytics.totalViews !== 'number') analytics.totalViews = 0;
  } catch { /* first run — keep defaults */ }
}
let writeQueue = Promise.resolve();
function saveAnalytics() {
  // Serialize writes so concurrent hits can't interleave and corrupt the file.
  writeQueue = writeQueue.then(() =>
    fs.writeFile(ANALYTICS_FILE, JSON.stringify(analytics), 'utf8').catch(() => {})
  );
  return writeQueue;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  return (
    ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') ||
    ip.startsWith('192.168.') || ip.startsWith('::ffff:127.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip === 'localhost'
  );
}

/** Best-effort, coarse (≈city-level) geolocation from an IP, cached in memory. */
async function geolocate(ip) {
  if (isPrivateIp(ip)) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  let result = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const d = await r.json();
      if (!d.error && typeof d.latitude === 'number' && typeof d.longitude === 'number') {
        result = { lat: d.latitude, lng: d.longitude, city: d.city || '', country: d.country_name || '' };
      }
    }
  } catch { /* offline / rate-limited — no point added */ }
  geoCache.set(ip, result);
  return result;
}

app.post('/api/analytics/hit', async (req, res) => {
  analytics.totalViews++;
  const geo = await geolocate(req.ip);
  if (geo) {
    // Round to whole degrees so dots cluster by region and no one is pinpointed.
    const lat = Math.round(geo.lat);
    const lng = Math.round(geo.lng);
    const key = `${lat},${lng}`;
    const p = analytics.points[key] || { lat, lng, city: geo.city, country: geo.country, count: 0 };
    p.count++;
    p.city = geo.city || p.city;
    p.country = geo.country || p.country;
    analytics.points[key] = p;
  }
  saveAnalytics();
  res.json({ ok: true, totalViews: analytics.totalViews });
});

app.get('/api/analytics', (_req, res) => {
  res.json({ totalViews: analytics.totalViews, points: Object.values(analytics.points) });
});

app.get('/api/reports', async (_req, res) => {
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const files = await fs.readdir(REPORTS_DIR);
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const stat = await fs.stat(path.join(REPORTS_DIR, f));
      out.push({ name: f.replace(/\.md$/, ''), mtime: stat.mtime.toISOString() });
    }
    out.sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/reports/:name', async (req, res) => {
  const { name } = req.params;
  if (!safeName(name)) return res.status(400).send('bad name');
  try {
    const md = await fs.readFile(path.join(REPORTS_DIR, name + '.md'), 'utf8');
    res.type('text/markdown').send(md);
  } catch {
    res.status(404).send('not found');
  }
});

app.put('/api/reports/:name', async (req, res) => {
  const { name } = req.params;
  if (!safeName(name)) return res.status(400).send('bad name');
  if (typeof req.body !== 'string' || !req.body.length) return res.status(400).send('empty body');
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORTS_DIR, name + '.md'), req.body, 'utf8');
  res.json({ ok: true, name });
});

// ---- Live lichess game relay (NDJSON -> SSE) ----
app.get('/api/live/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9]{8}$/.test(id)) return res.status(400).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const upstream = await fetch(`https://lichess.org/api/stream/game/${id}`, {
      headers: { Accept: 'application/x-ndjson' },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      send({ __meta: 'error', message: `Lichess returned ${upstream.status} — game not found or not viewable.` });
      return res.end();
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) res.write(`data: ${line}\n\n`);
      }
    }
    send({ __meta: 'end' });
    res.end();
  } catch (e) {
    if (!controller.signal.aborted) {
      try { send({ __meta: 'error', message: String(e && e.message ? e.message : e) }); res.end(); } catch { /* client gone */ }
    }
  }
});

app.use(express.static(DIST)); // includes the sample PGNs (bundled from public/)
// Unknown non-API, non-file routes fall back to the hub page.
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

await loadAnalytics();
app.listen(PORT, () => {
  console.log(`OpenFile running at http://localhost:${PORT}`);
});
