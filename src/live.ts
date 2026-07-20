import './style.css';
import { Chess } from 'chess.js';
import { Board } from './board';
import { Engine, ENGINE_NAME } from './engine';
import type { EngineEval } from './engine';
import { winPct } from './analyze';
import { identifyOpening } from './openings';
import { splitPgn } from './pgn';
import { mountInteractiveSparkline } from './sparkline';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { buildPgnFromLine, downloadPgn } from './pgnExport';
import { debounce } from './debounce';
import { queryTablebase, tablebaseEligible, tbCategoryLabel, tbCategoryClass } from './tablebase';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---------- shared engine (lazy) ----------
let engine: Engine | null = null;
let enginePromise: Promise<Engine> | null = null;
async function getEngine(): Promise<Engine> {
  if (engine) return engine;
  if (!enginePromise) {
    enginePromise = (async () => {
      const e = new Engine();
      await e.init();
      engine = e;
      return e;
    })();
  }
  return enginePromise;
}

const board = new Board($('#board'));
const evalNum = $('#evalnum');
const evalFill = $('#evalfill');
const turnInd = $('#turn-indicator');
$('#engine-name').textContent = ENGINE_NAME;

// ---------- helpers ----------
function whiteCp(fen: string, cpSideToMove: number): number {
  return fen.split(' ')[1] === 'w' ? cpSideToMove : -cpSideToMove;
}
function fmtEval(whiteCpVal: number, mate: number | null, stmWhite: boolean): string {
  if (mate !== null) {
    const m = stmWhite ? mate : -mate; // mate is side-to-move perspective → white perspective
    return `#${m}`;
  }
  const pawns = whiteCpVal / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
}
function setEvalBar(whiteCpVal: number) {
  evalFill.style.height = `${winPct(whiteCpVal)}%`;
  const pawns = Math.max(-9.9, Math.min(9.9, whiteCpVal / 100));
  evalNum.textContent = (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}
function uciToSan(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
    return mv ? mv.san : null;
  } catch { return null; }
}
function pvToSans(fen: string, pv: string[], max = 6): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try {
      const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u.slice(4) : undefined });
      if (!mv) break;
      out.push(mv.san);
    } catch { break; }
  }
  return out;
}
/** Opening name from the moves played so far (book lookup only — no PGN headers available here). */
function openingNameFor(sansSoFar: string[]): string | null {
  if (sansSoFar.length === 0) return null;
  const { opening } = identifyOpening({}, sansSoFar);
  return opening === 'Unknown Opening' ? null : opening;
}
function classify(drop: number): { label: string; cls: string } {
  if (drop >= 30) return { label: 'Blunder ??', cls: 'neg' };
  if (drop >= 20) return { label: 'Mistake ?', cls: 'neg' };
  if (drop >= 10) return { label: 'Inaccuracy ?!', cls: 'mid' };
  if (drop <= 2) return { label: 'Best', cls: 'pos' };
  return { label: 'OK', cls: '' };
}

// ======================================================================
// Shared game navigator — a line of positions both tabs step through
// ======================================================================
interface Node { fen: string; lm: string | null; san: string | null; }

let line: Node[] = [{ fen: START, lm: null, san: null }];
let evalsW: (number | null)[] = [null]; // white-perspective centipawns
let bestU: (string | null)[] = [null];  // engine best move (UCI) at each position
let mateN: (number | null)[] = [null];  // mate distance (side-to-move perspective)
let view = 0;
let mode: 'position' | 'live' | 'play' = 'position';
let liveFollow = true;
let pumping = false;
let playUserColor: 'w' | 'b' = 'w';
let playEngineThinking = false;
let playActive = false; // true only once a Play-vs-Engine game has been started/loaded
// Tracked purely for the "Export PGN" button's header block — best-effort, not authoritative.
let curWhite: string | undefined;
let curBlack: string | undefined;
let curEvent: string | undefined;
let curResult: string | undefined;

function curDepth(): number {
  let sel = '#depth-position';
  if (mode === 'live') sel = '#depth-live';
  else if (mode === 'play') sel = '#depth-play';
  return parseInt(($(sel) as HTMLSelectElement).value, 10) || 14;
}

function resetLine(fen: string) {
  line = [{ fen, lm: null, san: null }];
  evalsW = [null]; bestU = [null]; mateN = [null];
  view = 0;
  curWhite = curBlack = curEvent = curResult = undefined;
}
function appendNode(fen: string, lm: string | null) {
  const prev = line[line.length - 1].fen;
  line.push({ fen, lm, san: lm ? uciToSan(prev, lm) : null });
  evalsW.push(null); bestU.push(null); mateN.push(null);
}
function truncateAfter(i: number) {
  line.length = i + 1; evalsW.length = i + 1; bestU.length = i + 1; mateN.length = i + 1;
}

interface BuiltLine { line: Node[]; white?: string; black?: string; wr?: string; br?: string; event?: string; result?: string; }

/** Build a full line from a PGN string. Returns null if it can't be parsed. */
function buildLineFromPgn(pgn: string): BuiltLine | null {
  const c = new Chess();
  try { c.loadPgn(pgn); } catch { return null; }
  const verbose = c.history({ verbose: true }) as any[];
  const h = c.header() as Record<string, string | null | undefined>;
  // chess.js defaults missing Seven Tag Roster headers to the literal string "?" — treat that
  // the same as absent (studies in particular have no White/Black headers at all).
  const s = (v: string | null | undefined) => (v && v !== '?' ? v : undefined);
  const meta = { wr: s(h.WhiteElo), br: s(h.BlackElo), event: s(h.Event), result: h.Result || undefined };
  if (!verbose.length) {
    // PGN with only a FEN header and no moves — navigate the single position.
    return { line: [{ fen: c.fen(), lm: null, san: null }], white: s(h.White), black: s(h.Black), ...meta };
  }
  const nodes: Node[] = [{ fen: verbose[0].before, lm: null, san: null }];
  for (const mv of verbose) {
    nodes.push({ fen: mv.after, lm: mv.from + mv.to + (mv.promotion || ''), san: mv.san });
  }
  return { line: nodes, white: s(h.White), black: s(h.Black), ...meta };
}

