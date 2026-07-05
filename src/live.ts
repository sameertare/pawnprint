import './style.css';
import { Chess } from 'chess.js';
import { Board } from './board';
import { Engine, ENGINE_NAME } from './engine';
import { winPct } from './analyze';

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

const boardEl = $('#board');
const board = new Board(boardEl);
const evalFill = $('#evalfill');
const evalNum = $('#evalnum');
const turnInd = $('#turn-indicator');
$('#engine-name').textContent = ENGINE_NAME;

// ---------- helpers ----------
function whiteCp(fen: string, cpSideToMove: number): number {
  return fen.split(' ')[1] === 'w' ? cpSideToMove : -cpSideToMove;
}
function fmtEval(whiteCp: number, mate: number | null, moverIsWhite: boolean): string {
  if (mate !== null) {
    // mate is from side-to-move perspective; convert sign to white
    const m = moverIsWhite ? mate : -mate;
    return `#${m > 0 ? m : m}`;
  }
  const pawns = whiteCp / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
}
function setEvalBar(whiteCpVal: number) {
  const wp = winPct(whiteCpVal); // white win%
  evalFill.style.height = `${wp}%`;
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

// ======================================================================
// MODE 1 — analyze any position
// ======================================================================
const posChess = new Chess();
let history: string[] = []; // fen stack for undo
let bestUci: string | null = null;

function refreshPosition() {
  const fen = posChess.fen();
  board.setFen(fen);
  const stm = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  if (posChess.isCheckmate()) turnInd.textContent = 'Checkmate';
  else if (posChess.isDraw()) turnInd.textContent = 'Draw';
  else turnInd.textContent = `${stm} to move${posChess.inCheck() ? ' — check' : ''}`;
  bestUci = null;
  ($('#play-best-btn') as HTMLElement).hidden = true;
  board.setArrow(null);
}

// click-to-move
board.onSquareClick = (sq) => {
  if ($('#panel-live').hidden === false) return; // ignore clicks in live mode
  const piece = posChess.get(sq as any);
  const sel = board.getSelected();
  if (sel && sel !== sq) {
    // try move sel -> sq
    const moves = posChess.moves({ square: sel as any, verbose: true }) as any[];
    const m = moves.find((x) => x.to === sq);
    if (m) {
      history.push(posChess.fen());
      posChess.move({ from: sel, to: sq, promotion: m.promotion ? 'q' : undefined });
      board.setSelected(null);
      board.setLastMove([sel as string, sq]);
      refreshPosition();
      $('#engine-out').innerHTML = '';
      return;
    }
  }
  if (piece && piece.color === posChess.turn()) board.setSelected(sq);
  else board.setSelected(null);
};

$('#load-fen').addEventListener('click', () => {
  const fen = ($('#fen-input') as HTMLInputElement).value.trim();
  try {
    posChess.load(fen);
    history = [];
    board.setLastMove(null);
    refreshPosition();
    $('#engine-out').innerHTML = '';
  } catch {
    $('#engine-out').innerHTML = `<p class="neg">Invalid FEN.</p>`;
  }
});
$('#reset-board').addEventListener('click', () => {
  posChess.load(START);
  history = [];
  board.setLastMove(null);
  refreshPosition();
  $('#engine-out').innerHTML = '';
});
$('#undo-btn').addEventListener('click', () => {
  if (!history.length) return;
  posChess.load(history.pop()!);
  board.setLastMove(null);
  refreshPosition();
  $('#engine-out').innerHTML = '';
});

$('#suggest-btn').addEventListener('click', async () => {
  const out = $('#engine-out');
  if (posChess.isGameOver()) { out.innerHTML = `<p class="hint">Game is over — no move to suggest.</p>`; return; }
  const depth = parseInt(($('#depth-position') as HTMLSelectElement).value, 10);
  out.innerHTML = `<p class="hint">Loading ${ENGINE_NAME} &amp; searching to depth ${depth}…</p>`;
  const fen = posChess.fen();
  const eng = await getEngine();
  const res = await eng.evaluate(fen, depth, (partial) => {
    if (partial.bestmove) {
      board.setArrow([partial.bestmove.slice(0, 2), partial.bestmove.slice(2, 4)]);
      setEvalBar(whiteCp(fen, partial.cp));
    }
  });
  if (!res.bestmove) { out.innerHTML = `<p class="hint">No move found.</p>`; return; }
  bestUci = res.bestmove;
  const stmWhite = fen.split(' ')[1] === 'w';
  const wcp = whiteCp(fen, res.cp);
  setEvalBar(wcp);
  board.setArrow([res.bestmove.slice(0, 2), res.bestmove.slice(2, 4)]);
  const san = uciToSan(fen, res.bestmove);
  const line = pvToSans(fen, res.pv).join(' ');
  ($('#play-best-btn') as HTMLElement).hidden = false;
  out.innerHTML = `
    <div class="best-move">Best move: <b>${san ?? res.bestmove}</b>
      <span class="eval-chip">${fmtEval(wcp, res.mateIn, stmWhite)}</span>
      <span class="hint">(depth ${res.depth})</span>
    </div>
    <div class="pv-line"><span class="hint">Principal variation:</span> ${line || '—'}</div>`;
});

$('#play-best-btn').addEventListener('click', () => {
  if (!bestUci) return;
  history.push(posChess.fen());
  const from = bestUci.slice(0, 2), to = bestUci.slice(2, 4);
  posChess.move({ from, to, promotion: bestUci.length > 4 ? bestUci.slice(4) : undefined });
  board.setLastMove([from, to]);
  refreshPosition();
  $('#engine-out').innerHTML = '';
});

// ======================================================================
// MODE 2 — live lichess game
// ======================================================================
let liveAbort: AbortController | null = null;
let positions: { fen: string; lm: string | null }[] = [];
let evalsWhite: (number | null)[] = [];
let bestUciAt: (string | null)[] = [];
let mateAt: (number | null)[] = [];
let feedbackDone = new Set<number>();
let pumping = false;
let liveDepth = 13;
let playerWhite = '?';
let playerBlack = '?';

function parseGameId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/lichess\.org\/([a-zA-Z0-9]{8,12})/);
  const id = m ? m[1] : s;
  if (/^[a-zA-Z0-9]{8,12}$/.test(id)) return id.slice(0, 8); // game id is first 8 chars
  return null;
}

