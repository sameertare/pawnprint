import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, gameLink, splitPgn, tryParseGame } from './pgn';
import { groupPlayerNames, nameKey, inferOwnerColorFromTitle } from './playerMatch';
import type { Color, Result } from './types';
import { Board } from './board';
import { buildTree, childSummaries, nodeAtPath, scorePct } from './openingTree';
import type { TreeNode, ChildSummary, GameRef } from './openingTree';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

// ---------- state ----------
let parsedGames: ParsedGame[] = [];
let detectedUsername: string | null = null;
let detectedMatchKeys: Set<string> | null = null;
interface ExplorerGame { sans: string[]; color: Color; result: Result; opponent: string; link: string | null; date: string; }
let explorerGames: ExplorerGame[] = [];
let tree: TreeNode | null = null;
let path: string[] = []; // SAN path from root to the currently viewed node
let minGames = 2;
const MAX_GAMES_SHOWN = 50; // cap the "games reaching this position" list for very popular nodes

// ---------- dom ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fileInput = $('#file-input') as HTMLInputElement;
const dropzone = $('#dropzone');
const fileSummary = $('#file-summary');
const configCard = $('#config-card');
const detectedPlayerName = $('#detected-player-name');
const detectedPlayerCount = $('#detected-player-count');
const colorSelect = $('#color-select') as HTMLSelectElement;
const minGamesSelect = $('#mingames-select') as HTMLSelectElement;
const resultsEl = $('#results');
const breadcrumbEl = $('#breadcrumb');
const nodeStatsEl = $('#node-stats');
const yourMovesEl = $('#your-moves');
const gamesHereEl = $('#games-here');
const gamesHereCountEl = $('#games-here-count');
const lichessUsernameInput = $('#lichess-username') as HTMLInputElement;
const lichessMaxSelect = $('#lichess-max') as HTMLSelectElement;
const lichessFetchBtn = $('#lichess-fetch-btn') as HTMLButtonElement;
const lichessStatusEl = $('#lichess-status');
const chesscomUsernameInput = $('#chesscom-username') as HTMLInputElement;
const chesscomMonthsSelect = $('#chesscom-months') as HTMLSelectElement;
const chesscomFetchBtn = $('#chesscom-fetch-btn') as HTMLButtonElement;
const chesscomStatusEl = $('#chesscom-status');