/** Per-move assessment (needs evals for k-1 and k). */
function moveAssessment(k: number) {
  if (k < 1 || k >= line.length) return null;
  const before = evalsW[k - 1], after = evalsW[k];
  if (before == null || after == null) return null;
  const prevFen = line[k - 1].fen;
  const moverWhite = prevFen.split(' ')[1] === 'w';
  const winBefore = moverWhite ? winPct(before) : 100 - winPct(before);
  const winAfter = moverWhite ? winPct(after) : 100 - winPct(after);
  const drop = winBefore - winAfter;
  const { label, cls } = classify(drop);
  const bestUci = bestU[k - 1];
  const bestSan = bestUci ? uciToSan(prevFen, bestUci) : null;
  return {
    label, cls, drop, winBefore, winAfter, bestSan,
    san: line[k].san, moveNo: parseInt(prevFen.split(' ')[5], 10), moverWhite,
  };
}
function moveColorClass(k: number): string {
  const a = moveAssessment(k);
  if (!a) return '';
  if (a.drop >= 30) return 'm-blunder';
  if (a.drop >= 20) return 'm-mistake';
  if (a.drop >= 10) return 'm-inacc';
  if (a.drop <= 2) return 'm-best';
  return '';
}

// ---------- rendering ----------
function render() {
  const node = line[view];
  const fen = node.fen;
  board.setFen(fen);
  board.setSelected(null);
  board.setLastMove(node.lm && node.lm.length >= 4 ? [node.lm.slice(0, 2), node.lm.slice(2, 4)] : null);

  const c = new Chess(fen);
  const stm = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  turnInd.textContent = c.isCheckmate() ? 'Checkmate'
    : c.isStalemate() ? 'Stalemate'
    : c.isDraw() ? 'Draw'
    : `${stm} to move${c.inCheck() ? ' — check' : ''}`;

  if (evalsW[view] != null) setEvalBar(evalsW[view]!);
  else evalNum.textContent = '…';

  const sansSoFar = line.slice(1, view + 1).map((n) => n.san ?? '').filter(Boolean);
  $('#opening-name').textContent = openingNameFor(sansSoFar) ?? '';

  renderAssess(c, fen);
  renderMoveList();
  updateNav();
  renderEvalGraph();
  updatePgnOutput();
  void debouncedUpdateTablebase();

  // Update play mode status. Compare side-to-move against the user's colour using the raw FEN
  // field ('w'/'b') — the `stm` above is the display string ("White"/"Black") and comparing that
  // to 'w'/'b' never matched, which pinned the status to "Engine thinking…" on every render.
  const engineTurnInPlay =
    mode === 'play' && playActive && !c.isGameOver() && fen.split(' ')[1] !== playUserColor;
  if (mode === 'play' && playActive) {
    const status = $('#play-status');
    if (c.isGameOver()) {
      status.textContent = c.isCheckmate() ? 'Checkmate!' : c.isStalemate() ? 'Stalemate!' : c.isDraw() ? 'Draw!' : 'Game over!';
    } else {
      status.textContent = engineTurnInPlay ? 'Engine thinking…' : 'Your turn';
    }
  }

  // Skip the candidate-move search on the engine's turn (it's a full-depth MultiPV search on the
  // same position that would queue ahead of the engine's own move and delay it by seconds), and
  // before a Play-mode game has actually started (otherwise the board shows stale hint arrows
  // left over from whatever position was last viewed in Any Position mode).
  const suppressCandidates = engineTurnInPlay || (mode === 'play' && !playActive);
  if (suppressCandidates) { $('#candidates').innerHTML = ''; board.setArrows([]); }
  else void debouncedUpdateCandidates();
}

function renderEvalGraph() {
  const el = $('#eval-graph');
  // In Play mode the full-history eval graph is intentionally not computed (see nextEvalIndex),
  // so hide it rather than show a mostly-empty sparkline.
  if (line.length < 2 || mode === 'play') { el.hidden = true; return; }
  el.hidden = false;
  mountInteractiveSparkline(el, evalsW, view, (i) => goto(i));
}

function updatePgnOutput() {
  const el = $('#live-pgn-moves');
  const label = $('#live-pgn-label');
  // The Live and Play-vs-Engine tabs show the vertical move grid; hide it everywhere else.
  if ((mode !== 'live' && mode !== 'play') || line.length < 2) {
    el.hidden = true;
    label.hidden = true;
    el.innerHTML = '';
    return;
  }
  label.hidden = false;
  el.hidden = false;
  // Lichess-style vertical move list: one row per full move — number, White's move, Black's move.
  // Each ply is placed in the White or Black column by its actual side-to-move (read from the
  // position it was played from), so a line that begins mid-game — Black to move, or a live-game
  // backfill — still aligns correctly instead of shifting every move into the wrong column.
  const cell = (k: number) => {
    const san = line[k]?.san ?? '?';
    return `<span class="lpm-move ${moveColorClass(k)} ${k === view ? 'cur' : ''}" data-ply="${k}">${san}</span>`;
  };
  const emptyCell = '<span class="lpm-move lpm-empty"></span>';
  const gapCell = '<span class="lpm-move lpm-empty">…</span>';
  const rowsMap = new Map<number, { white: string; black: string }>();
  const order: number[] = [];
  for (let k = 1; k < line.length; k++) {
    const parts = line[k - 1].fen.split(' ');
    const isWhiteMove = parts[1] === 'w';
    const moveNo = parseInt(parts[5], 10);
    if (!rowsMap.has(moveNo)) { rowsMap.set(moveNo, { white: gapCell, black: emptyCell }); order.push(moveNo); }
    const row = rowsMap.get(moveNo)!;
    if (isWhiteMove) row.white = cell(k); else row.black = cell(k);
  }
  el.innerHTML = order.map((no) => {
    const r = rowsMap.get(no)!;
    return `<span class="lpm-num">${no}.</span>${r.white}${r.black}`;
  }).join('');
  el.querySelectorAll<HTMLElement>('.lpm-move[data-ply]').forEach((m) =>
    m.addEventListener('click', () => goto(parseInt(m.dataset.ply!, 10)))
  );
  // Scroll the current move into view WITHIN the grid only — never scrollIntoView, which would
  // also scroll the whole page (that's the flicker/jump when new live moves arrive).
  const cur = el.querySelector<HTMLElement>('.cur');
  if (cur) {
    const target = cur.offsetTop - el.clientHeight / 2 + cur.offsetHeight / 2;
    el.scrollTop = Math.max(0, target);
  }
}

