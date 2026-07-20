import { Chess } from 'chess.js';
import type { Color } from './types';

export interface ParsedMove {
  san: string;
  uci: string;
  color: Color;
  moveNo: number;      // full-move number
  before: string;      // FEN before the move
  after: string;       // FEN after the move
  evalCp: number | null;   // from PGN [%eval] comment, white perspective, centipawns (mate mapped to plus/minus 10000-n)
  clockSec: number | null; // from [%clk] comment - clock of the mover after the move
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
  raw: string;
}

/** Why a chunk failed to become a game - surfaced in the UI so failures aren't a black box. */
export interface ParseFailure {
  reason: string;
  snippet: string; // first line of the offending chunk, for identification
}

const BOM_CODE = 0xfeff;

/**
 * Sanitizes text before it's handed to chess.js's strict PGN parser. Three real-world copy-paste
 * artifacts otherwise make it reject an otherwise-valid PGN outright with an opaque "Expected ...
 * but ... found" error the user just sees as "Could not parse that PGN": stray control characters
 * and a leading byte-order-mark (from a file decoded with the wrong text encoding); Unicode
 * whitespace variants — most commonly non-breaking space (U+00A0) — which show up constantly when
 * a move list (especially one with inline clock/eval annotations, which a lot of sites deliberately
 * pad with &nbsp; so a timestamp doesn't line-wrap) is copied straight out of a rendered webpage
 * rather than downloaded as a real PGN file; and curly "smart" quotes, which a word processor or
 * some sites' auto-formatting can substitute for the straight quotes a PGN tag pair's value must be
 * delimited by (`[White "Name"]`), silently breaking the header syntax itself.
 */
export function sanitizePgnText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (i === 0 && code === BOM_CODE) continue;
    const isPrintable = code >= 32 && code !== 127;
    const isAllowedWhitespace = code === 9 || code === 10 || code === 13; // tab, newline, CR
    if (isPrintable || isAllowedWhitespace) out += text[i];
  }
  return out
    // Unicode whitespace variants -> plain space (U+00A0 nbsp, U+1680 ogham space, U+2000-
    // U+200A the various en/em/thin/hair spaces, U+202F narrow no-break, U+205F medium math,
    // U+3000 ideographic, U+FEFF zero-width no-break appearing mid-string).
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g, ' ')
    .replace(/[\u2018\u2019\u201B]/g, "'") // curly single quotes -> straight
    .replace(/[\u201C\u201D\u201F]/g, '"'); // curly double quotes -> straight
}

/** Split a file that may contain many games into individual PGN chunks. */
export function splitPgn(text: string): string[] {
  const normalized = sanitizePgnText(text).replace(/\r\n?/g, '\n').trim();
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

function firstLine(chunk: string): string {
  return chunk.split('\n', 1)[0]?.slice(0, 120) ?? '';
}

/**
 * Some exporters (certain lichess tooling, third-party analysis tools) write eval and clock as
 * two separate back-to-back comment blocks, e.g. "{ [%eval 0.2] } { [%clk 0:03:00] }", instead of
 * one combined block. chess.js's PGN parser only accepts a single comment per move and throws on
 * the second "{". Since headers use square brackets exclusively, merging every "}...{" run into a
 * single space is safe across the whole chunk and collapses any number of adjacent blocks into one.
 */
function mergeAdjacentComments(chunk: string): string {
  return chunk.replace(/\}\s*\{/g, ' ');
}

/**
 * Parse one PGN chunk, reporting why on failure instead of silently dropping it.
 * `parseGame` (below) is the same thing without the diagnostic - kept for existing callers.
 */
export function tryParseGame(rawChunk: string): { game: ParsedGame | null; error?: ParseFailure } {
  const chunk = mergeAdjacentComments(rawChunk);
  const headers = parseHeaders(chunk);
  const chess = new Chess();
  try {
    chess.loadPgn(chunk);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { game: null, error: { reason, snippet: firstLine(rawChunk) } };
  }
  const history = chess.history({ verbose: true });
  if (history.length === 0) {
    return { game: null, error: { reason: 'No moves in this game (likely aborted before move 1)', snippet: firstLine(chunk) } };
  }

  // Comments keyed by the FEN of the position after the commented move.
  const commentByFen = new Map<string, string>();
  try {
    for (const c of chess.getComments()) commentByFen.set(c.fen, c.comment);
  } catch {
    /* comments unavailable - fine */
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
  return { game: { headers, moves, raw: rawChunk } };
}

export function parseGame(chunk: string): ParsedGame | null {
  return tryParseGame(chunk).game;
}

/** A viewable game URL, if the PGN's Link/Site header actually is one (chess.com and lichess both
 *  put it there; other sources often put a non-URL label like "Chess.com" in Site instead). */
export function gameLink(headers: Record<string, string>): string | null {
  const link = headers['Link'] || headers['Site'];
  return link && /^https?:\/\//.test(link) ? link : null;
}

/** Stable id for deduping across sessions: prefer the game URL, else a content hash. */
export function gameId(g: ParsedGame): string {
  const link = gameLink(g.headers);
  if (link) return link;
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