function pushPosition(fen: string, lm: string | null) {
  if (positions.length && positions[positions.length - 1].fen === fen) return;
  positions.push({ fen, lm });
  evalsWhite.push(null);
  bestUciAt.push(null);
  mateAt.push(null);
  board.setFen(fen);
  if (lm && lm.length >= 4) board.setLastMove([lm.slice(0, 2), lm.slice(2, 4)]);
  const stm = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  turnInd.textContent = `${stm} to move`;
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const eng = await getEngine();
    let i = evalsWhite.findIndex((v) => v === null);
    while (i !== -1) {
      const { fen } = positions[i];
      const c = new Chess(fen);
      if (c.isGameOver()) {
        evalsWhite[i] = c.isCheckmate() ? (fen.split(' ')[1] === 'w' ? -10000 : 10000) : 0;
      } else {
        const res = await eng.evaluate(fen, liveDepth);
        evalsWhite[i] = whiteCp(fen, res.cp);
        bestUciAt[i] = res.bestmove;
        mateAt[i] = res.mateIn;
      }
      // update suggestion + eval bar if this is the latest position
      if (i === positions.length - 1) {
        setEvalBar(evalsWhite[i]!);
        renderLiveSuggestion(i);
      }
      // render feedback for the move that produced position i
      if (i >= 1 && evalsWhite[i - 1] !== null && !feedbackDone.has(i)) {
        renderFeedback(i);
        feedbackDone.add(i);
      }
      i = evalsWhite.findIndex((v) => v === null);
    }
  } finally {
    pumping = false;
  }
}

function renderLiveSuggestion(i: number) {
  const { fen } = positions[i];
  const out = $('#engine-out-live');
  const c = new Chess(fen);
  if (c.isGameOver()) {
    board.setArrow(null);
    out.innerHTML = `<p class="hint">Game over.</p>`;
    return;
  }
  const uci = bestUciAt[i];
  if (!uci) { out.innerHTML = ''; return; }
  board.setArrow([uci.slice(0, 2), uci.slice(2, 4)]);
  const san = uciToSan(fen, uci);
  const stm = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  const stmWhite = fen.split(' ')[1] === 'w';
  out.innerHTML = `<div class="best-move">${stm} to move — engine suggests <b>${san ?? uci}</b>
    <span class="eval-chip">${fmtEval(evalsWhite[i]!, mateAt[i], stmWhite)}</span></div>`;
}

function classify(drop: number): { label: string; cls: string } {
  if (drop >= 30) return { label: 'Blunder ??', cls: 'neg' };
  if (drop >= 20) return { label: 'Mistake ?', cls: 'neg' };
  if (drop >= 10) return { label: 'Inaccuracy ?!', cls: 'mid' };
  if (drop <= 1.5) return { label: 'Best', cls: 'pos' };
  return { label: 'OK', cls: '' };
}