function renderAssess(c: Chess, fen: string) {
  const parts: string[] = [];
  // 1) the move that led to the current position (previous-move feedback)
  if (view > 0) {
    const a = moveAssessment(view);
    if (a) {
      const showBest = a.drop >= 10 && a.bestSan && a.bestSan !== a.san;
      parts.push(
        `<div class="assess-move"><span class="feed-move">${a.moveNo}${a.moverWhite ? '.' : '…'} ${a.san}</span>` +
        ` <span class="feed-label ${a.cls}">${a.label}</span>` +
        ` <span class="hint">${Math.round(a.winBefore)}% → ${Math.round(a.winAfter)}%</span>` +
        (showBest ? ` <span class="hint">· best: ${a.bestSan}</span>` : '') + `</div>`
      );
    } else {
      parts.push(`<div class="assess-move"><span class="feed-move">${line[view].san ?? ''}</span> <span class="hint">analysing…</span></div>`);
    }
  } else {
    parts.push(`<div class="assess-move hint">Starting position</div>`);
  }
  // 2) the engine's take on the current position (current-move suggestion)
  if (c.isGameOver()) {
    board.setArrow(null);
    parts.push(`<div class="assess-eng hint">${c.isCheckmate() ? 'Checkmate — game over' : 'Game over'}</div>`);
  } else {
    const b = bestU[view];
    if (b && evalsW[view] != null) {
      board.setArrow([b.slice(0, 2), b.slice(2, 4)]);
      const stmWhite = fen.split(' ')[1] === 'w';
      const stm = stmWhite ? 'White' : 'Black';
      parts.push(
        `<div class="assess-eng">${stm} to move · engine: <b>${uciToSan(fen, b) ?? b}</b> ` +
        `<span class="eval-chip">${fmtEval(evalsW[view]!, mateN[view], stmWhite)}</span></div>`
      );
    } else {
      board.setArrow(null);
      parts.push(`<div class="assess-eng hint">Analysing…</div>`);
    }
  }
  $('#move-assess').innerHTML = parts.join('');
}

function renderMoveList() {
  const ml = $('#move-list');
  // Live and Play-vs-Engine modes use the vertical lichess-style move grid instead of this
  // horizontal list, so keep the horizontal one out of the way there.
  if (mode === 'live' || mode === 'play') { ml.hidden = true; ml.innerHTML = ''; return; }
  const n = line.length;
  if (n <= 1) { ml.hidden = true; ml.innerHTML = ''; return; }
  ml.hidden = false;
  let html = '';
  for (let k = 1; k < n; k++) {
    const prevFen = line[k - 1].fen;
    const color = prevFen.split(' ')[1];
    const moveNo = parseInt(prevFen.split(' ')[5], 10);
    if (color === 'w') html += `<span class="ml-num">${moveNo}.</span>`;
    else if (k === 1) html += `<span class="ml-num">${moveNo}…</span>`;
    html += `<span class="ml-move ${moveColorClass(k)} ${k === view ? 'cur' : ''}" data-ply="${k}">${line[k].san ?? '?'}</span>`;
  }
  ml.innerHTML = html;
  ml.querySelectorAll<HTMLElement>('.ml-move').forEach((el) =>
    el.addEventListener('click', () => goto(parseInt(el.dataset.ply!, 10)))
  );
  ml.querySelector('.cur')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateNav() {
  const n = line.length;
  ($('#nav-row') as HTMLElement).hidden = !(n > 1 || mode === 'live');
  ($('#nav-first') as HTMLButtonElement).disabled = view <= 0;
  ($('#nav-back') as HTMLButtonElement).disabled = view <= 0;
  ($('#nav-fwd') as HTMLButtonElement).disabled = view >= n - 1;
  ($('#nav-last') as HTMLButtonElement).disabled = view >= n - 1;
  $('#ply-counter').textContent = n > 1 ? `Move ${view} / ${n - 1}` : '';
  const lj = $('#live-jump') as HTMLElement;
  lj.hidden = mode !== 'live' || connKind !== 'game';
  if (mode === 'live' && connKind === 'game') {
    if (liveFollow) { lj.textContent = '● LIVE'; lj.classList.add('following'); }
    else { lj.textContent = `⏭ Live (${n - 1 - view} behind)`; lj.classList.remove('following'); }
  }
}

// ---------- navigation ----------
function goto(i: number) {
  view = Math.max(0, Math.min(line.length - 1, i));
  if (mode === 'live') liveFollow = view === line.length - 1;
  render();
  void pump();
}

// ---------- background engine evaluation (prioritises the viewed position) ----------
function nextEvalIndex(): number {
  // In Play-vs-Engine mode only the position on the board matters — evaluating the whole loaded
  // history (100+ positions at full depth) would tie up the single engine worker and starve the
  // engine's own move, leaving it stuck "thinking" while the user can't move. So only ever
  // evaluate the current position here.
  if (mode === 'play') {
    if (evalsW[view] !== null) return -1;
    // On the engine's own turn, don't run a background eval — playEngineMove does the search, and
    // a competing one would just delay the engine's move (leaving it stuck "thinking").
    if (line[view].fen.split(' ')[1] !== playUserColor) return -1;
    return view;
  }
  let best = -1, bestD = Infinity;
  for (let i = 0; i < evalsW.length; i++) {
    if (evalsW[i] !== null) continue;
    const d = Math.abs(i - view);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const eng = await getEngine();
    let i: number;
    while ((i = nextEvalIndex()) !== -1) {
      const fen = line[i].fen;
      const c = new Chess(fen);
      if (c.isGameOver()) {
        evalsW[i] = c.isCheckmate() ? (fen.split(' ')[1] === 'w' ? -10000 : 10000) : 0;
        bestU[i] = null; mateN[i] = null;
      } else {
        const r = await eng.evaluate(fen, curDepth());
        // line/evalsW may have been reassigned (a new PGN/game loaded, or the position reset)
        // while this search was in flight. Unlike updateCandidates/updateTablebase (which discard
        // one stale result and return), pump() loops — so a stale write here wouldn't just show one
        // wrong eval, it would keep writing into the old array's indices, potentially past the end
        // of a shorter new one, or throw on the next iteration when it reads line[i] for an index
        // that no longer exists. Bail the whole loop; whatever triggered the reassignment already
        // calls pump() again for the new line.
        if (line[i]?.fen !== fen) break;
        evalsW[i] = whiteCp(fen, r.cp); bestU[i] = r.bestmove; mateN[i] = r.mateIn;
      }
      // refresh anything that depends on this newly-evaluated index
      if (Math.abs(i - view) <= 1) {
        if (evalsW[view] != null) setEvalBar(evalsW[view]!);
        renderAssess(new Chess(line[view].fen), line[view].fen);
      }
      renderMoveList();
      renderEvalGraph(); // the sparkline reflects the whole line, so any new eval refreshes it
    }
  } finally {
    pumping = false;
  }
}

// ---------- multi-PV candidate moves for the currently viewed position ----------
const NUM_CANDIDATES = 3;
let candidatesToken = 0;

function renderCandidates(fen: string, results: EngineEval[]) {
  const panel = $('#candidates');
  if (!results.length) { panel.innerHTML = ''; board.setArrows([]); return; }
  const stmWhite = fen.split(' ')[1] === 'w';
  const arrows = results.slice(0, NUM_CANDIDATES).map((r, i) => {
    const uci = r.bestmove;
    return uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4), rank: (i + 1) as 1 | 2 | 3 } : null;
  }).filter((a): a is { from: string; to: string; rank: 1 | 2 | 3 } => a !== null);
  board.setArrows(arrows);

  const rows = results.slice(0, NUM_CANDIDATES).map((r, i) => {
    const san = r.bestmove ? uciToSan(fen, r.bestmove) ?? r.bestmove : '—';
    const whiteEval = stmWhite ? r.cp : -r.cp;
    const evalStr = fmtEval(whiteEval, r.mateIn, stmWhite);
    const contPv = r.bestmove ? pvToSans(fen, r.pv, 4).slice(1).join(' ') : '';
    return `<div class="cand-row cand-rank${i + 1}">
      <span class="cand-num">${i + 1}</span>
      <span class="cand-move">${san}</span>
      <span class="eval-chip">${evalStr}</span>
      ${contPv ? `<span class="hint cand-cont">${contPv}</span>` : ''}
    </div>`;
  });
  panel.innerHTML = rows.join('');
}

