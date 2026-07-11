import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, splitPgn, tryParseGame } from './pgn';
import { groupPlayerNames, nameKey, inferOwnerColorFromTitle } from './playerMatch';
import type { Color, Result } from './types';
import { Board } from './board';
import { buildTree, childSummaries, nodeAtPath, scorePct } from './openingTree';
import type { TreeNode, ChildSummary } from './openingTree';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

// ---------- state ----------
let parsedGames: ParsedGame[] = [];
let detectedUsername: string | null = null;
let detectedMatchKeys: Set<string> | null = null;
interface ExplorerGame { sans: string[]; color: Color; result: Result; }
let explorerGames: ExplorerGame[] = [];
let tree: TreeNode | null = null;
let path: string[] = []; // SAN path from root to the currently viewed node
let minGames = 2;
let masterFetchToken = 0; // guards against a slow fetch resolving after the user navigated away

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
const masterMovesEl = $('#master-moves');

const board = new Board($('#board'));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------- file loading (same pattern as Performance Analysis) ----------
async function handleFiles(files: FileList | File[]) {
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

  if (parsedGames.length) {
    const detected = detectMainPlayer();
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
 *  this tool doesn't need. */
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
    out.push({ sans: g.moves.map((m) => m.san), color, result });
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
    ? movesTableHtml(children, true)
    : `<p class="hint">No branch here reaches at least ${minGames} game(s). ${node.games ? 'Lower the game threshold above to see more.' : 'No games reached this position.'}</p>`;
  yourMovesEl.querySelectorAll<HTMLElement>('.move-row').forEach((row) => {
    row.addEventListener('click', () => {
      path = [...path, row.dataset.san!];
      render();
    });
  });

  void renderMasterMoves(node.fen);
}

function movesTableHtml(children: ChildSummary[], clickable: boolean): string {
  const maxGames = Math.max(...children.map((c) => c.games));
  const rows = children
    .map((c) => {
      const winW = (c.wins / c.games) * 100;
      const drawW = (c.draws / c.games) * 100;
      const lossW = (c.losses / c.games) * 100;
      const barWidth = 40 + (c.games / maxGames) * 60; // relative frequency, floor so thin bars stay visible
      return `<tr class="${clickable ? 'move-row' : ''}" ${clickable ? `data-san="${esc(c.san)}"` : ''}>
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

// ---------- master-game comparison (Lichess masters database, public API) ----------
async function renderMasterMoves(fen: string) {
  const token = ++masterFetchToken;
  masterMovesEl.innerHTML = `<p class="hint">Loading master games…</p>`;
  try {
    const resp = await fetch(`https://explorer.lichess.org/masters?fen=${encodeURIComponent(fen)}&moves=10&topGames=0`);
    if (token !== masterFetchToken) return; // user navigated to a different node while this was in flight
    if (resp.status === 401 || resp.status === 429) {
      masterMovesEl.innerHTML = `<p class="hint">Lichess's masters database isn't accepting requests right now (HTTP ${resp.status}) — this is on their end, not yours. Your own move stats above are unaffected; try again later.</p>`;
      return;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const moves: { san: string; white: number; draws: number; black: number }[] = data.moves ?? [];
    if (!moves.length) {
      masterMovesEl.innerHTML = `<p class="hint">No master games reach this exact position.</p>`;
      return;
    }
    const children: ChildSummary[] = moves.map((m) => {
      const games = m.white + m.draws + m.black;
      return {
        san: m.san,
        fen: '',
        games,
        wins: m.white,
        draws: m.draws,
        losses: m.black,
        scorePct: games ? Math.round(((m.white + m.draws * 0.5) / games) * 1000) / 10 : 0,
      };
    });
    masterMovesEl.innerHTML = movesTableHtml(children, false) +
      `<p class="hint" style="margin-top:8px;">Score % here is White's score (win + ½ draw), for comparison — not from your color's perspective.</p>`;
  } catch (e) {
    if (token !== masterFetchToken) return;
    masterMovesEl.innerHTML = `<p class="hint">Could not reach the Lichess masters database (${esc(e instanceof Error ? e.message : String(e))}). Your own move stats above are unaffected.</p>`;
  }
}