const board = new Board($('#board'));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------- file loading (same pattern as Performance Analysis) ----------
async function handleFiles(files: FileList | File[], forceUsername?: string) {
  let newGames = 0;
  let failed = 0;
  const failureCounts = new Map<string, { count: number; sample: string }>();
  const recordFailure = (f: ParseFailure) => {
    const existing = failureCounts.get(f.reason);
    if (existing) existing.count++;
    else failureCounts.set(f.reason, { count: 1, sample: f.snippet });
  };

  for (const file of Array.from(files)) {
    const text = await file.text();
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
  const seen = new Set<string>();
  parsedGames = parsedGames.filter((g) => {
    const id = gameId(g);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const chips: string[] = [];
  if (parsedGames.length) chips.push(`<span class="chip">♟ ${parsedGames.length} game(s) loaded</span>`);
  if (failed) chips.push(`<span class="chip">⚠ ${failed} item(s) could not be parsed</span>`);
  let html = chips.join(' ');
  if (failureCounts.size) {
    const rows = [...failureCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([reason, { count, sample }]) => `<li><b>${count}×</b> ${esc(reason)} <span class="hint">— e.g. "${esc(sample)}"</span></li>`)
      .join('');
    html += `<details class="parse-errors"><summary>Why ${failed} item(s) failed to parse</summary><ul>${rows}</ul></details>`;
  }
  fileSummary.innerHTML = html;

  finalizeAfterLoad(forceUsername);
}

/** Sets the detected player (auto-detected, or forced to a known lichess username) and rebuilds
 *  everything downstream. Split out from handleFiles so the lichess-fetch flow — which already
 *  knows exactly whose account it fetched — can skip the frequency heuristic entirely. */
function finalizeAfterLoad(forceUsername?: string) {
  if (!parsedGames.length) return;
  const detected = forceUsername
    ? { name: forceUsername, matchKeys: new Set([nameKey(forceUsername)]) }
    : detectMainPlayer();
  detectedUsername = detected?.name ?? null;
  detectedMatchKeys = detected?.matchKeys ?? null;
  detectedPlayerName.textContent = detectedUsername ?? '—';

  explorerGames = detectedMatchKeys ? buildExplorerGames(detectedMatchKeys) : [];
  detectedPlayerCount.textContent = explorerGames.length
    ? ` — ${explorerGames.length} game${explorerGames.length === 1 ? '' : 's'} available`
    : '';

  configCard.hidden = false;
  configCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  rebuildAndRender();
}

/** Same heuristic as Performance Analysis: the player appearing in the most games, with name
 *  variants (casing, "Last, First" order, nicknames) folded together. */
function detectMainPlayer(): { name: string; count: number; matchKeys: Set<string> } | null {
  const counts = new Map<string, number>();
  for (const g of parsedGames) {
    for (const key of ['White', 'Black'] as const) {
      const name = g.headers[key];
      if (!name || name === '?') continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (!counts.size) return null;
  const groups = groupPlayerNames(counts);
  groups.sort((a, b) => b.count - a.count);
  const best = groups[0];
  return { name: best.display, count: best.count, matchKeys: best.keys };
}

/** Same color/result derivation as analyzeGame() in analyze.ts, minus the engine-analysis parts
 *  this tool doesn't need, plus opponent name/link/date for the per-position games list. */
function buildExplorerGames(matchKeys: Set<string>): ExplorerGame[] {
  const out: ExplorerGame[] = [];
  for (const g of parsedGames) {
    const h = g.headers;
    const hasWhiteName = !!h['White'] && h['White'] !== '?';
    const hasBlackName = !!h['Black'] && h['Black'] !== '?';
    const userIsWhite =
      hasWhiteName || hasBlackName
        ? matchKeys.has(nameKey(h['White'] ?? ''))
        : inferOwnerColorFromTitle(h['ChapterName'] || h['Event']) !== 'b';
    // Skip games that don't actually involve the detected player at all.
    if (hasWhiteName || hasBlackName) {
      const involved = matchKeys.has(nameKey(h['White'] ?? '')) || matchKeys.has(nameKey(h['Black'] ?? ''));
      if (!involved) continue;
    }
    const color: Color = userIsWhite ? 'w' : 'b';
    const resultRaw = h['Result'] ?? '*';
    let result: Result;
    if (resultRaw === '1-0') result = userIsWhite ? 'win' : 'loss';
    else if (resultRaw === '0-1') result = userIsWhite ? 'loss' : 'win';
    else if (resultRaw === '1/2-1/2') result = 'draw';
    else result = 'unknown';
    const opponent = (userIsWhite ? h['Black'] : h['White']) || 'Unknown';
    out.push({
      sans: g.moves.map((m) => m.san),
      color,
      result,
      opponent,
      link: gameLink(h),
      date: h['Date'] ?? h['UTCDate'] ?? '',
    });
  }
  return out;
}

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void handleFiles(fileInput.files);
  fileInput.value = '';
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
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

// ---------- lichess username bulk fetch ----------
lichessFetchBtn.addEventListener('click', () => void fetchFromLichess());
lichessUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromLichess();
});

async function fetchFromLichess() {
  const username = lichessUsernameInput.value.trim();
  if (!username) {
    lichessStatusEl.textContent = 'Enter a lichess username first.';
    return;
  }
  const max = lichessMaxSelect.value;
  lichessFetchBtn.disabled = true;
  lichessStatusEl.textContent = `Fetching up to ${max} games for ${username} from lichess… this can take a moment for larger counts.`;
  try {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&pgnInJson=false&clocks=false&evals=false&opening=false`;
    const resp = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' } });
    if (resp.status === 404) throw new Error(`No lichess account named "${username}" found.`);
    if (resp.status === 429) throw new Error('Lichess is rate-limiting this request — wait a minute and try again.');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (!text.trim()) {
      lichessStatusEl.textContent = `${username} has no games matching this request.`;
      return;
    }
    const file = new File([text], `${username}-lichess.pgn`);
    await handleFiles([file], username);
    lichessStatusEl.textContent = `Loaded games for ${username} from lichess.`;
  } catch (e) {
    lichessStatusEl.textContent = `Could not fetch from lichess: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    lichessFetchBtn.disabled = false;
  }
}

// ---------- chess.com username bulk fetch ----------
// Chess.com's public "Published Data API" has no single all-games endpoint like lichess — games
// are grouped into monthly archives, so this fetches the archive list, then the N most recent
// months in parallel, and concatenates each game's own `pgn` field (already a complete PGN chunk,
// Link header included) into one blob for the existing splitPgn/tryParseGame pipeline.
interface ChessComArchivesResponse { archives: string[]; }
interface ChessComGamesResponse { games: { pgn?: string }[]; }

chesscomFetchBtn.addEventListener('click', () => void fetchFromChessCom());
chesscomUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromChessCom();
});

async function fetchFromChessCom() {
  const username = chesscomUsernameInput.value.trim();
  if (!username) {
    chesscomStatusEl.textContent = 'Enter a chess.com username first.';
    return;
  }
  const monthsBack = parseInt(chesscomMonthsSelect.value, 10);
  chesscomFetchBtn.disabled = true;
  chesscomStatusEl.textContent = `Fetching up to ${monthsBack} month(s) of games for ${username} from chess.com…`;
  try {
    const archivesResp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`);
    if (archivesResp.status === 404) throw new Error(`No chess.com account named "${username}" found.`);
    if (!archivesResp.ok) throw new Error(`HTTP ${archivesResp.status}`);
    const archivesData: ChessComArchivesResponse = await archivesResp.json();
    const archives = archivesData.archives ?? [];
    if (!archives.length) {
      chesscomStatusEl.textContent = `${username} has no game archives on chess.com.`;
      return;
    }
    const selected = archives.slice(-monthsBack); // archives are oldest-first; take the most recent N
    const monthResults = await Promise.all(
      selected.map(async (url) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return [];
          const data: ChessComGamesResponse = await r.json();
          return (data.games ?? []).map((g) => g.pgn).filter((p): p is string => !!p);
        } catch {
          return []; // one bad month shouldn't sink the whole fetch
        }
      })
    );
    const allPgns = monthResults.flat();
    if (!allPgns.length) {
      chesscomStatusEl.textContent = `No games found for ${username} in the selected range.`;
      return;
    }
    const text = allPgns.join('\n\n');
    const file = new File([text], `${username}-chesscom.pgn`);
    await handleFiles([file], username);
    chesscomStatusEl.textContent = `Loaded ${allPgns.length} game(s) for ${username} from chess.com.`;
  } catch (e) {
    chesscomStatusEl.textContent = `Could not fetch from chess.com: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    chesscomFetchBtn.disabled = false;
  }
}

// ---------- tree building & navigation ----------
colorSelect.addEventListener('change', () => {
  path = [];
  rebuildAndRender();
});
minGamesSelect.addEventListener('change', () => {
  minGames = parseInt(minGamesSelect.value, 10);
  render();
});

function rebuildAndRender() {
  const color = colorSelect.value as Color;
  const games = explorerGames.filter((g) => g.color === color);
  tree = buildTree(games);
  path = [];
  board.setOrientation(color);
  resultsEl.hidden = false;
  render();
}

$('#root-btn').addEventListener('click', () => { path = []; render(); });
$('#up-btn').addEventListener('click', () => { path = path.slice(0, -1); render(); });
$('#flip-btn').addEventListener('click', () => board.flip());

function currentNode(): TreeNode | null {
  if (!tree) return null;
  return nodeAtPath(tree, path) ?? tree;
}

function render() {
  const node = currentNode();
  if (!node) return;
  board.setFen(node.fen);

  // Breadcrumb
  const crumbs = ['<button class="crumb" data-idx="0">Start</button>'];
  path.forEach((san, i) => {
    crumbs.push(`<span class="crumb-sep">›</span><button class="crumb" data-idx="${i + 1}">${esc(san)}</button>`);
  });
  breadcrumbEl.innerHTML = crumbs.join('');
  breadcrumbEl.querySelectorAll<HTMLButtonElement>('.crumb').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx!, 10);
      path = path.slice(0, idx);
      render();
    });
  });

  // Node stats
  const sc = scorePct(node);
  nodeStatsEl.innerHTML = `
    <div class="stat-card"><span class="big">${node.games}</span><span class="label">Games</span></div>
    <div class="stat-card"><span class="big">${sc}%</span><span class="label">Score</span></div>
    <div class="stat-card"><span class="big pos">${node.wins}</span><span class="label">Wins</span></div>
    <div class="stat-card"><span class="big mid">${node.draws}</span><span class="label">Draws</span></div>
    <div class="stat-card"><span class="big neg">${node.losses}</span><span class="label">Losses</span></div>
  `;

  // Your moves from here
  const children = childSummaries(node).filter((c) => c.games >= minGames);
  yourMovesEl.innerHTML = children.length
    ? movesTableHtml(children)
    : `<p class="hint">No branch here reaches at least ${minGames} game(s). ${node.games ? 'Lower the game threshold above to see more.' : 'No games reached this position.'}</p>`;
  yourMovesEl.querySelectorAll<HTMLElement>('.move-row').forEach((row) => {
    row.addEventListener('click', () => {
      path = [...path, row.dataset.san!];
      render();
    });
  });

  renderGamesHere(node);
}

