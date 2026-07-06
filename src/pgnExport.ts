import { Chess } from 'chess.js';
import type { GameRecord, WorstMove } from './types';

function headerLine(tag: string, value: string): string {
  return `[${tag} "${value.replace(/"/g, "'")}"]`;
}

/**
 * Rebuilds a standard PGN for one analyzed game, with the engine eval baked in as a lichess-style
 * `[%eval ...]` comment on every move (reconstructed from the stored eval graph) plus a short note
 * on any move flagged as an inaccuracy/mistake/blunder — viewable in any ordinary PGN reader
 * offline, no app required. Falls back to a header-only PGN if the game predates the `sans` field
 * (older saved reports).
 */
export function buildAnnotatedPgn(g: GameRecord): string {
  const headers = [
    headerLine('Event', g.event || '?'),
    headerLine('Site', g.site || '?'),
    headerLine('Date', g.date || '????.??.??'),
    headerLine('White', g.white),
    headerLine('Black', g.black),
    headerLine('Result', g.resultRaw || '*'),
  ];
  if (g.eco) headers.push(headerLine('ECO', g.eco));
  if (g.opening) headers.push(headerLine('Opening', g.opening));
  if (g.timeControl && g.timeControl !== '?') headers.push(headerLine('TimeControl', g.timeControl));
  if (g.engineDepth) headers.push(headerLine('Annotator', `PawnPrint (Stockfish 18, depth ${g.engineDepth})`));

  const sans = g.sans ?? [];
  if (!sans.length) {
    return `${headers.join('\n')}\n\n${g.resultRaw || '*'}\n`;
  }

  // Match each flagged worst-move to its ply index by (move number, SAN) — worstMoves only holds
  // the top few most significant errors per game, not every move.
  const worstByPly = new Map<number, WorstMove>();
  sans.forEach((san, i) => {
    const moveNo = Math.floor(i / 2) + 1;
    const wm = g.worstMoves.find((m) => m.moveNo === moveNo && m.san === san);
    if (wm) worstByPly.set(i, wm);
  });

  const evalComment = (ply: number): string => {
    const cp = g.evalGraph?.[ply + 1];
    return cp == null ? '' : ` { [%eval ${(cp / 100).toFixed(2)}] }`;
  };

  const tokens: string[] = [];
  sans.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${Math.floor(i / 2) + 1}.`);
    const wm = worstByPly.get(i);
    const note = wm ? ` { ${wm.kind}${wm.best ? ` — engine's best was ${wm.best}` : ''} }` : '';
    tokens.push(`${san}${evalComment(i)}${note}`);
  });
  tokens.push(g.resultRaw || '*');

  return `${headers.join('\n')}\n\n${tokens.join(' ')}\n`;
}

function uciToSan(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
    return mv ? mv.san : null;
  } catch {
    return null;
  }
}

export interface LinePosition {
  fen: string;
  san: string | null; // null for the start position
  lm: string | null;  // last move played to reach this position, in UCI ("e2e4"); null for the start position
}

/**
 * Builds an annotated PGN from Live & Engine's in-memory position line — the same [%eval] comment
 * convention as buildAnnotatedPgn, plus the engine's suggested best move (converted to SAN)
 * wherever it differs from the move actually played, since Live & Engine keeps that per-position
 * (not just for a handful of flagged moments).
 */
export function buildPgnFromLine(opts: {
  white?: string;
  black?: string;
  event?: string;
  result?: string;
  line: LinePosition[];
  evalsW: (number | null)[];
  bestU: (string | null)[];
}): string {
  const headers = [
    headerLine('Event', opts.event || 'PawnPrint Live & Engine'),
    headerLine('Site', '?'),
    headerLine('Date', '????.??.??'),
    headerLine('White', opts.white || '?'),
    headerLine('Black', opts.black || '?'),
    headerLine('Result', opts.result || '*'),
  ];

  if (opts.line.length < 2) return `${headers.join('\n')}\n\n${opts.result || '*'}\n`;

  const tokens: string[] = [];
  for (let i = 1; i < opts.line.length; i++) {
    const san = opts.line[i].san;
    if (!san) continue;
    const ply = i - 1; // 0-indexed ply of this move
    if (ply % 2 === 0) tokens.push(`${Math.floor(ply / 2) + 1}.`);
    const cp = opts.evalsW[i];
    const evalComment = cp == null ? '' : ` { [%eval ${(cp / 100).toFixed(2)}] }`;
    const bestUci = opts.bestU[ply];
    let bestComment = '';
    if (bestUci && bestUci !== opts.line[i].lm) {
      const bestSan = uciToSan(opts.line[ply].fen, bestUci);
      if (bestSan) bestComment = ` { engine's best: ${bestSan} }`;
    }
    tokens.push(`${san}${evalComment}${bestComment}`);
  }
  tokens.push(opts.result || '*');

  return `${headers.join('\n')}\n\n${tokens.join(' ')}\n`;
}

export function downloadPgn(filename: string, pgn: string) {
  const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
