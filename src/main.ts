import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, splitPgn, tryParseGame } from './pgn';
import { Engine } from './engine';
import { analyzeGame, positionsNeeded } from './analyze';
import { aggregate, scorePct, themeUrl, opponentList, headToHeadWithOpponent } from './aggregate';
import type { Aggregates, OpeningRow, WDL, HeadToHeadOpponent } from './aggregate';
import { assessGame } from './gameAssessment';
import { mergeGames, parseMarkdownReport, renderMarkdown } from './markdown';
import type { GameRecord, ReportData, ReportMeta } from './types';
import { renderSparklineSvg } from './sparkline';
import { renderLineChartSvg } from './linechart';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { groupPlayerNames, nameKey } from './playerMatch';
import { buildAnnotatedPgn, downloadPgn } from './pgnExport';

registerServiceWorker();
initTheme();

// ---------- state ----------
let parsedGames: ParsedGame[] = [];
let baseReport: ReportData | null = null;
let records: GameRecord[] = [];
let currentMarkdown = '';
let currentAgg: Aggregates | null = null;
let detectedUsername: string | null = null;
let detectedMatchKeys: Set<string> | null = null;

// ---------- dom ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fileInput = $('#file-input') as HTMLInputElement;
const dropzone = $('#dropzone');
const fileSummary = $('#file-summary');
const configCard = $('#config-card');
const detectedPlayerName = $('#detected-player-name');
const detectedPlayerCount = $('#detected-player-count');
const depthSelect = $('#depth-select') as HTMLSelectElement;
const analyzeBtn = $('#analyze-btn') as HTMLButtonElement;
const progressWrap = $('#progress-wrap');
const progressFill = $('#progress-fill');
const progressText = $('#progress-text');
const resultsEl = $('#results');
const exportCard = $('#export-card');
const serverMsg = $('#server-msg');