async function updateCandidates() {
  const token = ++candidatesToken;
  const fen = line[view].fen;
  const c = new Chess(fen);
  if (c.isGameOver()) { $('#candidates').innerHTML = ''; return; }
  const eng = await getEngine();
  const results = await eng.evaluateMultiPv(fen, curDepth(), NUM_CANDIDATES);
  if (token !== candidatesToken) return; // superseded by a newer navigation
  if (line[view]?.fen !== fen) return; // view moved on while we were searching
  renderCandidates(fen, results);
}

// Debounce candidate updates when rapidly navigating through positions (e.g. arrow key spam).
const debouncedUpdateCandidates = debounce(updateCandidates, 80);

// ---------- tablebase overlay (≤7 pieces) ----------
let tablebaseToken = 0;
let tablebaseAbort: AbortController | null = null;

async function updateTablebase() {
  const panel = $('#tablebase-panel');
  const fen = line[view].fen;
  if (!tablebaseEligible(fen)) { panel.hidden = true; panel.innerHTML = ''; return; }

  const token = ++tablebaseToken;
  tablebaseAbort?.abort();
  tablebaseAbort = new AbortController();
  panel.hidden = false;
  panel.innerHTML = `<span class="hint">Checking tablebase…</span>`;

  const result = await queryTablebase(fen, tablebaseAbort.signal);
  if (token !== tablebaseToken) return; // superseded by a newer position
  if (line[view]?.fen !== fen) return; // view moved on while the request was in flight

  if (!result) { panel.hidden = true; panel.innerHTML = ''; return; }

  // result.category and result.moves are already from the side-to-move's perspective, so no
  // white/black conversion is needed here (unlike the engine eval, which is side-to-move cp and
  // does need flipping to white's perspective for the eval bar).
  const label = tbCategoryLabel(result.category);
  const cls = tbCategoryClass(result.category);
  const dtzStr = result.dtz != null && result.category !== 'draw' ? ` in ${Math.abs(result.dtz)}` : '';
  const best = result.moves[0];
  const bestStr = best ? ` · best: <b>${best.san}</b>` : '';
  panel.innerHTML =
    `<div class="tb-verdict"><span class="tb-badge">📚 Tablebase</span> ` +
    `<span class="${cls}">${label}${dtzStr}</span>${bestStr}</div>`;
}

// Debounce tablebase lookups the same way as candidates, for the same reason (arrow-key spam).
const debouncedUpdateTablebase = debounce(updateTablebase, 80);

// ======================================================================
// PLAY VS ENGINE — auto-play engine moves
// ======================================================================
// Bumped whenever the line is reset/reloaded/taken back, so an engine search that is still in
// flight for the old position discards its result instead of splicing it into the new line.
let playMoveToken = 0;
function invalidatePlayEngineMove() {
  playMoveToken++;
  playEngineThinking = false;
  // The token above stops a stale search's RESULT from being applied, but the search itself (if
  // one is actively running — e.g. pump()'s background eval of the position the user just moved
  // away from) would otherwise keep occupying the engine's single serialized queue until it
  // finishes on its own. Since evaluate()/evaluateMultiPv() only resolve on a 'bestmove' message,
  // and stop() makes Stockfish emit one almost immediately, this frees the queue for the engine's
  // real reply right away instead of leaving it stuck behind a search nobody needs anymore —
  // which, at higher engine strength, could stall the engine's actual move for many seconds and
  // read as the game being stuck.
  engine?.stop();
}

async function playEngineMove() {
  if (mode !== 'play' || !playActive || playEngineThinking) return;
  const fen = line[view].fen;
  const c = new Chess(fen);
  const status = $('#play-status');
  if (c.isGameOver()) {
    status.textContent = c.isCheckmate() ? 'Checkmate!' : c.isStalemate() ? 'Stalemate!' : c.isDraw() ? 'Draw!' : 'Game over!';
    return;
  }
  // The engine only ever moves for its own colour. Without this it would happily play the user's
  // move too, so one side ended up making several moves in a row and the other never got a turn.
  if (c.turn() === playUserColor) return;

  const token = ++playMoveToken;
  playEngineThinking = true;
  status.textContent = 'Engine thinking…';
  try {
    const eng = await getEngine();
    const res = await eng.evaluate(fen, curDepth());
    // The board may have moved on while we were searching (take-back, reset, a new game loaded).
    // The move we just computed belongs to a position that is no longer on the board, so applying
    // it would splice a move from a stale line into the current one and derail the move order.
    if (token !== playMoveToken || mode !== 'play' || line[view]?.fen !== fen) return;
    if (!res.bestmove) { status.textContent = 'No move found.'; return; }

    const uci = res.bestmove;
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
    if (!m) { status.textContent = 'Engine returned an illegal move.'; return; }
    truncateAfter(view);
    appendNode(m.after, uci);
    view = line.length - 1;
    render(); // owns the status: "Your turn" / "Checkmate!" / etc.
    void pump();
  } catch {
    status.textContent = 'Engine error.';
  } finally {
    // Only release the lock if a newer game/search hasn't already taken ownership.
    if (token === playMoveToken) playEngineThinking = false;
  }
}

