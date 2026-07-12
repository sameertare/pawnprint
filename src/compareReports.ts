import './style.css';
import { parseMarkdownReport } from './markdown';
import { aggregate, scorePct } from './aggregate';
import type { Aggregates } from './aggregate';
import type { ReportData } from './types';
import { compareReports, betterSide, headToHead } from './reportCompare';
import type { DeltaRow, OpeningDelta } from './reportCompare';
import { renderLineChartSvg } from './linechart';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

interface Slot {
  report: ReportData | null;
  agg: Aggregates | null;
}
const slots: { a: Slot; b: Slot } = { a: { report: null, agg: null }, b: { report: null, agg: null } };

const resultsEl = $('#results');
const loadErrorEl = $('#load-error');
const headerCardEl = $('#header-card');

function setupSlot(letter: 'a' | 'b') {
  const dropzone = $(`#dropzone-${letter}`);
  const fileInput = $(`#file-${letter}`) as HTMLInputElement;
  const summaryEl = $(`#summary-${letter}`);

  async function load(file: File) {
    loadErrorEl.textContent = '';
    const text = await file.text();
    const data = parseMarkdownReport(text);
    if (!data) {
      // Clear this slot rather than leaving a stale successful load in place — otherwise a
      // failed re-upload would silently leave the old comparison showing, which looks like it
      // reflects the just-rejected file.
      slots[letter] = { report: null, agg: null };
      summaryEl.innerHTML = `<span class="chip">⚠ Could not read this file as a report.md</span>`;
      loadErrorEl.textContent = `"${file.name}" doesn't look like a report.md saved from Performance Analysis (no embedded data block found).`;
      resultsEl.hidden = true;
      return;
    }
    slots[letter] = { report: data, agg: aggregate(data.games) };
    const updated = data.meta.updatedAt ? data.meta.updatedAt.slice(0, 10) : data.meta.createdAt.slice(0, 10);
    summaryEl.innerHTML = `<span class="chip">✓ <b>${esc(data.meta.username)}</b> — ${data.games.length} game(s), updated ${esc(updated)}</span>`;
    tryRender();
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) void load(fileInput.files[0]);
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files[0];
    if (file) void load(file);
  });
}
setupSlot('a');
setupSlot('b');

function deltaClass(row: DeltaRow): string {
  const side = betterSide(row);
  if (side === 'b') return 'pos';
  if (side === 'a') return 'neg';
  return '';
}

function fmt(v: number | null, suffix: string): string {
  return v === null ? '—' : v + suffix;
}

