import './style.css';
import { parseMarkdownReport } from './markdown';
import { aggregate, scorePct } from './aggregate';
import type { Aggregates } from './aggregate';
import type { ReportData } from './types';
import { compareReports, betterSide } from './reportCompare';
import type { DeltaRow, OpeningDelta } from './reportCompare';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

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
  headerCardEl.innerHTML = `
    <h2>Comparing</h2>
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${esc(ra.meta.username)}</span><span class="label">Report A · ${esc(ra.games.length.toString())} games</span></div>
      <div class="stat-card"><span class="big">${esc(rb.meta.username)}</span><span class="label">Report B · ${esc(rb.games.length.toString())} games</span></div>
    </div>
    ${sameName ? '' : `<p class="hint">⚠ These reports have different usernames (<b>${esc(ra.meta.username)}</b> vs <b>${esc(rb.meta.username)}</b>) — comparing anyway, but double-check this is intentional.</p>`}
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

  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
