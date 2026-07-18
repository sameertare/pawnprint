import './style.css';
import { parseMarkdownReport } from './markdown';
import { aggregate, scorePct } from './aggregate';
import type { Aggregates } from './aggregate';
import type { ReportData } from './types';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

interface RosterEntry {
  report: ReportData;
  agg: Aggregates;
  updatedAt: string; // meta.updatedAt, fallback createdAt — used for "keep latest per player" and sorting
}

// Keyed by lower-cased trimmed username — a re-dropped/updated report for the same player replaces
// the earlier one rather than adding a second card, so the roster always shows current status.
const roster = new Map<string, RosterEntry>();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const dropzone = $('#dropzone');
const fileInput = $('#file-input') as HTMLInputElement;
const fileSummary = $('#file-summary');
const loadError = $('#load-error');
const resultsEl = $('#results');
const rosterGrid = $('#roster-grid');
const rosterCount = $('#roster-count');
const sortSelect = $('#sort-select') as HTMLSelectElement;
const clearBtn = $('#clear-roster') as HTMLButtonElement;
const loadServerAllBtn = $('#load-server-all') as HTMLButtonElement;
const serverStatus = $('#server-status');

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function playerKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Parse one report.md's text and fold it into the roster (replacing an older report for the same
 *  player). Returns an error message on failure, or null on success. */
function ingestReportText(text: string, label: string): string | null {
  // Wrapped defensively: an old-schema or hand-edited report.md can parse but still be missing a
  // field aggregate() assumes is present, which would otherwise throw out of this function and
  // silently abort the whole batch load (the caller's loop never reaches the next file, and
  // nothing gets rendered) with zero feedback to the user.
  try {
    const data = parseMarkdownReport(text);
    if (!data) return `"${label}" doesn't look like a report.md (no embedded data block found).`;
    const key = playerKey(data.meta.username);
    const updatedAt = data.meta.updatedAt || data.meta.createdAt;
    const existing = roster.get(key);
    if (existing && existing.updatedAt >= updatedAt) return null; // keep the newer one already in the roster
    roster.set(key, { report: data, agg: aggregate(data.games), updatedAt });
    return null;
  } catch (e) {
    return `"${label}" failed to load (${e instanceof Error ? e.message : 'unreadable report'}).`;
  }
}

async function loadFiles(files: File[]) {
  loadError.textContent = '';
  const errors: string[] = [];
  for (const file of files) {
    try {
      const text = await file.text();
      const err = ingestReportText(text, file.name);
      if (err) errors.push(err);
    } catch {
      errors.push(`"${file.name}" could not be read.`);
    }
  }
  if (errors.length) loadError.textContent = errors.join(' ');
  fileSummary.innerHTML = roster.size ? `<span class="chip">✓ ${roster.size} player(s) loaded</span>` : '';
  renderRoster();
}

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void loadFiles([...fileInput.files]);
  fileInput.value = '';
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = e.dataTransfer?.files;
  if (files?.length) void loadFiles([...files]);
});

clearBtn.addEventListener('click', () => {
  roster.clear();
  fileSummary.innerHTML = '';
  loadError.textContent = '';
  renderRoster();
});

loadServerAllBtn.addEventListener('click', async () => {
  serverStatus.textContent = 'Loading…';
  try {
    const listResp = await fetch('/api/reports');
    if (!listResp.ok) { serverStatus.textContent = `Server returned ${listResp.status}.`; return; }
    const list = (await listResp.json()) as { name: string; mtime: string }[];
    if (!list.length) { serverStatus.textContent = 'No reports saved on the server yet.'; return; }
    let ok = 0;
    for (const item of list) {
      try {
        const r = await fetch(`/api/reports/${encodeURIComponent(item.name)}`);
        if (!r.ok) continue;
        const text = await r.text();
        if (!ingestReportText(text, item.name)) ok++;
      } catch { /* skip a single bad fetch, keep going */ }
    }
    serverStatus.textContent = `Loaded ${ok} of ${list.length} saved report(s).`;
    renderRoster();
  } catch {
    serverStatus.textContent = 'Server not reachable — this feature needs the optional Node backend running.';
  }
});

sortSelect.addEventListener('change', renderRoster);

function sortedEntries(): RosterEntry[] {
  const entries = [...roster.values()];
  switch (sortSelect.value) {
    case 'score-desc': return entries.sort((a, b) => scorePct(b.agg.total) - scorePct(a.agg.total));
    case 'accuracy-asc': return entries.sort((a, b) => (a.agg.overallAccuracy ?? 100) - (b.agg.overallAccuracy ?? 100));
    case 'name': return entries.sort((a, b) => a.report.meta.username.localeCompare(b.report.meta.username));
    case 'updated': return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'score-asc':
    default:
      return entries.sort((a, b) => scorePct(a.agg.total) - scorePct(b.agg.total));
  }
}

function scoreClass(v: number): string {
  return v >= 60 ? 'pos' : v >= 40 ? 'mid' : 'neg';
}

function playerCardHtml(e: RosterEntry): string {
  const a = e.agg;
  const sc = scorePct(a.total);
  const weakest = a.weakest[0];
  const rec = a.recommendations[0];
  const dateStr = e.updatedAt ? e.updatedAt.slice(0, 10) : '—';
  return `<div class="roster-card">
    <div class="roster-card-head">
      <h3>${esc(e.report.meta.username)}</h3>
      <span class="hint">updated ${esc(dateStr)}</span>
    </div>
    <div class="roster-card-stats">
      <div class="rstat"><span class="big">${a.total.games}</span><span class="label">Games</span></div>
      <div class="rstat"><span class="big ${scoreClass(sc)}">${sc}%</span><span class="label">Score</span></div>
      <div class="rstat"><span class="big">${a.overallAccuracy !== null ? a.overallAccuracy + '%' : '—'}</span><span class="label">Accuracy</span></div>
      <div class="rstat"><span class="big ${a.tactics.blundersTotal > 0 ? 'neg' : ''}">${a.tactics.blundersTotal}</span><span class="label">Blunders</span></div>
    </div>
    ${weakest ? `<p class="roster-note">📉 Weakest opening: <b>${esc(weakest.family)}</b> (${scorePct(weakest)}% in ${weakest.games} games)</p>` : ''}
    ${rec ? `<p class="roster-note">🎯 Top focus: <b>${esc(rec.area)}</b></p>` : ''}
  </div>`;
}

function renderRoster() {
  rosterGrid.innerHTML = '';
  if (!roster.size) {
    resultsEl.hidden = true;
    return;
  }
  resultsEl.hidden = false;
  rosterCount.textContent = `${roster.size} player${roster.size === 1 ? '' : 's'} in your roster`;
  rosterGrid.innerHTML = sortedEntries().map(playerCardHtml).join('');
}