function movesTableHtml(children: ChildSummary[]): string {
  const maxGames = Math.max(...children.map((c) => c.games));
  const rows = children
    .map((c) => {
      const winW = (c.wins / c.games) * 100;
      const drawW = (c.draws / c.games) * 100;
      const lossW = (c.losses / c.games) * 100;
      const barWidth = 40 + (c.games / maxGames) * 60; // relative frequency, floor so thin bars stay visible
      return `<tr class="move-row" data-san="${esc(c.san)}">
        <td><b>${esc(c.san)}</b></td>
        <td class="num">${c.games}</td>
        <td class="num">${c.scorePct}%</td>
        <td>
          <div class="score-bar" style="width:${barWidth}%">
            <div class="seg win" style="width:${winW}%"></div>
            <div class="seg draw" style="width:${drawW}%"></div>
            <div class="seg loss" style="width:${lossW}%"></div>
          </div>
        </td>
      </tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Move</th><th class="num">Games</th><th class="num">Score</th><th>W/D/L</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Formats a SAN list as a readable move-number-prefixed string, e.g. "1. e4 e5 2. Nf3 Nc6". */
function formatMoves(sans: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(sans[i]);
  }
  return parts.join(' ');
}

/** Lists the individual games that reached the current node — opponent, result, date, a link to
 *  the game if the PGN had one, and the full move list on demand. Matches openingtree.com's
 *  per-position games list. */
function renderGamesHere(node: TreeNode) {
  const refs = node.gameRefs;
  gamesHereCountEl.textContent = refs.length ? `(${refs.length})` : '';
  if (!refs.length) {
    gamesHereEl.innerHTML = `<p class="hint">No games reached this position.</p>`;
    return;
  }
  const shown = refs.slice(0, MAX_GAMES_SHOWN);
  const resultLabel = (r: Result) => (r === 'win' ? 'Win' : r === 'loss' ? 'Loss' : r === 'draw' ? 'Draw' : '—');
  const resultClass = (r: Result) => (r === 'win' ? 'pos' : r === 'loss' ? 'neg' : r === 'draw' ? 'mid' : '');
  const rows = shown
    .map((g, i) => `
      <tr>
        <td>${esc(g.opponent)}</td>
        <td class="${resultClass(g.result)}">${resultLabel(g.result)}</td>
        <td class="hint">${esc(g.date || '—')}</td>
        <td>${g.link ? `<a href="${esc(g.link)}" target="_blank" rel="noopener">View ↗</a>` : '<span class="hint">—</span>'}</td>
        <td><button class="btn-icon moves-toggle" data-idx="${i}" title="Show moves">☰</button></td>
      </tr>
      <tr class="moves-row" id="moves-row-${i}" hidden>
        <td colspan="5"><div class="game-moves"><p>${esc(formatMoves(g.sans))}</p></div></td>
      </tr>`)
    .join('');
  const more = refs.length > MAX_GAMES_SHOWN
    ? `<p class="hint" style="margin-top:8px;">+ ${refs.length - MAX_GAMES_SHOWN} more game(s) not shown.</p>`
    : '';
  gamesHereEl.innerHTML =
    `<table><thead><tr><th>Opponent</th><th>Result</th><th>Date</th><th>Link</th><th></th></tr></thead><tbody>${rows}</tbody></table>${more}`;
  gamesHereEl.querySelectorAll<HTMLButtonElement>('.moves-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(`moves-row-${btn.dataset.idx}`) as HTMLElement;
      row.hidden = !row.hidden;
    });
  });
}
