import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, splitPgn, tryParseGame } from './pgn';
import { Engine } from './engine';
import { analyzeGame, positionsNeeded } from './analyze';
import { aggregate, scorePct, themeUrl } from './aggregate';
import type { Aggregates, OpeningRow, WDL } from './aggregate';
import { mergeGames, parseMarkdownReport, renderMarkdown } from './markdown';
import type { GameRecord, ReportData, ReportMeta } from './types';
import { renderSparklineSvg } from './sparkline';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

// ---------- state ----------
let parsedGames: ParsedGame[] = [];
let baseReport: ReportData | null = null;
let records: GameRecord[] = [];
let currentMarkdown = '';
let currentAgg: Aggregates | null = null;

// ---------- dom ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fileInput = $('#file-input') as HTMLInputElement;
const dropzone = $('#dropzone');
const fileSummary = $('#file-summary');
const configCard = $('#config-card');
const usernameSelect = $('#username-select') as HTMLSelectElement;
const depthSelect = $('#depth-select') as HTMLSelectElement;
const analyzeBtn = $('#analyze-btn') as HTMLButtonElement;
const progressWrap = $('#progress-wrap');
const progressFill = $('#progress-fill');
const progressText = $('#progress-text');
const resultsEl = $('#results');
const exportCard = $('#export-card');
const serverMsg = $('#server-msg');

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
    populateUsernames();
    configCard.hidden = false;
    configCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function populateUsernames() {
  const counts = new Map<string, number>();
  for (const g of parsedGames) {
    for (const key of ['White', 'Black']) {
      const name = g.headers[key];
      if (name && name !== '?') counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (baseReport) {
    counts.set(baseReport.meta.username, (counts.get(baseReport.meta.username) ?? 0) + 10000);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  usernameSelect.innerHTML = sorted
    .map(([name, n]) => `<option value="${esc(name)}">${esc(name)} (${n >= 10000 ? 'report owner' : n + ' games'})</option>`)
    .join('');
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
  const username = usernameSelect.value;
  if (!username) return;
  const depth = parseInt(depthSelect.value, 10);
  const useEngine = depth > 0;

  analyzeBtn.disabled = true;
  progressWrap.hidden = false;

  // Skip games already analyzed in the loaded report (same id, same player).
  const knownIds = new Set(
    (baseReport && baseReport.meta.username.toLowerCase() === username.toLowerCase()
      ? baseReport.games
      : []
    ).map((g) => g.id)
  );
  const toAnalyze = parsedGames.filter((g) => {
    const isPlayer =
      (g.headers['White'] ?? '').toLowerCase() === username.toLowerCase() ||
      (g.headers['Black'] ?? '').toLowerCase() === username.toLowerCase();
    return isPlayer && !knownIds.has(gameId(g));
  });

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
      progressText.textContent = `Analyzing game ${i + 1} of ${toAnalyze.length}… (${toAnalyze[i].headers['White']} vs ${toAnalyze[i].headers['Black']})`;
      const rec = await analyzeGame(toAnalyze[i], {
        username,
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

    const oldGames =
      baseReport && baseReport.meta.username.toLowerCase() === username.toLowerCase()
        ? baseReport.games
        : [];
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

function renderGamesSection(games: GameRecord[]): string {
  if (!games.length) return '';
  const rows = [...games]
    .sort((x, y) => y.date.localeCompare(x.date))
    .map((g) => {
      const resultCls = g.result === 'win' ? 'pos' : g.result === 'loss' ? 'neg' : 'mid';
      const resultLabel = g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : 'Draw';
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
      return `<tr>
        <td>${esc(g.date)}</td>
        <td>${colorGlyph} ${esc(opponent)}</td>
        <td><span class="${resultCls}">${resultLabel}</span></td>
        <td>${esc(g.family)}</td>
        <td class="num">${g.accuracy.overall != null ? g.accuracy.overall + '%' : '—'}</td>
        <td class="spark-cell">${spark}</td>
        <td class="num">${liveLink}</td>
      </tr>`;
    })
    .join('');
  return `<div class="card"><h2>📈 Games</h2>
    <div class="games-table-wrap"><table><thead><tr>
      <th>Date</th><th>Opponent</th><th>Result</th><th>Opening</th><th class="num">Accuracy</th><th>Eval graph</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">The eval graph tracks the position's evaluation (white's perspective) across the whole game. Click ▶ to open a game in Live &amp; Engine and step through it move by move.</p>
  </div>`;
}

function renderResults(a: Aggregates, username: string, newCount: number, oldCount: number) {
  const p = a.patterns;
  const html: string[] = [];

  html.push(`<div class="card">
    <h2>Results for <b>${esc(username)}</b></h2>
    <p class="section-note">${newCount} newly analyzed game(s)${oldCount ? ` merged with ${oldCount} from the loaded report` : ''} · ${a.analyzedCount} of ${a.total.games} games have move-quality data</p>
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

  html.push(renderGamesSection(records));

  html.push(`<div class="card"><h2>♟ Opening performance</h2>
    <h3>Strongest openings</h3>${openingTableHtml(a.strongest, 'Need at least 2 games in an opening (with ≥50% score) to rank it.')}
    <h3>Weakest openings</h3>${openingTableHtml(a.weakest, 'No openings scoring below 50% with 2+ games — nice.')}
    <h3>All openings</h3>${openingTableHtml(a.openings, 'No games loaded.')}
  </div>`);

  html.push(`<div class="card"><h2>⏱ Results by time control</h2>
    <table><thead><tr><th>Time control</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th><th class="num">Accuracy</th></tr></thead><tbody>
    ${a.byTimeClass.map((tc) => wdlRow(esc(tc.timeClass), tc.wdl, `<td class="num">${tc.avgAccuracy !== null ? tc.avgAccuracy + '%' : '—'}</td>`)).join('')}
    </tbody></table>
  </div>`);

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

// ---------- export / persistence ----------
$('#download-md').addEventListener('click', () => {
  if (!currentMarkdown) return;
  const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const aEl = document.createElement('a');
  aEl.href = url;
  aEl.download = `chess-report-${usernameSelect.value || 'player'}-${new Date().toISOString().slice(0, 10)}.md`;
  aEl.click();
  URL.revokeObjectURL(url);
});

$('#save-server').addEventListener('click', async () => {
  if (!currentMarkdown) return;
  const name = `${usernameSelect.value || 'player'}`.replace(/[^\w.-]/g, '_');
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