function isPlayerNameMatch(name: string | undefined, matchKeys: Set<string>): boolean {
  return !!name && name !== '?' && matchKeys.has(nameKey(name));
}
function hasAnyPlayerName(g: ParsedGame, matchKeys: Set<string>): boolean {
  return isPlayerNameMatch(g.headers['White'], matchKeys) || isPlayerNameMatch(g.headers['Black'], matchKeys);
}
function hasAnyNameAtAll(g: ParsedGame): boolean {
  return (!!g.headers['White'] && g.headers['White'] !== '?') || (!!g.headers['Black'] && g.headers['Black'] !== '?');
}
// A chapter with no [White]/[Black] tags at all has no other player to attribute it to, so it's
// assumed to be the analyzed player's game (analyzeGame infers their color from the chapter title
// when possible).
function gamesForPlayer(matchKeys: Set<string>): ParsedGame[] {
  return parsedGames.filter((g) => (hasAnyNameAtAll(g) ? hasAnyPlayerName(g, matchKeys) : true));
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

// ---------- file loading ----------
async function handleFiles(files: FileList | File[]) {
  let newGames = 0;
  let mdLoaded = 0;
  let failed = 0;
  const failureCounts = new Map<string, { count: number; sample: string }>();
  const recordFailure = (f: ParseFailure) => {
    const existing = failureCounts.get(f.reason);
    if (existing) existing.count++;
    else failureCounts.set(f.reason, { count: 1, sample: f.snippet });
  };

  for (const file of Array.from(files)) {
    const text = await file.text();
    if (file.name.endsWith('.md') || text.includes('chess-insight:data:v1')) {
      const data = parseMarkdownReport(text);
      if (data) {
        baseReport = baseReport
          ? {
              version: 1,
              meta: {
                ...baseReport.meta,
                sessions: [...baseReport.meta.sessions, ...data.meta.sessions],
              },
              games: mergeGames(baseReport.games, data.games),
            }
          : data;
        mdLoaded++;
      } else failed++;
      continue;
    }
    const chunks = splitPgn(text);
    for (const chunk of chunks) {
      const { game, error } = tryParseGame(chunk);
      if (game) {
        parsedGames.push(game);
        newGames++;
      } else {
        failed++;
        if (error) recordFailure(error);
      }
    }
  }
  // de-dupe parsed games by id
  const seen = new Set<string>();
  parsedGames = parsedGames.filter((g) => {
    const id = gameId(g);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const chips: string[] = [];
  if (parsedGames.length) chips.push(`<span class="chip">♟ ${parsedGames.length} game(s) loaded from PGN</span>`);
  if (baseReport) chips.push(`<span class="chip">📄 previous report: ${baseReport.games.length} analyzed game(s) for <b>${esc(baseReport.meta.username)}</b></span>`);
  if (failed) chips.push(`<span class="chip">⚠ ${failed} item(s) could not be parsed</span>`);
  if (mdLoaded && !parsedGames.length) chips.push(`<span class="chip">Tip: add new PGN files to extend this report</span>`);
  let html = chips.join(' ');
  if (failureCounts.size) {
    const rows = [...failureCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(
        ([reason, { count, sample }]) =>
          `<li><b>${count}×</b> ${esc(reason)} <span class="hint">— e.g. "${esc(sample)}"</span></li>`
      )
      .join('');
    html += `<details class="parse-errors"><summary>Why ${failed} item(s) failed to parse</summary><ul>${rows}</ul></details>`;
  }
  fileSummary.innerHTML = html;

  if (parsedGames.length || baseReport) {
    const detected = detectMainPlayer();
    detectedUsername = detected?.name ?? null;
    detectedMatchKeys = detected?.matchKeys ?? null;
    detectedPlayerName.textContent = detectedUsername ?? '—';
    const total = detectedMatchKeys ? gamesForPlayer(detectedMatchKeys).length : 0;
    detectedPlayerCount.textContent = detectedMatchKeys ? ` — ${total} game${total === 1 ? '' : 's'} will be analyzed` : '';
    configCard.hidden = false;
    configCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Auto-detects who the report is for: the player appearing in the most games, weighted toward a
// loaded report's existing owner so re-uploads stay attributed to the same player. Name variants
// that likely refer to the same person (different casing, "Last, First" vs "First Last", or a
// nickname/first-name-only form) are folded together by groupPlayerNames() so a tournament roster
// with inconsistent naming doesn't silently drop that player's games from the report.
function detectMainPlayer(): { name: string; count: number; matchKeys: Set<string> } | null {
  const counts = new Map<string, number>();
  for (const g of parsedGames) {
    for (const key of ['White', 'Black'] as const) {
      const name = g.headers[key];
      if (!name || name === '?') continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (!counts.size && !baseReport) return null;
  if (baseReport && !counts.has(baseReport.meta.username)) counts.set(baseReport.meta.username, 0);

  const groups = groupPlayerNames(counts);
  const baseKey = baseReport ? nameKey(baseReport.meta.username) : null;
  const weight = (g: (typeof groups)[number]) => g.count + (baseKey && g.keys.has(baseKey) ? 10000 : 0);
  groups.sort((a, b) => weight(b) - weight(a));
  const best = groups[0];
  return { name: best.display, count: best.count, matchKeys: best.keys };
}

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void handleFiles(fileInput.files);
  fileInput.value = '';
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer?.files.length) void handleFiles(e.dataTransfer.files);
});
$('#load-sample').addEventListener('click', async () => {
  const resp = await fetch(`${import.meta.env.BASE_URL}samples/sample-games.pgn`);
  const text = await resp.text();
  const file = new File([text], 'sample-games.pgn');
  await handleFiles([file]);
});

// ---------- analysis ----------
analyzeBtn.addEventListener('click', () => void runAnalysis());

async function runAnalysis() {
  const username = detectedUsername;
  const matchKeys = detectedMatchKeys;
  if (!username || !matchKeys) return;
  const depth = parseInt(depthSelect.value, 10);
  const useEngine = depth > 0;

  analyzeBtn.disabled = true;
  progressWrap.hidden = false;

  const baseReportIsSamePlayer = !!baseReport && matchKeys.has(nameKey(baseReport.meta.username));

  // Skip games already analyzed in the loaded report (same id, same player).
  const knownIds = new Set((baseReportIsSamePlayer ? baseReport!.games : []).map((g) => g.id));
  const toAnalyze = gamesForPlayer(matchKeys).filter((g) => !knownIds.has(gameId(g)));

  let engine: Engine | null = null;
  try {
    if (useEngine && toAnalyze.some((g) => positionsNeeded(g, true) > 0)) {
      progressText.textContent = 'Loading Stockfish 16 (first load fetches the neural network — ~38 MB)…';
      engine = new Engine();
      await engine.init();
    }

    const totalPositions = toAnalyze.reduce((s, g) => s + positionsNeeded(g, useEngine), 0);
    let done = 0;
    const newRecords: GameRecord[] = [];
    for (let i = 0; i < toAnalyze.length; i++) {
      const g = toAnalyze[i];
      const label = g.headers['White'] && g.headers['Black']
        ? `${g.headers['White']} vs ${g.headers['Black']}`
        : g.headers['ChapterName'] || g.headers['Event'] || 'untitled game';
      progressText.textContent = `Analyzing game ${i + 1} of ${toAnalyze.length}… (${label})`;
      const rec = await analyzeGame(toAnalyze[i], {
        username,
        matchKeys,
        depth,
        engine,
        onPosition: () => {
          done++;
          if (totalPositions > 0) progressFill.style.width = `${(done / totalPositions) * 100}%`;
        },
      });
      newRecords.push(rec);
      if (totalPositions === 0) progressFill.style.width = `${((i + 1) / toAnalyze.length) * 100}%`;
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }

    const oldGames = baseReportIsSamePlayer ? baseReport!.games : [];
    records = mergeGames(oldGames, newRecords);

    const now = new Date().toISOString();
    const meta: ReportMeta = {
      username,
      createdAt: baseReport?.meta.createdAt ?? now,
      updatedAt: now,
      sessions: [
        ...(baseReport?.meta.sessions ?? []),
        ...(newRecords.length
          ? [{ date: now.slice(0, 10), gamesAdded: newRecords.length, source: 'PGN upload' }]
          : []),
      ],
    };

    currentAgg = aggregate(records);
    currentMarkdown = renderMarkdown(currentAgg, records, meta);
    renderResults(currentAgg, username, newRecords.length, oldGames.length);
    exportCard.hidden = false;
    progressFill.style.width = '100%';
    progressText.textContent = `Done — ${newRecords.length} new game(s) analyzed, ${records.length} total in report.`;
  } catch (err) {
    progressText.textContent = `Analysis error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  } finally {
    engine?.destroy();
    analyzeBtn.disabled = false;
  }
}

// ---------- rendering ----------
function pct(v: number | null, cls = true): string {
  if (v === null) return '—';
  const c = v >= 60 ? 'pos' : v >= 40 ? 'mid' : 'neg';
  return cls ? `<span class="${c}">${v}%</span>` : `${v}%`;
}

function wdlRow(label: string, w: WDL, extra = ''): string {
  return `<tr><td>${label}</td><td class="num">${w.games}</td><td class="num pos">${w.wins}</td><td class="num mid">${w.draws}</td><td class="num neg">${w.losses}</td><td class="num">${pct(scorePct(w))}</td>${extra}</tr>`;
}

function openingTableHtml(rows: OpeningRow[], emptyMsg: string): string {
  if (!rows.length) return `<p class="section-note">${emptyMsg}</p>`;
  return `<table><thead><tr><th>Opening</th><th>ECO</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th><th class="num">White/Black</th><th class="num">Accuracy</th></tr></thead><tbody>${rows
    .map(
      (o) =>
        `<tr><td>${esc(o.family)}</td><td>${esc(o.eco || '—')}</td><td class="num">${o.games}</td><td class="num pos">${o.wins}</td><td class="num mid">${o.draws}</td><td class="num neg">${o.losses}</td><td class="num">${pct(scorePct(o))}</td><td class="num">${o.asWhite}/${o.asBlack}</td><td class="num">${o.avgAccuracy !== null ? o.avgAccuracy + '%' : '—'}</td></tr>`
    )
    .join('')}</tbody></table>`;
}

function h2hBodyHtml(h2h: HeadToHeadOpponent): string {
  if (!h2h.games.length) return '<p class="section-note">No games found against this opponent.</p>';
  const openingsByFamily = new Map(h2h.openings.map((o) => [o.family, o]));
  return `
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${h2h.wdl.games}</span><span class="label">Games</span></div>
      <div class="stat-card"><span class="big">${h2h.wdl.wins}-${h2h.wdl.draws}-${h2h.wdl.losses}</span><span class="label">W-D-L</span></div>
      <div class="stat-card"><span class="big">${pct(scorePct(h2h.wdl))}</span><span class="label">Score</span></div>
    </div>
    <h3>Openings vs ${esc(h2h.opponent)}</h3>
    ${openingTableHtml(h2h.openings, 'No repeated openings against this opponent yet.')}
    <h3>Games</h3>
    ${gamesTableHtml(h2h.games, openingsByFamily)}
  `;
}

/** Renders one game's strength/weakness/overall assessment (see gameAssessment.ts) as the hidden
 *  detail row toggled by a game table row's 🩺 button. */
function assessmentHtml(g: GameRecord, openingsByFamily?: Map<string, OpeningRow>): string {
  const a = assessGame(g, openingsByFamily?.get(g.family));
  if (!a) return '<p class="section-note">No move-quality data for this game.</p>';
  const verdictCls = (v: 'strength' | 'weakness' | 'neutral') => (v === 'strength' ? 'pos' : v === 'weakness' ? 'neg' : 'mid');
  const verdictIcon = (v: 'strength' | 'weakness' | 'neutral') => (v === 'strength' ? '✓' : v === 'weakness' ? '✗' : '·');
  const phaseRows = a.phases
    .map(
      (p) =>
        `<li><span class="${verdictCls(p.verdict)}">${verdictIcon(p.verdict)} ${p.phase[0].toUpperCase() + p.phase.slice(1)}</span> — ${mdBold(esc(p.summary))}</li>`
    )
    .join('');
  const strengthsHtml = a.strengths.length
    ? `<p><b>Strengths</b></p><ul class="pattern-list">${a.strengths.map((s) => `<li><span class="pos">✓</span> ${mdBold(esc(s))}</li>`).join('')}</ul>`
    : '';
  const weaknessesHtml = a.weaknesses.length
    ? `<p><b>Weaknesses</b></p><ul class="pattern-list">${a.weaknesses.map((s) => `<li><span class="neg">✗</span> ${mdBold(esc(s))}</li>`).join('')}</ul>`
    : '';
  return `
    <p><b>Overall:</b> ${mdBold(esc(a.overall))}</p>
    <p><b>By phase</b></p>
    <ul class="pattern-list">${phaseRows}</ul>
    ${strengthsHtml}
    ${weaknessesHtml}
  `;
}

function gamesTableHtml(games: GameRecord[], openingsByFamily?: Map<string, OpeningRow>): string {
  if (!games.length) return '<p class="section-note">No games.</p>';
  const rows = [...games]
    .sort((x, y) => y.date.localeCompare(x.date))
    .map((g) => {
      const resultCls = g.result === 'win' ? 'pos' : g.result === 'loss' ? 'neg' : g.result === 'draw' ? 'mid' : '';
      const resultLabel =
        g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : g.result === 'draw' ? 'Draw' : 'Unfinished';
      const opponent = g.userColor === 'w' ? g.black : g.white;
      const colorGlyph = g.userColor === 'w' ? '♔' : '♚';
      const evalGraph = g.evalGraph ?? null;
      const spark = evalGraph && evalGraph.length > 1
        ? renderSparklineSvg(evalGraph, { width: 140, height: 28 })
        : `<span class="hint">no engine data</span>`;
      // Live & Engine can only load lichess games (chess.com has no public unauthenticated live-game API).
      const liveLink = /^https?:\/\/(www\.)?lichess\.org\//.test(g.site)
        ? `<a href="live.html?game=${encodeURIComponent(g.site)}" target="_blank" rel="noopener" title="Open in Live &amp; Engine">▶</a>`
        : '';
      const pgnBtn = g.sans?.length
        ? `<button class="btn-icon pgn-dl-btn" data-id="${esc(g.id)}" title="Download annotated PGN (engine evals + notes on flagged moves)">⬇</button>`
        : '';
      const assessBtn = g.analyzed
        ? `<button class="btn-icon assess-btn" data-id="${esc(g.id)}" title="Strengths &amp; weaknesses">🩺</button>`
        : '';
      const assessRow = g.analyzed
        ? `<tr class="explain-row assess-row" data-id="${esc(g.id)}" hidden><td></td><td colspan="6">${assessmentHtml(g, openingsByFamily)}</td></tr>`
        : '';
      return `<tr>
        <td>${esc(g.date)}</td>
        <td>${colorGlyph} ${esc(opponent)}</td>
        <td><span class="${resultCls}">${resultLabel}</span></td>
        <td>${esc(g.family)}</td>
        <td class="num">${g.accuracy.overall != null ? g.accuracy.overall + '%' : '—'}</td>
        <td class="spark-cell">${spark}</td>
        <td class="num">${liveLink} ${pgnBtn} ${assessBtn}</td>
      </tr>${assessRow}`;
    })
    .join('');
  return `<div class="games-table-wrap"><table><thead><tr>
      <th>Date</th><th>Opponent</th><th>Result</th><th>Opening</th><th class="num">Accuracy</th><th>Eval graph</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderGamesSection(games: GameRecord[], openings: OpeningRow[]): string {
  if (!games.length) return '';
  const openingsByFamily = new Map(openings.map((o) => [o.family, o]));
  return `<div class="card"><h2>📈 Games</h2>
    ${gamesTableHtml(games, openingsByFamily)}
    <p class="hint">The eval graph tracks the position's evaluation (white's perspective) across the whole game. Click ▶ to open a game in Live &amp; Engine and step through it move by move. Click ⬇ to download that game as a standard PGN with engine evals and flagged-move notes baked in as comments. Click 🩺 for a strengths/weaknesses breakdown of that game's opening, middlegame, and endgame.</p>
  </div>`;
}

function renderResults(a: Aggregates, username: string, newCount: number, oldCount: number) {
  const p = a.patterns;
  const html: string[] = [];

  const unfinishedCount = records.length - a.total.games;
  html.push(`<div class="card">
    <h2>Results for <b>${esc(username)}</b></h2>
    <p class="section-note">${newCount} newly analyzed game(s)${oldCount ? ` merged with ${oldCount} from the loaded report` : ''} · ${a.analyzedCount} of ${records.length} games have move-quality data${unfinishedCount ? ` · ${unfinishedCount} unfinished/undecided game(s) excluded from W-D-L and score` : ''}</p>
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${a.total.games}</span><span class="label">Games</span></div>
      <div class="stat-card"><span class="big">${a.total.wins}-${a.total.draws}-${a.total.losses}</span><span class="label">W-D-L</span></div>
      <div class="stat-card"><span class="big">${pct(scorePct(a.total))}</span><span class="label">Score</span></div>
      <div class="stat-card"><span class="big">${a.overallAccuracy !== null ? a.overallAccuracy + '%' : '—'}</span><span class="label">Accuracy</span></div>
      <div class="stat-card"><span class="big">${a.tactics.blundersTotal}</span><span class="label">Blunders</span></div>
    </div>
    <table><thead><tr><th></th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr></thead><tbody>
      ${wdlRow('As White', a.byColor.white)}
      ${wdlRow('As Black', a.byColor.black)}
    </tbody></table>
  </div>`);

  html.push(renderGamesSection(records, a.openings));

  const opponents = opponentList(records);
  if (opponents.length > 0) {
    const topOpponent = opponents[0].opponent;
    html.push(`<div class="card"><h2>🤝 Head-to-head</h2>
      <label class="stack">Opponent
        <select id="opponent-select">
          ${opponents.map((o) => `<option value="${esc(o.opponent)}">${esc(o.opponent)} (${o.games} game${o.games === 1 ? '' : 's'})</option>`).join('')}
        </select>
      </label>
      <div id="h2h-body">${h2hBodyHtml(headToHeadWithOpponent(records, topOpponent))}</div>
    </div>`);
  }

  const rc = a.repertoireCoverage;
  html.push(`<div class="card"><h2>♟ Opening performance</h2>
    ${
      rc.coveragePct !== null
        ? `<div class="summary-cards">
      <div class="stat-card"><span class="big">${rc.coveragePct}%</span><span class="label">Repertoire coverage</span></div>
      <div class="stat-card"><span class="big">${rc.preparedGames}</span><span class="label">Games in a known line (2+ played)</span></div>
      <div class="stat-card"><span class="big mid">${rc.improvisedGames}</span><span class="label">Games in a one-off line</span></div>
    </div>
    <p class="section-note">${rc.coveragePct}% of your games followed an opening you've played at least twice — a rough read on how much of your results come from actual prep vs. improvising over the board.</p>`
        : ''
    }
    <h3>Strongest openings</h3>${openingTableHtml(a.strongest, 'Need at least 2 games in an opening (with ≥50% score) to rank it.')}
    <h3>Weakest openings</h3>${openingTableHtml(a.weakest, 'No openings scoring below 50% with 2+ games — nice.')}
    <h3>All openings</h3>${openingTableHtml(a.openings, 'No games loaded.')}
  </div>`);

  html.push(`<div class="card"><h2>⏱ Results by time control</h2>
    <table><thead><tr><th>Time control</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th><th class="num">Accuracy</th></tr></thead><tbody>
    ${a.byTimeClass.map((tc) => wdlRow(esc(tc.timeClass), tc.wdl, `<td class="num">${tc.avgAccuracy !== null ? tc.avgAccuracy + '%' : '—'}</td>`)).join('')}
    </tbody></table>
  </div>`);

  if (a.openingsByTimeClass.length > 1) {
    html.push(`<div class="card"><h2>♟⏱ Openings by time control</h2>
      <p class="section-note">The same opening can score very differently depending on speed — a repertoire built for Rapid may fall apart in Bullet. Each table below only reflects games played at that time control.</p>
      ${a.openingsByTimeClass
        .map((tc) => `<h3>${esc(tc.timeClass)}</h3>${openingTableHtml(tc.openings, 'No games at this time control.')}`)
        .join('')}
    </div>`);
  }

  const egRows = Object.entries(p.endgameTypeCounts).sort((x, y) => y[1].games - x[1].games);
  html.push(`<div class="card"><h2>📊 Game-phase breakdown</h2>
    <table><thead><tr><th>Phase</th><th class="num">Accuracy</th><th class="num">Inaccuracies</th><th class="num">Mistakes</th><th class="num">Blunders</th><th class="num">Blunders/game</th><th class="num">Losses decided here</th></tr></thead><tbody>
    ${a.phases
      .map(
        (ph) =>
          `<tr><td>${ph.phase[0].toUpperCase() + ph.phase.slice(1)}</td><td class="num">${pct(ph.avgAccuracy)}</td><td class="num">${ph.inaccuracies}</td><td class="num">${ph.mistakes}</td><td class="num neg">${ph.blunders}</td><td class="num">${ph.blundersPerGame}</td><td class="num">${ph.decisiveErrorsInLosses}</td></tr>`
      )
      .join('')}
    </tbody></table>
    ${
      egRows.length
        ? `<h3>Endgame types reached</h3><table><thead><tr><th>Type</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr></thead><tbody>${egRows.map(([type, w]) => wdlRow(esc(type), w)).join('')}</tbody></table>`
        : ''
    }
    ${
      a.errorsByMove.length > 1
        ? `<h3>Errors by move number</h3>
    <p class="section-note">Where inaccuracies, mistakes and blunders actually land across the whole game, move by move — more granular than the opening/middlegame/endgame split above, since two games can reach the endgame at very different move numbers.</p>
    ${renderLineChartSvg(
      [
        { label: 'Inaccuracies', values: a.errorsByMove.map((e) => e.inaccuracies), color: 'var(--blue)' },
        { label: 'Mistakes', values: a.errorsByMove.map((e) => e.mistakes), color: 'var(--gold)' },
        { label: 'Blunders', values: a.errorsByMove.map((e) => e.blunders), color: 'var(--red)' },
      ],
      { xLabels: a.errorsByMove.map((e) => String(e.moveNo)) }
    )}`
        : ''
    }
  </div>`);

  html.push(`<div class="card"><h2>⚔ Tactics: strengths &amp; misses</h2>
    <div class="summary-cards">
      <div class="stat-card"><span class="big neg">${a.tactics.blundersTotal}</span><span class="label">Blunders</span></div>
      <div class="stat-card"><span class="big neg">${a.tactics.missedWins}</span><span class="label">Missed wins</span></div>
      <div class="stat-card"><span class="big neg">${a.tactics.missedMates}</span><span class="label">Missed mates</span></div>
      <div class="stat-card"><span class="big mid">${a.tactics.missedTactics}</span><span class="label">Missed tactics</span></div>
    </div>
    ${
      a.tactics.worstMoments.length
        ? `<h3>Biggest single-move swings</h3><table><thead><tr><th>Game</th><th class="num">Move</th><th>Played</th><th>Type</th><th>Win% swing</th><th>Engine best</th></tr></thead><tbody>${a.tactics.worstMoments
            .map(({ game, move }) => {
              const label = `${esc(game.white)} vs ${esc(game.black)} (${esc(game.date)})`;
              const link = game.site.startsWith('http') ? `<a href="${esc(game.site)}" target="_blank" rel="noopener">${label}</a>` : label;
              return `<tr><td>${link}</td><td class="num">${move.moveNo}</td><td>${esc(move.san)}</td><td>${move.kind}</td><td><span class="pos">${move.winPctBefore}%</span> → <span class="neg">${move.winPctAfter}%</span></td><td>${move.best ? esc(move.best) : '—'}</td></tr>`;
            })
            .join('')}</tbody></table>`
        : '<p class="section-note">No major swings detected (or engine analysis was skipped).</p>'
    }
    <h3>Errors: wins vs losses</h3>
    <table><thead><tr><th></th><th class="num">Games</th><th class="num">Inaccuracies</th><th class="num">Mistakes</th><th class="num">Blunders</th></tr></thead><tbody>
      <tr><td>In wins</td><td class="num">${p.analyzedWins}</td><td class="num">${p.errorsInWins.inaccuracies}</td><td class="num">${p.errorsInWins.mistakes}</td><td class="num">${p.errorsInWins.blunders}</td></tr>
      <tr><td>In losses</td><td class="num">${p.analyzedLosses}</td><td class="num">${p.errorsInLosses.inaccuracies}</td><td class="num">${p.errorsInLosses.mistakes}</td><td class="num">${p.errorsInLosses.blunders}</td></tr>
    </tbody></table>
  </div>`);

  const mistakesTotal = a.phases.reduce((s, ph) => s + ph.mistakes, 0);
  const errorDenom = a.tactics.blundersTotal + mistakesTotal;
  const timePct = errorDenom > 0 ? Math.round((p.timePressureBlunders / errorDenom) * 100) : null;
  html.push(`<div class="card"><h2>⏱ Time trouble</h2>
    ${
      p.clockGames > 0
        ? `<div class="summary-cards">
      <div class="stat-card"><span class="big">${p.clockGames}</span><span class="label">Games with clock data</span></div>
      <div class="stat-card"><span class="big neg">${p.timePressureBlunders}</span><span class="label">Errors under 30s left</span></div>
      <div class="stat-card"><span class="big">${timePct !== null ? timePct + '%' : '—'}</span><span class="label">Of all your errors</span></div>
    </div>
    <p class="section-note">${p.timePressureBlunders} blunder(s)/mistake(s) were played with under 30 seconds on the clock, across ${p.clockGames} game(s) with clock data${timePct !== null ? ` — ${timePct}% of all your inaccuracy-or-worse moves happened in time trouble` : ''}. ${p.timePressureBlunders >= 2 ? 'Worth training: banking more time earlier in the game, or practicing at a longer time control.' : 'Not a major factor yet in this sample.'}</p>`
        : `<p class="section-note">No clock data found in these games — they don't include <code>[%clk]</code> tags (common for correspondence/daily games or manually-typed PGNs).</p>`
    }
    ${
      a.timeUsage.length > 1
        ? `<h3>Time usage by move number</h3>
    <p class="section-note">Average seconds left on the clock after each move, across every game with clock data — shows whether time trouble tends to build up at a particular stage rather than being spread evenly.</p>
    ${renderLineChartSvg(
      [{ label: 'Avg. seconds remaining', values: a.timeUsage.map((t) => t.avgSec), color: 'var(--accent)' }],
      { xLabels: a.timeUsage.map((t) => String(t.moveNo)), ySuffix: 's' }
    )}`
        : ''
    }
  </div>`);

  html.push(`<div class="card"><h2>🔍 Patterns detected</h2>
    ${
      p.narrative.length
        ? `<ul class="pattern-list">${p.narrative.map((n) => `<li>${mdBold(esc(n))}</li>`).join('')}</ul>`
        : '<p class="section-note">Not enough analyzed games to detect reliable patterns yet — keep adding games over time.</p>'
    }
    ${
      p.lostFromWinning.length
        ? `<h3>Winning positions that were lost</h3><ul class="pattern-list">${p.lostFromWinning
            .map((g) => {
              const label = `${esc(g.white)} vs ${esc(g.black)}, ${esc(g.date)} — peaked at ${g.bestWinPct}% win chance${g.decisiveErrorPhase ? `, decisive error in the ${g.decisiveErrorPhase} (move ${g.decisiveErrorMove})` : ''}`;
              return `<li>${g.site.startsWith('http') ? `<a href="${esc(g.site)}" target="_blank" rel="noopener">${label}</a>` : label}</li>`;
            })
            .join('')}</ul>`
        : ''
    }
  </div>`);

  html.push(`<div class="card"><h2>🎯 Training recommendations</h2>
    ${
      a.recommendations.length
        ? a.recommendations
            .map(
              (r) => `<div class="rec-card sev-${r.severity}">
        <h4>${esc(r.area)}<span class="sev-tag">${r.severity} priority</span></h4>
        <p class="section-note">${esc(r.why)}</p>
        <div class="theme-links">${r.themes.map((t) => `<a href="${themeUrl(t.name)}" target="_blank" rel="noopener">🧩 ${esc(t.label)}</a>`).join('')}</div>
        <ul>${r.drills.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      </div>`
            )
            .join('')
        : '<p class="section-note">Run engine analysis to unlock personalized recommendations.</p>'
    }
    <p class="hint">Puzzle links open lichess.org training themes (free). The same themes exist in the chess.com puzzle trainer under Puzzles → Custom.</p>
  </div>`);

  resultsEl.innerHTML = html.join('');
  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mdBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// Delegated once on the (stable) results container, since its innerHTML is fully replaced on
// every re-render — a listener on the buttons themselves would be destroyed each time.
resultsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const pgnBtn = target.closest('.pgn-dl-btn') as HTMLButtonElement | null;
  if (pgnBtn) {
    const rec = records.find((g) => g.id === pgnBtn.dataset.id);
    if (!rec) return;
    const safeName = `${rec.white}_vs_${rec.black}`.replace(/[^\w.-]/g, '_').slice(0, 60);
    downloadPgn(`${rec.date}_${safeName}.pgn`, buildAnnotatedPgn(rec));
    return;
  }
  const assessBtn = target.closest('.assess-btn') as HTMLButtonElement | null;
  if (assessBtn) {
    const row = assessBtn.closest('tr')?.nextElementSibling as HTMLElement | null;
    if (row?.classList.contains('assess-row')) row.hidden = !row.hidden;
  }
});

resultsEl.addEventListener('change', (e) => {
  const select = e.target as HTMLElement;
  if (select.id !== 'opponent-select') return;
  const opponent = (select as HTMLSelectElement).value;
  const body = $('#h2h-body');
  if (body) body.innerHTML = h2hBodyHtml(headToHeadWithOpponent(records, opponent));
});

// ---------- export / persistence ----------
$('#download-md').addEventListener('click', () => {
  if (!currentMarkdown) return;
  const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const aEl = document.createElement('a');
  aEl.href = url;
  aEl.download = `chess-report-${detectedUsername || 'player'}-${new Date().toISOString().slice(0, 10)}.md`;
  aEl.click();
  URL.revokeObjectURL(url);
});

$('#save-server').addEventListener('click', async () => {
  if (!currentMarkdown) return;
  const name = `${detectedUsername || 'player'}`.replace(/[^\w.-]/g, '_');
  try {
    const resp = await fetch('/api/reports/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown' },
      body: currentMarkdown,
    });
    serverMsg.textContent = resp.ok
      ? `Saved on server as "${name}.md" (${new Date().toLocaleTimeString()}).`
      : `Server save failed: ${resp.status}`;
  } catch (e) {
    serverMsg.textContent = 'Server not reachable — use "Download report.md" instead.';
  }
});

$('#load-server').addEventListener('click', async () => {
  try {
    const resp = await fetch('/api/reports');
    const list = (await resp.json()) as { name: string; mtime: string }[];
    if (!list.length) {
      serverMsg.textContent = 'No reports saved on the server yet.';
      return;
    }
    const pick = prompt(
      'Saved reports:\n' + list.map((r, i) => `${i + 1}. ${r.name} (${r.mtime.slice(0, 10)})`).join('\n') + '\n\nEnter a number to load:',
      '1'
    );
    const idx = pick ? parseInt(pick, 10) - 1 : -1;
    if (idx < 0 || idx >= list.length) return;
    const md = await (await fetch('/api/reports/' + encodeURIComponent(list[idx].name))).text();
    const file = new File([md], list[idx].name + '.md');
    await handleFiles([file]);
    serverMsg.textContent = `Loaded "${list[idx].name}" — add PGN files (or just re-run) and Analyze to update it.`;
  } catch (e) {
    serverMsg.textContent = 'Server not reachable.';
  }
});