function deltaRowsTableHtml(rows: DeltaRow[]): string {
  const trs = rows
    .map((r) => {
      const cls = deltaClass(r);
      const deltaStr = r.delta === null ? '—' : (r.delta > 0 ? '+' : '') + r.delta + r.suffix;
      return `<tr>
        <td>${esc(r.label)}</td>
        <td class="num">${fmt(r.a, r.suffix)}</td>
        <td class="num">${fmt(r.b, r.suffix)}</td>
        <td class="num ${cls}"><b>${deltaStr}</b></td>
      </tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Metric</th><th class="num">A</th><th class="num">B</th><th class="num">Δ (B − A)</th></tr></thead><tbody>${trs}</tbody></table>`;
}

function openingsTableHtml(rows: OpeningDelta[]): string {
  if (!rows.length) return '<p class="hint">No openings with enough games in either report.</p>';
  const trs = rows
    .map((r) => {
      const status = r.a && r.b ? '' : ` <span class="hint">(only in ${r.a ? 'A' : 'B'})</span>`;
      const scoreA = r.a ? scorePct(r.a) + '%' : '—';
      const scoreB = r.b ? scorePct(r.b) + '%' : '—';
      const cls = r.scoreDelta === null ? '' : r.scoreDelta > 0 ? 'pos' : r.scoreDelta < 0 ? 'neg' : '';
      const deltaStr = r.scoreDelta === null ? '—' : (r.scoreDelta > 0 ? '+' : '') + r.scoreDelta + '%';
      return `<tr>
        <td>${esc(r.family)}${status}</td>
        <td>${esc(r.eco || '—')}</td>
        <td class="num">${r.a?.games ?? '—'}</td>
        <td class="num">${scoreA}</td>
        <td class="num">${r.b?.games ?? '—'}</td>
        <td class="num">${scoreB}</td>
        <td class="num ${cls}"><b>${deltaStr}</b></td>
      </tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Opening</th><th>ECO</th><th class="num">A games</th><th class="num">A score</th><th class="num">B games</th><th class="num">B score</th><th class="num">Δ score</th></tr></thead><tbody>${trs}</tbody></table>`;
}

function tryRender() {
  if (!slots.a.agg || !slots.b.agg || !slots.a.report || !slots.b.report) return;
  const cmp = compareReports(slots.a.agg, slots.b.agg);

  const ra = slots.a.report, rb = slots.b.report;
  const sameName = ra.meta.username.trim().toLowerCase() === rb.meta.username.trim().toLowerCase();
  const h2h = headToHead(cmp);

  const verdictHtml = (() => {
    if (h2h.leader === 'tie') return `<p class="hint">Dead even — ${h2h.aWins} metrics each${h2h.ties ? `, ${h2h.ties} tied` : ''}.</p>`;
    const winnerName = h2h.leader === 'a' ? ra.meta.username : rb.meta.username;
    const winCount = h2h.leader === 'a' ? h2h.aWins : h2h.bWins;
    const loseCount = h2h.leader === 'a' ? h2h.bWins : h2h.aWins;
    return `<p class="hint"><b class="pos">${esc(winnerName)}</b> comes out ahead, leading on ${winCount} of ${winCount + loseCount + h2h.ties} compared metrics (${loseCount} to ${winnerName === ra.meta.username ? rb.meta.username : ra.meta.username}${h2h.ties ? `, ${h2h.ties} tied` : ''}).</p>`;
  })();

  headerCardEl.innerHTML = sameName
    ? `
    <h2>Comparing progress</h2>
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${esc(ra.meta.username)}</span><span class="label">Report A · ${esc(ra.games.length.toString())} games</span></div>
      <div class="stat-card"><span class="big">${esc(rb.meta.username)}</span><span class="label">Report B · ${esc(rb.games.length.toString())} games</span></div>
    </div>
  `
    : `
    <h2>Head-to-head</h2>
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${esc(ra.meta.username)}</span><span class="label">Player A · ${esc(ra.games.length.toString())} games</span></div>
      <div class="stat-card"><span class="big">${esc(rb.meta.username)}</span><span class="label">Player B · ${esc(rb.games.length.toString())} games</span></div>
    </div>
    ${verdictHtml}
  `;

  $('#overview-table').innerHTML = deltaRowsTableHtml(cmp.overview);
  $('#white-table').innerHTML = deltaRowsTableHtml(cmp.byColorWhite);
  $('#black-table').innerHTML = deltaRowsTableHtml(cmp.byColorBlack);

  $('#timeclass-tables').innerHTML = cmp.byTimeClass.length
    ? cmp.byTimeClass.map((t) => `<h3>${esc(t.timeClass)}</h3>${deltaRowsTableHtml(t.rows)}`).join('')
    : '<p class="hint">No time-control data in either report.</p>';

  $('#phase-tables').innerHTML = cmp.phases
    .map((p) => `<h3>${p.phase[0].toUpperCase() + p.phase.slice(1)}</h3>${deltaRowsTableHtml(p.rows)}`)
    .join('');

  $('#tactics-table').innerHTML = deltaRowsTableHtml(cmp.tactics);
  $('#patterns-table').innerHTML = deltaRowsTableHtml(cmp.patterns);
  $('#openings-table').innerHTML = openingsTableHtml(cmp.openings);

  const otcEl = $('#openings-by-timeclass-table');
  otcEl.innerHTML = cmp.openingsByTimeClass.length
    ? cmp.openingsByTimeClass.map((t) => `<h3>${esc(t.timeClass)}</h3>${openingsTableHtml(t.openings)}`).join('')
    : '<p class="hint">No time-control data in either report.</p>';

  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- trend across 3+ reports ----------
interface TrendEntry {
  report: ReportData;
  agg: Aggregates;
  date: string; // updatedAt (fallback createdAt), used to sort chronologically
}
let trendEntries: TrendEntry[] = [];

const trendDropzone = $('#trend-dropzone');
const trendFileInput = $('#trend-file') as HTMLInputElement;
const trendSummaryEl = $('#trend-summary');
const trendErrorEl = $('#trend-error');
const trendResultsEl = $('#trend-results');
const trendClearBtn = $('#trend-clear') as HTMLButtonElement;

async function loadTrendFiles(files: File[]) {
  trendErrorEl.textContent = '';
  const errors: string[] = [];
  for (const file of files) {
    const text = await file.text();
    const data = parseMarkdownReport(text);
    if (!data) {
      errors.push(`"${file.name}" doesn't look like a report.md (no embedded data block found).`);
      continue;
    }
    trendEntries.push({
      report: data,
      agg: aggregate(data.games),
      date: data.meta.updatedAt || data.meta.createdAt,
    });
  }
  if (errors.length) trendErrorEl.textContent = errors.join(' ');
  renderTrend();
}

trendFileInput.addEventListener('change', () => {
  if (trendFileInput.files?.length) void loadTrendFiles([...trendFileInput.files]);
  trendFileInput.value = '';
});
trendDropzone.addEventListener('dragover', (e) => { e.preventDefault(); trendDropzone.classList.add('dragover'); });
trendDropzone.addEventListener('dragleave', () => trendDropzone.classList.remove('dragover'));
trendDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  trendDropzone.classList.remove('dragover');
  const files = e.dataTransfer?.files;
  if (files?.length) void loadTrendFiles([...files]);
});
trendClearBtn.addEventListener('click', () => {
  trendEntries = [];
  trendErrorEl.textContent = '';
  renderTrend();
});

function renderTrend() {
  trendSummaryEl.innerHTML = trendEntries
    .map((t) => `<span class="chip">✓ <b>${esc(t.report.meta.username)}</b> — ${t.report.games.length} game(s), ${esc(t.date.slice(0, 10))}</span>`)
    .join(' ');
  trendClearBtn.hidden = trendEntries.length === 0;

  if (trendEntries.length < 2) {
    trendResultsEl.hidden = true;
    return;
  }

  const sorted = [...trendEntries].sort((x, y) => x.date.localeCompare(y.date));
  const usernames = new Set(sorted.map((t) => t.report.meta.username.trim().toLowerCase()));
  const mismatchNote = usernames.size > 1
    ? `<p class="hint">⚠ These reports belong to different players (${[...new Set(sorted.map((t) => t.report.meta.username))].map(esc).join(', ')}) — charting anyway, in date order, but a trend usually only makes sense for one player over time.</p>`
    : '';

  const xLabels = sorted.map((t) => t.date.slice(0, 10));
  $('#trend-chart').innerHTML = `
    ${mismatchNote}
    ${renderLineChartSvg(
      [
        { label: 'Score %', values: sorted.map((t) => scorePct(t.agg.total)), color: 'var(--accent)' },
        { label: 'Accuracy %', values: sorted.map((t) => t.agg.overallAccuracy), color: 'var(--gold)' },
      ],
      { xLabels, yMin: 0, yMax: 100, ySuffix: '%' }
    )}
  `;

  const rows = sorted
    .map(
      (t) => `<tr>
        <td>${esc(t.date.slice(0, 10))}</td>
        <td>${esc(t.report.meta.username)}</td>
        <td class="num">${t.report.games.length}</td>
        <td class="num">${scorePct(t.agg.total)}%</td>
        <td class="num">${t.agg.overallAccuracy !== null ? t.agg.overallAccuracy + '%' : '—'}</td>
      </tr>`
    )
    .join('');
  $('#trend-table').innerHTML = `<table><thead><tr><th>Date</th><th>Player</th><th class="num">Games</th><th class="num">Score</th><th class="num">Accuracy</th></tr></thead><tbody>${rows}</tbody></table>`;

  trendResultsEl.hidden = false;
}