// ======================================================================
// POSITION TAB — FEN / PGN / click-to-move
// ======================================================================
board.onSquareClick = (sq) => {
  // Click-to-move works in the Position tab, Play mode, and static FEN/study loads in Live tab.
  if (mode === 'live' && connKind === 'game') return; // don't allow clicking during live game
  if (mode !== 'position' && mode !== 'play' && connKind !== 'static') return;
  const fen = line[view].fen;
  const c = new Chess(fen);
  // In Play mode you move only your own pieces, only on your own turn, only once a game is active,
  // and never while the engine is mid-search — otherwise the engine's reply (computed for the
  // previous position) lands on a line that has already moved on, and the move order breaks.
  if (mode === 'play' && (!playActive || playEngineThinking || c.turn() !== playUserColor)) return;
  const piece = c.get(sq as any);
  const sel = board.getSelected();
  if (sel && sel !== sq) {
    const moves = c.moves({ square: sel as any, verbose: true }) as any[];
    const m = moves.find((x) => x.to === sq);
    if (m) {
      truncateAfter(view);
      appendNode(m.after, sel + sq + (m.promotion ? 'q' : ''));
      view = line.length - 1;
      $('#engine-out').innerHTML = '';
      // In Play mode, pump() may still be mid-search evaluating the position the user is about to
      // move away from (a background eval shown during their own turn). Cancel it now so it can't
      // occupy the engine's queue ahead of the engine's actual reply below.
      if (mode === 'play') engine?.stop();
      render();
      void pump();
      if (mode === 'play') void playEngineMove(); // no-op unless it's now the engine's turn
      return;
    }
    // Not a legal destination for the selected piece. If it's one of the player's own other
    // pieces, this is just "change my mind" reselection — not a mistake, no flash. Otherwise it
    // was a genuine illegal-move attempt (blocked path, pin, moving into check, etc.), and without
    // any feedback that silently does nothing, which reads as the whole board being unresponsive.
    const isOwnPiece = !!(piece && piece.color === c.turn());
    board.setSelected(isOwnPiece ? sq : null);
    // setSelected() above just rebuilt the whole board's DOM (it always re-renders) — flashIllegal
    // has to run *after* that, not before, or the fresh render wipes out the flash class the same
    // tick it's applied and the square never visibly flashes at all.
    if (!isOwnPiece) board.flashIllegal(sq);
    return;
  }
  if (piece && piece.color === c.turn()) board.setSelected(sq);
  else board.setSelected(null);
};

/** Loads a FEN into Any Position mode's board — shared by the FEN input's own Load button and
 *  the "Analyze in Any Position" action from Live mode. Returns whether it was valid. */
function loadFenIntoPosition(fen: string): boolean {
  try {
    new Chess(fen); // validate
    resetLine(fen);
    $('#engine-out').innerHTML = '';
    render();
    void pump();
    return true;
  } catch {
    $('#engine-out').innerHTML = `<p class="neg">Invalid FEN.</p>`;
    return false;
  }
}

$('#load-fen').addEventListener('click', () => {
  loadFenIntoPosition(($('#fen-input') as HTMLInputElement).value.trim());
});

$('#load-pgn').addEventListener('click', () => {
  const pgn = ($('#pgn-input') as HTMLTextAreaElement).value.trim();
  if (!pgn) { $('#engine-out').innerHTML = `<p class="neg">Paste a PGN first.</p>`; return; }
  const built = buildLineFromPgn(pgn);
  if (!built || built.line.length === 0) {
    $('#engine-out').innerHTML = `<p class="neg">Could not parse that PGN.</p>`;
    return;
  }
  line = built.line;
  evalsW = line.map(() => null); bestU = line.map(() => null); mateN = line.map(() => null);
  view = 0;
  curWhite = built.white; curBlack = built.black; curEvent = built.event; curResult = built.result;
  const label = built.white ? `${built.white}${built.wr ? ` (${built.wr})` : ''} vs ${built.black}${built.br ? ` (${built.br})` : ''} — ` : '';
  $('#engine-out').innerHTML = `<p class="hint">${label}${line.length - 1} moves loaded. Use ◀ ▶ / arrow keys to step through; feedback fills in as the engine analyses.</p>`;
  render();
  void pump();
});

$('#reset-board').addEventListener('click', () => {
  resetLine(START);
  ($('#pgn-input') as HTMLTextAreaElement).value = '';
  $('#engine-out').innerHTML = '';
  render();
  void pump();
});

$('#undo-btn').addEventListener('click', () => {
  if (line.length <= 1) return;
  truncateAfter(line.length - 2);
  if (view > line.length - 1) view = line.length - 1;
  $('#engine-out').innerHTML = '';
  render();
});

$('#suggest-btn').addEventListener('click', async () => {
  const out = $('#engine-out');
  const fen = line[view].fen;
  const c = new Chess(fen);
  if (c.isGameOver()) { out.innerHTML = `<p class="hint">Game is over — no move to suggest.</p>`; return; }
  const depth = parseInt(($('#depth-position') as HTMLSelectElement).value, 10);
  out.innerHTML = `<p class="hint">Loading ${ENGINE_NAME} &amp; searching to depth ${depth}…</p>`;
  const eng = await getEngine();
  const res = await eng.evaluate(fen, depth, (p) => {
    if (p.bestmove) { board.setArrow([p.bestmove.slice(0, 2), p.bestmove.slice(2, 4)]); setEvalBar(whiteCp(fen, p.cp)); }
  });
  if (!res.bestmove) { out.innerHTML = `<p class="hint">No move found.</p>`; return; }
  evalsW[view] = whiteCp(fen, res.cp); bestU[view] = res.bestmove; mateN[view] = res.mateIn;
  const stmWhite = fen.split(' ')[1] === 'w';
  ($('#play-best-btn') as HTMLElement).hidden = false;
  out.innerHTML =
    `<div class="best-move">Best move: <b>${uciToSan(fen, res.bestmove) ?? res.bestmove}</b>` +
    ` <span class="eval-chip">${fmtEval(evalsW[view]!, res.mateIn, stmWhite)}</span>` +
    ` <span class="hint">(depth ${res.depth})</span></div>` +
    `<div class="pv-line"><span class="hint">Principal variation:</span> ${pvToSans(fen, res.pv).join(' ') || '—'}</div>`;
  render();
});

$('#play-best-btn').addEventListener('click', () => {
  const b = bestU[view];
  if (!b) return;
  const c = new Chess(line[view].fen);
  try {
    const m = c.move({ from: b.slice(0, 2), to: b.slice(2, 4), promotion: b.length > 4 ? b.slice(4) : undefined });
    truncateAfter(view);
    appendNode(m.after, b);
    view = line.length - 1;
    ($('#play-best-btn') as HTMLElement).hidden = true;
    $('#engine-out').innerHTML = '';
    render();
    void pump();
  } catch { /* illegal — ignore */ }
});

// ======================================================================
// LIVE TAB — stream a lichess game into the navigator
// ======================================================================
let liveAbort: AbortController | null = null;
let pgnLoaded = false;
let connKind: 'game' | 'static' = 'game'; // 'static' = study/analysis position — no live stream to follow

type LichessInput =
  | { kind: 'game'; id: string }
  | { kind: 'study'; studyId: string; chapterId?: string }
  | { kind: 'fen'; fen: string };

/** Recognise a lichess game URL/ID, a study URL (with or without a chapter), an analysis-board
 *  URL with an embedded FEN, or a bare pasted FEN. */
