import { Chess } from 'chess.js';
import type { Color } from './types';

export interface ParsedMove {
  san: string;
  uci: string;
  color: Color;
  moveNo: number;      // full-move number
  before: string;      // FEN before the move
  after: string;       // FEN after the move
  evalCp: number | null;   // from PGN [%eval] comment, white perspective, centipawns (mate mapped to ±10000-n)
  clockSec: number | null; // from [%clk] comment — clock of the mover after the move
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
  raw: string;
}

/** Split a file that may contain many games into individual PGN chunks. */
export function splitPgn(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const chunks = normalized.split(/\n(?=\[Event\s)/g);
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0 && /\[\w+\s/.test(c));
}

function parseHeaders(chunk: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const re = /^\[(\w+)\s+"([^"]*)"\]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) headers[m[1]] = m[2];
  return headers;
}

function evalToCp(evalStr: string): number | null {
  // "%eval 0.17" | "%eval #-3" | "%eval #5"
  const s = evalStr.trim();
  if (s.startsWith('#')) {
    const n = parseInt(s.slice(1), 10);
    if (isNaN(n)) return null;
    return n > 0 ? 10000 - n : -10000 - n;
  }
  const v = parseFloat(s);
  return isNaN(v) ? null : Math.round(v * 100);
}

function clkToSec(clkStr: string): number | null {
  // "0:02:58.1" or "1:30:00"
  const parts = clkStr.trim().split(':').map(parseFloat);
  if (parts.some(isNaN)) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec;
}

export function parseGame(chunk: string): ParsedGame | null {
  const headers = parseHeaders(chunk);
  const chess = new Chess();
  try {
    chess.loadPgn(chunk);
  } catch {
    return null;
  }
  const history = chess.history({ verbose: true });
  if (history.length === 0) return null;

  // Comments keyed by the FEN of the position *after* the commented move.
  const commentByFen = new Map<string, string>();
  try {
    for (const c of chess.getComments()) commentByFen.set(c.fen, c.comment);
  } catch {
    /* comments unavailable — fine */
  }

  const moves: ParsedMove[] = [];
  for (const h of history) {
    const comment = commentByFen.get(h.after) ?? '';
    const evalMatch = comment.match(/\[%eval\s+([^\]]+)\]/);
    const clkMatch = comment.match(/\[%clk\s+([^\]]+)\]/);
    const fenParts = h.before.split(' ');
    moves.push({
      san: h.san,
      uci: h.from + h.to + (h.promotion ?? ''),
      color: h.color as Color,
      moveNo: parseInt(fenParts[5], 10),
      before: h.before,
      after: h.after,
      evalCp: evalMatch ? evalToCp(evalMatch[1]) : null,
      clockSec: clkMatch ? clkToSec(clkMatch[1]) : null,
    });
  }
  return { headers, moves, raw: chunk };
}

/** Stable id for deduping across sessions: prefer the game URL, else a content hash. */
export function gameId(g: ParsedGame): string {
  const link = g.headers['Link'] || g.headers['Site'];
  if (link && /^https?:\/\//.test(link)) return link;
  const key = [
    g.headers['Date'] ?? '',
    g.headers['White'] ?? '',
    g.headers['Black'] ?? '',
    g.headers['Result'] ?? '',
    g.moves.map((m) => m.san).join(' '),
  ].join('|');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return 'hash:' + (h >>> 0).toString(36) + ':' + g.moves.length;
}

/** Bucket a TimeControl header into a class. */
export function timeClassOf(tc: string | undefined): string {
  if (!tc || tc === '-' || tc === '?') return 'Unknown';
  if (tc.includes('/')) return 'Daily';
  const [baseStr, incStr] = tc.split('+');
  const base = parseInt(baseStr, 10);
  const inc = incStr ? parseInt(incStr, 10) : 0;
  if (isNaN(base)) return 'Unknown';
  const estimate = base + 40 * (isNaN(inc) ? 0 : inc);
  if (estimate < 180) return 'Bullet';
  if (estimate < 480) return 'Blitz';
  if (estimate < 1500) return 'Rapid';
  return 'Classical';
}