function renderFeedback(i: number) {
  const before = evalsWhite[i - 1]!;
  const after = evalsWhite[i]!;
  const { fen: fenAfter, lm } = positions[i];
  const moverWhite = fenAfter.split(' ')[1] === 'b'; // side to move now is opposite of mover
  const moverWinBefore = moverWhite ? winPct(before) : 100 - winPct(before);
  const moverWinAfter = moverWhite ? winPct(after) : 100 - winPct(after);
  const drop = moverWinBefore - moverWinAfter;
  const { label, cls } = classify(drop);
  const san = lm ? uciToSan(positions[i - 1].fen, lm) ?? lm : '?';
  const bestBefore = bestUciAt[i - 1];
  const bestSan = bestBefore ? uciToSan(positions[i - 1].fen, bestBefore) : null;
  const moveNo = parseInt(positions[i - 1].fen.split(' ')[5], 10);
  const feed = $('#move-feed');
  if (feed.querySelector('.hint')) feed.innerHTML = '';
  const showBest = drop >= 10 && bestSan && bestSan !== san;
  const row = document.createElement('div');
  row.className = 'feed-row';
  row.innerHTML = `<span class="feed-move">${moveNo}${moverWhite ? '.' : '…'} ${san}</span>
    <span class="feed-label ${cls}">${label}</span>
    <span class="feed-swing hint">${Math.round(moverWinBefore)}% → ${Math.round(moverWinAfter)}%</span>
    ${showBest ? `<span class="feed-best hint">best: ${bestSan}</span>` : ''}`;
  feed.prepend(row);
}

function handleLiveMessage(msg: any, status: HTMLElement) {
  if (msg.players) {
    playerWhite = msg.players?.white?.user?.name || msg.players?.white?.userId || msg.players?.white?.name || 'White';
    playerBlack = msg.players?.black?.user?.name || msg.players?.black?.userId || msg.players?.black?.name || 'Black';
    const wr = msg.players?.white?.rating ? ` (${msg.players.white.rating})` : '';
    const br = msg.players?.black?.rating ? ` (${msg.players.black.rating})` : '';
    $('#live-players').innerHTML = `<b>${playerWhite}</b>${wr} &nbsp;vs&nbsp; <b>${playerBlack}</b>${br}`;
    status.innerHTML = `Connected. Following live — feedback starts from the current position.`;
  }
  if (msg.fen) {
    const fen = msg.fen.split(' ').length >= 4 ? msg.fen : msg.fen + ' w - - 0 1';
    pushPosition(fen, msg.lm || msg.lastMove || null);
  }
}

/** Stream an ongoing game straight from the lichess public API (NDJSON) — no backend required. */
async function streamLichessGame(id: string, status: HTMLElement) {
  liveAbort = new AbortController();
  let res: Response;
  try {
    res = await fetch(`https://lichess.org/api/stream/game/${id}`, {
      headers: { Accept: 'application/x-ndjson' },
      signal: liveAbort.signal,
    });
  } catch (e) {
    status.innerHTML = `<span class="neg">Could not reach lichess. Check your connection and the game ID.</span>`;
    disconnect();
    return;
  }
  if (!res.ok || !res.body) {
    status.innerHTML = `<span class="neg">Lichess returned ${res.status} — game not found or not viewable.</span>`;
    disconnect();
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
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try { handleLiveMessage(JSON.parse(line), status); } catch { /* skip malformed line */ }
      }
    }
    status.innerHTML += ' <span class="hint">(stream ended)</span>';
  } catch (e) {
    if (!liveAbort?.signal.aborted) status.innerHTML = `<span class="neg">Connection lost.</span>`;
  } finally {
    disconnect();
  }
}

$('#connect-btn').addEventListener('click', () => {
  const id = parseGameId(($('#game-input') as HTMLInputElement).value);
  const status = $('#live-status');
  if (!id) { status.innerHTML = `<span class="neg">Enter a valid lichess game URL or 8-character ID.</span>`; return; }
  liveDepth = parseInt(($('#depth-live') as HTMLSelectElement).value, 10);
  disconnect();
  positions = []; evalsWhite = []; bestUciAt = []; mateAt = []; feedbackDone = new Set();
  $('#move-feed').innerHTML = `<p class="hint">Waiting for moves…</p>`;
  status.innerHTML = `Connecting to game <code>${id}</code>…`;
  ($('#connect-btn') as HTMLElement).hidden = true;
  ($('#disconnect-btn') as HTMLElement).hidden = false;
  void streamLichessGame(id, status);
});

function disconnect() {
  if (liveAbort) { liveAbort.abort(); liveAbort = null; }
  ($('#connect-btn') as HTMLElement).hidden = false;
  ($('#disconnect-btn') as HTMLElement).hidden = true;
}
$('#disconnect-btn').addEventListener('click', () => {
  disconnect();
  $('#live-status').innerHTML = 'Disconnected.';
});

// ======================================================================
// mode switching + init
// ======================================================================
document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    ($('#panel-position') as HTMLElement).hidden = mode !== 'position';
    ($('#panel-live') as HTMLElement).hidden = mode !== 'live';
    board.setArrow(null);
    board.setSelected(null);
    if (mode === 'position') refreshPosition();
  });
});

$('#flip-btn').addEventListener('click', () => board.flip());
posChess.load(START);
refreshPosition();
setEvalBar(20);