function classifyLichessInput(raw: string): LichessInput | null {
  const s = raw.trim();

  const study = s.match(/lichess\.org\/study\/([a-zA-Z0-9]{8})(?:\/([a-zA-Z0-9]{8}))?/);
  if (study) return { kind: 'study', studyId: study[1], chapterId: study[2] };

  const analysisFen = s.match(
    /lichess\.org\/analysis(?:\/\w+)?\/([1-8pnbrqkPNBRQK]+(?:\/[1-8pnbrqkPNBRQK]+){7}_[wb]_[\w-]+_[\w-]+_\d+_\d+)/
  );
  if (analysisFen) return { kind: 'fen', fen: analysisFen[1].replace(/_/g, ' ') };

  // A bare FEN pasted directly (not a URL at all).
  if (/^[1-8pnbrqkPNBRQK/]+\s+[wb]\s+[\w-]+\s+\S+\s+\d+\s+\d+$/.test(s)) return { kind: 'fen', fen: s };

  const game = s.match(/lichess\.org\/([a-zA-Z0-9]{8,12})(?:[/?#]|$)/);
  const id = game ? game[1] : s;
  if (/^[a-zA-Z0-9]{8,12}$/.test(id)) return { kind: 'game', id: id.slice(0, 8) };
  return null;
}

function setPlayers(white?: string, black?: string, wr?: string, br?: string, fallbackLabel?: string) {
  curWhite = white; curBlack = black;
  if (!white && !black) {
    if (fallbackLabel) $('#live-players').innerHTML = `<b>${fallbackLabel}</b>`;
    return;
  }
  const w = white || 'White', b = black || 'Black';
  $('#live-players').innerHTML = `<b>${w}</b>${wr ? ` (${wr})` : ''} &nbsp;vs&nbsp; <b>${b}</b>${br ? ` (${br})` : ''}`;
}

function appendFromStream(fen: string, lm: string | null) {
  if (line.length && line[line.length - 1].fen === fen) return; // already have it
  if (!pgnLoaded && line.length === 1 && line[0].fen === START && fen !== START) {
    line[0] = { fen, lm: null, san: null }; // rebase: no pre-history available
  } else {
    appendNode(fen, lm);
  }
  if (liveFollow) view = line.length - 1;
  render();
  void pump();
}

function handleStreamMessage(msg: any, status: HTMLElement) {
  if (msg.players) {
    const w = msg.players?.white, b = msg.players?.black;
    if (!$('#live-players').innerHTML) {
      setPlayers(w?.user?.name || w?.userId || w?.name, b?.user?.name || b?.userId || b?.name, w?.rating, b?.rating);
    }
    if (!pgnLoaded) status.innerHTML = `Connected. Following live — feedback on every move.`;
  }
  if (msg.fen) {
    const fen = msg.fen.split(' ').length >= 4 ? msg.fen : msg.fen + ' w - - 0 1';
    appendFromStream(fen, msg.lm || msg.lastMove || null);
    // Keep the move count in this status line current as the game progresses — it used to be
    // set once from the initial history backfill and then never touched again, so it could sit
    // showing a stale, much-lower count next to a board that had already moved on well past it,
    // reading as if the app itself were behind rather than just this one line of text.
    status.innerHTML = `${line.length - 1} move${line.length - 1 === 1 ? '' : 's'} so far. Following live — step back any time with ◀ ▶.`;
  }
}

async function streamLichessGame(id: string, controller: AbortController, status: HTMLElement) {
  const signal = controller.signal;
  let res: Response;
  try {
    res = await fetch(`https://lichess.org/api/stream/game/${id}`, { headers: { Accept: 'application/x-ndjson' }, signal });
  } catch { if (!signal.aborted) { status.innerHTML = `<span class="neg">Could not reach lichess.</span>`; disconnect(controller); } return; }
  if (!res.ok || !res.body) {
    status.innerHTML = `<span class="neg">Lichess returned ${res.status} — game not found or not viewable.</span>`;
    disconnect(controller);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const l = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (l) { try { handleStreamMessage(JSON.parse(l), status); } catch { /* skip */ } }
      }
    }
    status.innerHTML += ' <span class="hint">· stream ended (you can still navigate the game).</span>';
  } catch { if (!signal.aborted) status.innerHTML += ' <span class="neg">· connection lost.</span>'; }
  finally { disconnect(controller); }
}

async function connectLive(id: string) {
  disconnect();
  connKind = 'game';
  liveAbort = new AbortController();
  const signal = liveAbort.signal;
  resetLine(START);
  liveFollow = true; pgnLoaded = false;
  $('#live-players').innerHTML = '';
  const status = $('#live-status');
  status.innerHTML = `Loading game <code>${id}</code>…`;
  render();

  // 1) Open the live move stream immediately — this used to run after the full-history fetch
  // below, so any moves played while that fetch was in flight were missed until the next one
  // arrived (the visible "2-3 moves behind" lag). Starting it first means the stream itself
  // starts capturing deltas (via the rebase-on-first-message path in appendFromStream) from the
  // moment we connect, independent of how long the history backfill takes.
  const streamPromise = streamLichessGame(id, liveAbort, status);

  // 2) Backfill full game history in parallel so earlier moves are still navigable. Splice it in
  // ahead of whatever the live stream has already built, rather than blindly overwriting `line`
  // (a wholesale swap can race with concurrent stream deltas: the stream may have already
  // rebased onto the current position and appended a few more moves by the time this resolves,
  // and replacing the whole array at that point re-derails its own dedup bookkeeping, so
  // subsequent legitimate deltas get appended as duplicates instead of recognised as already
  // present — inflating the move count well past the real game length). Find where our current
  // anchor (line[0], set by the stream's very first message) falls inside the backfill's full
  // history, and keep the backfill's earlier moves plus everything our own line already has from
  // that point on — the stream is the continuously-authoritative source for anything after the
  // anchor, so we never need to trust the backfill's view of "now," only its view of "before."
  try {
    const r = await fetch(`https://lichess.org/game/export/${id}?clocks=false&evals=false&literate=false`, {
      headers: { Accept: 'application/x-chess-pgn' }, signal,
    });
    if (r.ok) {
      const built = buildLineFromPgn(await r.text());
      if (built && built.line.length > 1) {
        const anchorFen = line[0]?.fen;
        const anchorIdx = anchorFen ? built.line.findIndex((n) => n.fen === anchorFen) : -1;
        if (anchorIdx !== -1) {
          const prependedCount = anchorIdx;
          line = built.line.slice(0, anchorIdx).concat(line);
          evalsW = line.map(() => null); bestU = line.map(() => null); mateN = line.map(() => null);
          if (liveFollow) view = line.length - 1;
          else view += prependedCount;
          status.innerHTML = `Loaded ${line.length - 1} moves. Following live — step back any time with ◀ ▶.`;
        }
        pgnLoaded = true;
        setPlayers(built.white, built.black, built.wr, built.br);
        curEvent = built.event; curResult = built.result;
      }
    }
  } catch { if (signal.aborted) return; }
  render();
  void pump();

  void streamPromise;
}

/** Load a lichess study chapter (or the first chapter of a whole study) as a static, navigable game. */
async function connectStudy(studyId: string, chapterId?: string) {
  disconnect();
  connKind = 'static';
  const status = $('#live-status');
  $('#live-players').innerHTML = '';
  status.innerHTML = `Loading study <code>${studyId}</code>…`;
  const url = chapterId
    ? `https://lichess.org/study/${studyId}/${chapterId}.pgn`
    : `https://lichess.org/study/${studyId}.pgn`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' } });
    if (!r.ok) {
      status.innerHTML = `<span class="neg">Lichess returned ${r.status} — study not found or not public.</span>`;
      return;
    }
    const text = await r.text();
    const chunks = splitPgn(text);
    if (!chunks.length) {
      status.innerHTML = `<span class="neg">That study has no chapters to load.</span>`;
      return;
    }
    const built = buildLineFromPgn(chunks[0]);
    if (!built || built.line.length === 0) {
      status.innerHTML = `<span class="neg">Could not read that study chapter.</span>`;
      return;
    }
    line = built.line;
    evalsW = line.map(() => null); bestU = line.map(() => null); mateN = line.map(() => null);
    view = 0;
    setPlayers(built.white, built.black, built.wr, built.br, built.event);
    curEvent = built.event; curResult = built.result;
    const more = chunks.length > 1 ? ` (chapter 1 of ${chunks.length} — paste a direct chapter link for another)` : '';
    status.innerHTML = `Loaded study chapter${more}. Use ◀ ▶ to step through.`;
    render();
    void pump();
  } catch {
    status.innerHTML = `<span class="neg">Could not reach lichess.</span>`;
  }
}

