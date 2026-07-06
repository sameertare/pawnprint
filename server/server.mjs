/**
 * PawnPrint backend (optional) — serves the built SPA and persists markdown reports.
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
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

const app = express();
app.use(express.json());
app.use(express.text({ type: ['text/markdown', 'text/plain'], limit: '20mb' }));

const safeName = (name) => /^[\w.-]{1,80}$/.test(name);

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

// ---- Middlegame Plans API (calls Claude API) ----
app.post('/api/middlegame-plans', async (req, res) => {
  const { opening, color } = req.body;
  if (!opening || typeof opening !== 'string' || !color || !['White', 'Black'].includes(color)) {
    return res.status(400).json({ error: 'Invalid opening or color' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const prompt = `You are a chess expert providing middlegame strategy guidance.

The user is asking for middlegame plans for: ${opening}
Playing as: ${color}

Provide a comprehensive middlegame strategy response in the following JSON format (and ONLY this format):
{
  "opening": "${opening}",
  "color": "${color === 'White' ? 'w' : 'b'}",
  "plans": [
    "Plan 1 detailed description",
    "Plan 2 detailed description",
    "Plan 3 detailed description",
    "Plan 4 detailed description",
    "Plan 5 detailed description"
  ],
  "keyThemes": [
    "Theme 1",
    "Theme 2",
    "Theme 3",
    "Theme 4",
    "Theme 5"
  ],
  "pawnStructure": "Detailed explanation of typical pawn structure for this opening as ${color}",
  "pieceActivation": "Detailed explanation of how to activate pieces in this opening",
  "typicalManeuvres": [
    "Maneuver 1",
    "Maneuver 2",
    "Maneuver 3",
    "Maneuver 4",
    "Maneuver 5"
  ],
  "commonTactics": [
    "Tactic 1",
    "Tactic 2",
    "Tactic 3",
    "Tactic 4",
    "Tactic 5"
  ]
}

Ensure all fields are present and contain detailed, practical chess advice specific to ${opening} when playing as ${color}. The response must be valid JSON with no additional text.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Claude API error:', error);
      return res.status(500).json({ error: 'Failed to generate plans' });
    }

    const data = await response.json();
    const content = data.content[0]?.text;

    if (!content) {
      return res.status(500).json({ error: 'No content from API' });
    }

    // Extract JSON from response (in case there's extra text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Could not parse JSON from response:', content);
      return res.status(500).json({ error: 'Invalid response format' });
    }

    const plans = JSON.parse(jsonMatch[0]);
    res.json(plans);
  } catch (e) {
    console.error('Error generating middlegame plans:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.use(express.static(DIST)); // includes the sample PGNs (bundled from public/)
// Unknown non-API, non-file routes fall back to the hub page.
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, () => {
  console.log(`PawnPrint running at http://localhost:${PORT}`);
});
