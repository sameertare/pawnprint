import { Chess } from 'chess.js';
import type { Engine } from './engine';
import type { ParsedGame } from './pgn';
import { gameId, timeClassOf } from './pgn';
import { identifyOpening } from './openings';
import type { Color, ErrCounts, GameRecord, Phase, Result, WorstMove } from './types';

export const WINNING_WINPCT = 70;
export const LOSING_WINPCT = 30;
const CAP = 1000; // clamp evals to ±10 pawns for win% math

/** Lichess win-percentage model (0..100, from white's perspective when cp is white-perspective). */
export function winPct(cp: number): number {
  const clamped = Math.max(-CAP, Math.min(CAP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Lichess per-move accuracy from win% before/after (mover's perspective). */
function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter);
  const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function classify(drop: number): 'blunder' | 'mistake' | 'inaccuracy' | null {
  if (drop >= 30) return 'blunder';
  if (drop >= 20) return 'mistake';
  if (drop >= 10) return 'inaccuracy';
  return null;
}

/** Count non-king, non-pawn pieces on the board (both sides). */
function majorsAndMinors(fen: string): number {
  const board = fen.split(' ')[0];
  let n = 0;
  for (const ch of board) if ('nbrqNBRQ'.includes(ch)) n++;
  return n;
}

/** Phase of the position *before* each ply. Lichess-style division on piece count. */
function phaseOfPly(fens: string[], plyIdx: number): Phase {
  const fen = fens[plyIdx];
  const mm = majorsAndMinors(fen);
  const moveNo = parseInt(fen.split(' ')[5], 10);
  if (mm <= 6) return 'endgame';
  if (mm <= 10 || moveNo > 12) return 'middlegame';
  return 'opening';
}

/** Human label for what kind of endgame was reached (at first endgame position). */
function endgameLabel(fen: string): string {
  const board = fen.split(' ')[0].toLowerCase();
  const has = (c: string) => board.includes(c);
  if (has('q')) return 'Queen endgame';
  if (has('r') && (has('b') || has('n'))) return 'Rook + minor piece endgame';
  if (has('r')) return 'Rook endgame';
  if (has('b') || has('n')) return 'Minor piece endgame';
  return 'Pawn endgame';
}

function emptyErr(): ErrCounts {
  return { inaccuracies: 0, mistakes: 0, blunders: 0 };
}

export interface AnalyzeOptions {
  username: string;
  depth: number;          // engine depth; 0 = no engine (PGN evals only)
  engine: Engine | null;
  onPosition?: () => void; // progress tick per evaluated position
}

/** How many engine evaluations analyzing this game will need (for progress bars). */
export function positionsNeeded(game: ParsedGame, useEngine: boolean): number {
  const hasPgnEvals = game.moves.filter((m) => m.evalCp !== null).length >= game.moves.length - 1;
  if (!useEngine || hasPgnEvals) return 0;
  return game.moves.length + 1;
}

export async function analyzeGame(game: ParsedGame, opts: AnalyzeOptions): Promise<GameRecord> {
  const h = game.headers;
  const userIsWhite =
    (h['White'] ?? '').toLowerCase() === opts.username.toLowerCase();
  const userColor: Color = userIsWhite ? 'w' : 'b';
  const resultRaw = h['Result'] ?? '*';
  let result: Result = 'draw';
  if (resultRaw === '1-0') result = userIsWhite ? 'win' : 'loss';
  else if (resultRaw === '0-1') result = userIsWhite ? 'loss' : 'win';

  const sans = game.moves.map((m) => m.san);
  const { eco, opening, family } = identifyOpening(h, sans);

  // FEN before each ply, plus the final position.
  const fens = game.moves.map((m) => m.before).concat(game.moves[game.moves.length - 1].after);

  // ---- Obtain an eval (white perspective, cp) for every position ----
  const hasPgnEvals = game.moves.filter((m) => m.evalCp !== null).length >= game.moves.length - 1;
  let evalSource: GameRecord['evalSource'] = 'none';
  let evals: (number | null)[] = new Array(fens.length).fill(null);
  let bestmoves: (string | null)[] = new Array(fens.length).fill(null);
  let mates: (number | null)[] = new Array(fens.length).fill(null); // side-to-move perspective

  const finalChess = new Chess(fens[fens.length - 1]);
  const finalMate = finalChess.isCheckmate();

  if (hasPgnEvals) {
    evalSource = 'pgn';
    evals[0] = 20; // nominal starting eval
    game.moves.forEach((m, i) => {
      evals[i + 1] = m.evalCp;
    });
    // fill occasional gaps by carrying the previous eval
    for (let i = 1; i < evals.length; i++) if (evals[i] === null) evals[i] = evals[i - 1];
    if (finalMate) evals[evals.length - 1] = fens[fens.length - 1].includes(' w ') ? -10000 : 10000;
  } else if (opts.engine && opts.depth > 0) {
    evalSource = 'engine';
    for (let i = 0; i < fens.length; i++) {
      const pos = new Chess(fens[i]);
      if (pos.isCheckmate()) {
        evals[i] = pos.turn() === 'w' ? -10000 : 10000;
      } else if (pos.isDraw() || pos.isStalemate()) {
        evals[i] = 0;
      } else {
        const r = await opts.engine.evaluate(fens[i], opts.depth);
        const whiteCp = pos.turn() === 'w' ? r.cp : -r.cp;
        evals[i] = whiteCp;
        bestmoves[i] = r.bestmove;
        mates[i] = r.mateIn;
      }
      opts.onPosition?.();
    }
  }

  const analyzed = evalSource !== 'none';

  // ---- Walk the user's moves and classify ----
  const errors: Record<Phase, ErrCounts> = {
    opening: emptyErr(),
    middlegame: emptyErr(),
    endgame: emptyErr(),
  };
  const accSums: Record<Phase, { sum: number; n: number }> = {
    opening: { sum: 0, n: 0 },
    middlegame: { sum: 0, n: 0 },
    endgame: { sum: 0, n: 0 },
  };
  const worstMoves: WorstMove[] = [];
  let missedWins = 0;
  let missedMates = 0;
  let missedTactics = 0;
  let firstErrorMove: number | null = null;
  let decisiveErrorMove: number | null = null;
  let decisiveErrorPhase: Phase | null = null;
  let bestWinPct = 0;
  let worstWinPct = 100;
  let timePressureBlunders = 0;
  let clockDataAvailable = false;
  let reachedEndgame = false;
  let endgameType: string | null = null;
  let userMoveCount = 0;

  for (let i = 0; i < game.moves.length; i++) {
    const mv = game.moves[i];
    const phase = phaseOfPly(fens, i);
    if (phase === 'endgame' && !reachedEndgame) {
      reachedEndgame = true;
      endgameType = endgameLabel(fens[i]);
    }
    if (mv.color !== userColor) continue;
    userMoveCount++;
    if (mv.clockSec !== null) clockDataAvailable = true;
    if (!analyzed) continue;

    const wBefore = winPct(evals[i]!);
    const wAfter = winPct(evals[i + 1]!);
    const userBefore = userColor === 'w' ? wBefore : 100 - wBefore;
    const userAfter = userColor === 'w' ? wAfter : 100 - wAfter;
    bestWinPct = Math.max(bestWinPct, userBefore, userAfter);
    worstWinPct = Math.min(worstWinPct, userBefore, userAfter);

    const drop = userBefore - userAfter;
    accSums[phase].sum += moveAccuracy(userBefore, userAfter);
    accSums[phase].n++;

    const kind = classify(drop);
    if (kind) {
      errors[phase][
        kind === 'blunder' ? 'blunders' : kind === 'mistake' ? 'mistakes' : 'inaccuracies'
      ]++;
      if (firstErrorMove === null) firstErrorMove = mv.moveNo;
      if (
        decisiveErrorMove === null &&
        (kind === 'blunder' || kind === 'mistake') &&
        userBefore >= 45 &&
        userAfter < 40
      ) {
        decisiveErrorMove = mv.moveNo;
        decisiveErrorPhase = phase;
      }
      if ((kind === 'blunder' || kind === 'mistake') && mv.clockSec !== null && mv.clockSec < 30) {
        timePressureBlunders++;
      }
    }

    // Missed wins / mates / tactics
    const mateForUser =
      mates[i] !== null &&
      ((fens[i].includes(' w ') && userColor === 'w') || (fens[i].includes(' b ') && userColor === 'b'))
        ? mates[i]!
        : null;
    let recorded: WorstMove['kind'] | null = null;
    if (mateForUser !== null && mateForUser > 0) {
      const stillMating = evals[i + 1]! !== null && Math.abs(evals[i + 1]!) > 9000 &&
        ((userColor === 'w' && evals[i + 1]! > 0) || (userColor === 'b' && evals[i + 1]! < 0));
      if (!stillMating) {
        missedMates++;
        recorded = 'missed mate';
      }
    }
    if (!recorded && userBefore >= WINNING_WINPCT && userAfter < 55) {
      missedWins++;
      recorded = 'missed win';
    }
    if (!recorded && kind === 'blunder') recorded = 'blunder';
    if (!recorded && kind === 'mistake' && drop >= 25) recorded = 'mistake';

    // Tactic detection: engine best was a capture or check gaining a lot, and the user played something else.
    let bestSan: string | undefined;
    if (bestmoves[i] && drop >= 15) {
      try {
        const pos = new Chess(fens[i]);
        const bm = bestmoves[i]!;
        const detail = pos.move({
          from: bm.slice(0, 2),
          to: bm.slice(2, 4),
          promotion: bm.length > 4 ? bm.slice(4) : undefined,
        });
        if (detail && bm !== mv.uci) {
          bestSan = detail.san;
          if (detail.captured || detail.san.includes('+') || detail.san.includes('#')) {
            missedTactics++;
          }
        }
      } catch { /* illegal parse — skip */ }
    }

    if (recorded) {
      worstMoves.push({
        moveNo: mv.moveNo,
        san: mv.san,
        phase,
        kind: recorded,
        winPctBefore: Math.round(userBefore),
        winPctAfter: Math.round(userAfter),
        best: bestSan,
      });
    }
  }

  worstMoves.sort((a, b) => (b.winPctBefore - b.winPctAfter) - (a.winPctBefore - a.winPctAfter));

  const accOf = (p: Phase) => (accSums[p].n > 0 ? accSums[p].sum / accSums[p].n : null);
  const allN = accSums.opening.n + accSums.middlegame.n + accSums.endgame.n;
  const overallAcc =
    allN > 0
      ? (accSums.opening.sum + accSums.middlegame.sum + accSums.endgame.sum) / allN
      : null;

  return {
    id: gameId(game),
    date: h['UTCDate'] || h['Date'] || '????.??.??',
    site: h['Link'] || h['Site'] || '',
    event: h['Event'] || '',
    white: h['White'] || '?',
    black: h['Black'] || '?',
    userColor,
    result,
    resultRaw,
    termination: h['Termination'] || '',
    eco,
    opening,
    family,
    timeControl: h['TimeControl'] || '?',
    timeClass: timeClassOf(h['TimeControl']),
    moveCount: userMoveCount,
    analyzed,
    evalSource,
    engineDepth: evalSource === 'engine' ? opts.depth : undefined,
    accuracy: {
      overall: overallAcc !== null ? Math.round(overallAcc * 10) / 10 : null,
      opening: accOf('opening') !== null ? Math.round(accOf('opening')! * 10) / 10 : null,
      middlegame: accOf('middlegame') !== null ? Math.round(accOf('middlegame')! * 10) / 10 : null,
      endgame: accOf('endgame') !== null ? Math.round(accOf('endgame')! * 10) / 10 : null,
    },
    errors,
    missedWins,
    missedMates,
    missedTactics,
    bestWinPct: Math.round(bestWinPct),
    worstWinPct: Math.round(worstWinPct),
    lostFromWinning: analyzed && result === 'loss' && bestWinPct >= WINNING_WINPCT,
    drewFromWinning: analyzed && result === 'draw' && bestWinPct >= WINNING_WINPCT,
    savedFromLosing: analyzed && result !== 'loss' && worstWinPct <= LOSING_WINPCT,
    decisiveErrorPhase,
    decisiveErrorMove,
    firstErrorMove,
    reachedEndgame,
    endgameType,
    clockDataAvailable,
    timePressureBlunders,
    worstMoves: worstMoves.slice(0, 3),
    evalGraph: analyzed ? evals.map((v) => Math.max(-1000, Math.min(1000, v ?? 0))) : null,
  };
}