/** Load a single position from a pasted FEN or a lichess analysis-board link. */
function connectFen(fen: string) {
  disconnect();
  connKind = 'static';
  const status = $('#live-status');
  $('#live-players').innerHTML = '';
  try {
    new Chess(fen); // validate
  } catch {
    status.innerHTML = `<span class="neg">Couldn't read a position from that link — try pasting the FEN directly.</span>`;
    return;
  }
  resetLine(fen);
  status.innerHTML = `Loaded position. Use ◀ ▶ or click pieces to explore.`;
  render();
  void pump();
}

$('#connect-btn').addEventListener('click', () => {
  const parsed = classifyLichessInput(($('#game-input') as HTMLInputElement).value);
  const status = $('#live-status');
  if (!parsed) {
    status.innerHTML = `<span class="neg">Enter a lichess game URL/ID, a study link, an analysis-board link, or a FEN.</span>`;
    return;
  }
  ($('#connect-btn') as HTMLElement).hidden = true;
  ($('#disconnect-btn') as HTMLElement).hidden = false;
  if (parsed.kind === 'game') void connectLive(parsed.id);
  else if (parsed.kind === 'study') void connectStudy(parsed.studyId, parsed.chapterId);
  else connectFen(parsed.fen);
});

// `forController`, when passed, scopes this call to "only tear down if that specific connection is
// still the current one" — used by a stream's own cleanup path, since a slow-to-unwind old stream
// (aborted, but its reader.read() hasn't settled yet) can otherwise reach its `finally` block after
// a new connection has already started, and tear down the NEW connection instead of the one it
// actually belongs to (liveAbort has since been reassigned). An explicit, caller-initiated
// disconnect (button click, mode switch, starting a fresh connect) always calls this with no
// argument — that one always means "tear down whatever is current," unconditionally.
function disconnect(forController?: AbortController) {
  if (forController && forController !== liveAbort) return; // superseded by a newer connection already
  if (liveAbort) { liveAbort.abort(); liveAbort = null; }
  ($('#connect-btn') as HTMLElement).hidden = false;
  ($('#disconnect-btn') as HTMLElement).hidden = true;
}
$('#disconnect-btn').addEventListener('click', () => {
  disconnect();
  $('#live-status').innerHTML = 'Disconnected — the loaded game is still navigable.';
});
$('#live-jump').addEventListener('click', () => goto(line.length - 1));

// ======================================================================
// nav buttons, tabs, keyboard, init
// ======================================================================
$('#nav-first').addEventListener('click', () => goto(0));
$('#nav-back').addEventListener('click', () => goto(view - 1));
$('#nav-fwd').addEventListener('click', () => goto(view + 1));
$('#nav-last').addEventListener('click', () => goto(line.length - 1));
$('#flip-btn').addEventListener('click', () => board.flip());
$('#export-pgn-btn').addEventListener('click', () => {
  const pgn = buildPgnFromLine({
    white: curWhite, black: curBlack, event: curEvent, result: curResult,
    line, evalsW, bestU,
  });
  const safeName = `${curWhite || 'white'}_vs_${curBlack || 'black'}`.replace(/[^\w.-]/g, '_').slice(0, 60);
  downloadPgn(`${safeName}.pgn`, pgn);
});

/** Briefly swaps a button's label to confirm a clipboard write succeeded — copying is silent
 *  otherwise, so without this the button looks like it did nothing. */
function flashCopied(btn: HTMLButtonElement, label: string) {
  const original = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

$('#copy-fen-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(line[view].fen);
    flashCopied(btn, '✓ Copied');
  } catch {
    flashCopied(btn, 'Copy failed');
  }
});

$('#copy-pgn-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  const pgn = buildPgnFromLine({ white: curWhite, black: curBlack, event: curEvent, result: curResult, line, evalsW, bestU });
  try {
    await navigator.clipboard.writeText(pgn);
    flashCopied(btn, '✓ Copied');
  } catch {
    flashCopied(btn, 'Copy failed');
  }
});

// Sends the exact position currently being viewed in Live mode over to Any Position mode and
// runs a deep engine search on it — the quickest path to a slower, deeper look at a live-game
// position than Live mode's own background candidate-move analysis gives you.
$('#analyze-position-btn').addEventListener('click', () => {
  const fen = line[view].fen;
  document.querySelector<HTMLElement>('.tab[data-mode="position"]')?.click();
  ($('#fen-input') as HTMLInputElement).value = fen;
  if (loadFenIntoPosition(fen)) $('#suggest-btn').click();
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.key === 'ArrowLeft') { goto(view - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { goto(view + 1); e.preventDefault(); }
  else if (e.key === 'Home') { goto(0); e.preventDefault(); }
  else if (e.key === 'End') { goto(line.length - 1); e.preventDefault(); }
  else if (e.key === ' ') {
    // Play the best move if one is available.
    e.preventDefault();
    const fen = line[view].fen;
    const c = new Chess(fen);
    if (!c.isGameOver() && bestU[view]) {
      const uci = bestU[view]!;
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
      if (m) {
        truncateAfter(view);
        appendNode(m.after, uci);
        goto(view + 1);
      }
    }
  }
});

// ======================================================================
// PLAY VS ENGINE TAB — event listeners
// ======================================================================
$('#play-start-btn').addEventListener('click', () => {
  const colorSelect = ($('#play-color') as HTMLSelectElement).value as 'w' | 'b';
  const fenInput = ($('#play-fen-input') as HTMLInputElement).value.trim();
  playUserColor = colorSelect;
  invalidatePlayEngineMove();

  const fen = fenInput || START;
  try {
    new Chess(fen); // validate
  } catch {
    $('#play-status').textContent = 'Invalid FEN';
    return;
  }

  resetLine(fen);
  playActive = true;
  board.setOrientation(playUserColor); // your own pieces at the bottom, like every other chess site
  ($('#play-undo-btn') as HTMLElement).hidden = false;
  ($('#play-reset-btn') as HTMLElement).hidden = false;
  render();
  void pump();
  // Whoever is to move in the starting position: if it's the engine's colour, it moves first;
  // otherwise render() has already set "Your turn".
  void playEngineMove();
});

$('#play-undo-btn').addEventListener('click', () => {
  if (line.length < 3) return; // need at least one full move pair
  invalidatePlayEngineMove(); // cancel any in-flight engine search before mutating the line
  truncateAfter(line.length - 3);
  view = line.length - 1;
  render();
  void pump();
  void playEngineMove(); // no-op unless the take-back somehow landed on the engine's turn
});

$('#play-reset-btn').addEventListener('click', () => {
  const colorSelect = ($('#play-color') as HTMLSelectElement).value as 'w' | 'b';
  const fenInput = ($('#play-fen-input') as HTMLInputElement).value.trim();
  playUserColor = colorSelect;
  invalidatePlayEngineMove();
  const fen = fenInput || START;
  resetLine(fen);
  playActive = true;
  board.setOrientation(playUserColor);
  render();
  void pump();
  void playEngineMove(); // engine moves first if the start position is its colour
});

/** Fetch a lichess game/study/FEN and hand its latest position to Play-vs-Engine mode, so the
 *  user can take over and continue playing against the engine from that point. */
async function loadLichessGameForPlay(raw: string) {
  const status = $('#play-status');
  const parsed = classifyLichessInput(raw);
  if (!parsed) {
    status.textContent = 'Enter a lichess game URL/ID, a study link, or a FEN.';
    return;
  }

  let built: BuiltLine | null = null;
  status.textContent = 'Loading from lichess…';
  try {
    if (parsed.kind === 'game') {
      const r = await fetch(`https://lichess.org/game/export/${parsed.id}?clocks=false&evals=false&literate=false`, {
        headers: { Accept: 'application/x-chess-pgn' },
      });
      if (!r.ok) { status.textContent = `Lichess returned ${r.status} — game not found or not viewable.`; return; }
      built = buildLineFromPgn(await r.text());
    } else if (parsed.kind === 'study') {
      const url = parsed.chapterId
        ? `https://lichess.org/study/${parsed.studyId}/${parsed.chapterId}.pgn`
        : `https://lichess.org/study/${parsed.studyId}.pgn`;
      const r = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' } });
      if (!r.ok) { status.textContent = `Lichess returned ${r.status} — study not found or not public.`; return; }
      const chunks = splitPgn(await r.text());
      built = chunks.length ? buildLineFromPgn(chunks[0]) : null;
    } else {
      // A bare FEN / analysis-board link — just play from that single position.
      try { new Chess(parsed.fen); } catch { status.textContent = 'Invalid FEN.'; return; }
      built = { line: [{ fen: parsed.fen, lm: null, san: null }] };
    }
  } catch {
    status.textContent = 'Could not reach lichess.';
    return;
  }

  if (!built || built.line.length === 0) { status.textContent = 'Could not read a position from that.'; return; }

  // Adopt the loaded line and jump to its latest position — that's where the user takes over.
  invalidatePlayEngineMove(); // discard any search still running for the previous position/game
  line = built.line;
  evalsW = line.map(() => null); bestU = line.map(() => null); mateN = line.map(() => null);
  view = line.length - 1;
  curWhite = built.white; curBlack = built.black; curEvent = built.event; curResult = built.result;

  playUserColor = ($('#play-color') as HTMLSelectElement).value as 'w' | 'b';
  playActive = true;
  board.setOrientation(playUserColor);
  ($('#play-undo-btn') as HTMLElement).hidden = false;
  ($('#play-reset-btn') as HTMLElement).hidden = false;
  render();
  void pump();
  // If it's the engine's colour to move at the loaded position it replies; otherwise render() has
  // already set the status to "Your turn".
  void playEngineMove();
}

$('#play-load-lichess-btn').addEventListener('click', () => {
  void loadLichessGameForPlay(($('#play-lichess-input') as HTMLInputElement).value);
});

document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const newMode = (tab.dataset.mode as 'position' | 'live' | 'play') ?? 'position';
    // Leaving Live for ANY other mode (not just Position) must tear down the background stream —
    // otherwise it keeps running and can still append moves/call render() against whatever mode
    // (e.g. an in-progress Play vs Engine game) the user has since switched to.
    if (newMode !== 'live' && mode === 'live') disconnect();
    mode = newMode;
    ($('#panel-position') as HTMLElement).hidden = mode !== 'position';
    ($('#panel-live') as HTMLElement).hidden = mode !== 'live';
    ($('#panel-play') as HTMLElement).hidden = mode !== 'play';
    if (mode === 'play') {
      invalidatePlayEngineMove();
      playActive = false;
      resetLine(START);
      playUserColor = 'w';
      board.setOrientation('w');
      ($('#play-status') as HTMLElement).textContent = 'Press "Start game" or load a lichess game to begin.';
      ($('#play-undo-btn') as HTMLElement).hidden = true;
      ($('#play-reset-btn') as HTMLElement).hidden = true;
    } else {
      // Leaving Play mode — cancel any pending engine move and restore standard orientation so
      // Position/Live modes never inherit a flipped board from a Black game.
      invalidatePlayEngineMove();
      board.setOrientation('w');
    }
    render();
  });
});

resetLine(START);
render();
setEvalBar(20);

// Deep link from another tool, e.g. Analyze's "open in Live & Engine": ?game=<lichess URL/ID>
const deepLinkGame = new URLSearchParams(location.search).get('game');
if (deepLinkGame) {
  document.querySelector<HTMLElement>('.tab[data-mode="live"]')?.click();
  ($('#game-input') as HTMLInputElement).value = deepLinkGame;
  ($('#connect-btn') as HTMLElement).click();
}
