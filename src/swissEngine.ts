/** A self-contained Swiss-system tournament engine: roster parsing, pairing, results, standings. */

export type Color = 'w' | 'b';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | null;

export interface Player {
  id: number;
  name: string;
  rating: number | null;
  score: number;
  opponents: number[];    // opponent ids per round played (byes recorded as -1)
  colors: Color[];        // colors received in order
  byes: number;           // forced (unpaired) full-point byes received
  requestedByes: number;  // requested half-point byes received
  byeRequests: number[];  // round numbers the player asked to sit out, from the roster import
  withdrawn: boolean;
}

export interface Pairing {
  board: number;
  whiteId: number | null;
  blackId: number | null;
  byeId: number | null;     // bye (requested or forced)
  byePoints?: 0.5 | 1;       // 0.5 = requested bye, 1 = forced (unpaired) bye — defaults to 1 if absent
  result: GameResult;        // null until entered; byes auto-scored
}

export interface Round {
  number: number;
  pairings: Pairing[];
  complete: boolean;
}

export interface Tournament {
  name: string;
  players: Player[];
  rounds: Round[];
  createdAt: string;
}

// ---------------- roster parsing ----------------
export interface RosterEntry {
  name: string;
  rating: number | null;
  section?: string;
  byeRounds?: number[]; // round numbers this player requested off, if the roster specified any
}

/** A rating token is valid only if it's a plausible chess rating (0/blank/unrated → absent). */
function ratingOrNull(v: string | undefined): number | null {
  const n = parseInt((v ?? '').trim(), 10);
  return !isNaN(n) && n >= 100 && n <= 3500 ? n : null;
}

/** Split one CSV line, honouring double-quoted fields (which may contain commas, e.g. byes "4,5"). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Detect a NWChess RosterTable.csv export (grouped header with NWSRS / USCF / FIDE columns). */
export function isNwchessRoster(text: string): boolean {
  const head = text.replace(/\r/g, '').split('\n').slice(0, 3).join(' ');
  return /\bNWSRS\b/i.test(head) && /\bUSCF\b/i.test(head) && /\bFIDE\b/i.test(head);
}

/**
 * NWChess roster: fixed 16-column layout —
 * 0 section · 1 last · 2 first · 3 grade · 4 school · 5 NWSRS · 6 NWSRS-id ·
 * 7 USCF · 8 USCF-id · 9 USCF-exp · 10 FIDE · 11 FIDE-id · 12 title · 13 exp · 14 byes · 15 status.
 * FIDE is ignored; the pairing rating is max(NWSRS, USCF). Column 15 ("Status") carries the
 * withdrawn/paid marker — NOT column 0, which is the section/division (e.g. "Open", "U1000") and
 * is never itself a withdrawal indicator.
 */
function parseNwchessRoster(text: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const c = parseCsvLine(raw).map((f) => f.trim());
    if (c.length < 8) continue;
    const section = c[0];
    const last = c[1];
    const first = c[2];
    const status = c[15] ?? '';
    if (!last || last.toLowerCase() === 'name' || first.toLowerCase() === 'first') continue; // header rows
    if (/withdr|^wd$|inactive|dropped/i.test(status) || /withdr/i.test(section)) continue; // not playing
    const nwsrs = ratingOrNull(c[5]);
    const uscf = ratingOrNull(c[7]);
    // FIDE (c[10]) intentionally ignored.
    const rated = [nwsrs, uscf].filter((x): x is number => x != null);
    const rating = rated.length ? Math.max(...rated) : null;
    const name = `${first} ${last}`.replace(/\s{2,}/g, ' ').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const byeRounds = parseByeRounds(c[14]); // "Byes" column, e.g. "4,5"
    out.push({ name, rating, section: section || undefined, ...(byeRounds.length ? { byeRounds } : {}) });
  }
  return out;
}

function splitDelimited(line: string, kind: 'tab' | 'csv' | 'space'): string[] {
  if (kind === 'tab') return line.split('\t');
  if (kind === 'csv') return parseCsvLine(line);
  return line.split(/\s{2,}/);
}

/**
 * Extract a bye-round request from whatever trails the rating on a wallchart line
 * (e.g. "3", "4,5", "R4"). Returns the requested round numbers, or [] if none.
 */
function parseByeRounds(trailing: string | undefined): number[] {
  if (!trailing) return [];
  return [...trailing.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10)).filter((n) => n > 0 && n < 50);
}

/**
 * Fallback for a wallchart row where columns collapsed to single spaces (very common when a
 * table is pasted from a web page and its internal whitespace gets normalized). Matches
 * "<rank> <name …> [<id 5-10 digits>] <rating 2-4 digits> [<bye rounds>]" — the non-greedy
 * name group naturally stops right before the numeric ID/rating tokens regardless of how many
 * words the name has or how many spaces separate columns.
 */
function parseWallchartLine(line: string): { name: string; rating: number | null; byeRounds: number[] } | null {
  let m = line.match(/^\s*\d+[.)]?\s+(.+?)\s+\d{5,10}\s+(\d{2,4})\b\s*(.*)$/);
  if (!m) m = line.match(/^\s*\d+[.)]?\s+(.+?)\s+(\d{2,4})\s*(.*)$/); // no ID column
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  const rating = ratingOrNull(m[2]);
  return { name, rating, byeRounds: parseByeRounds(m[3]) };
}

/**
 * A delimited roster with a header row that labels the columns — e.g. a US Chess wallchart
 * (`#`, `Name`, `US Chess ID`, `Rating`, `Bye Rds`). Maps the Name and Rating columns by their
 * header labels and ignores ID / rank / bye columns. Returns null if there's no such header.
 */
function parseHeaderTable(text: string): RosterEntry[] | null {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = lines[0];
  const kind: 'tab' | 'csv' | 'space' = header.includes('\t') ? 'tab' : header.includes(',') ? 'csv' : 'space';

  if (kind !== 'space') {
    const cols = splitDelimited(header, kind).map((c) => c.trim().toLowerCase());
    const nameIdx = cols.findIndex((c) => c === 'name' || c === 'player' || c === 'player name' || c === 'full name');
    // rating column, but never an ID column ("US Chess ID", "USCF ID", …)
    const ratingIdx = cols.findIndex((c) => /^(rating|rtg|elo|uscf|reg)/.test(c) && !/\bid\b/.test(c));
    if (nameIdx !== -1 && ratingIdx !== -1) {
      const byeIdx = cols.findIndex((c) => /^bye/.test(c));
      const out: RosterEntry[] = [];
      const seen = new Set<string>();
      for (let i = 1; i < lines.length; i++) {
        const f = splitDelimited(lines[i], kind).map((c) => c.trim());
        const name = (f[nameIdx] ?? '').replace(/\s{2,}/g, ' ').trim();
        if (!name || name.toLowerCase() === 'name') continue;
        const rating = ratingOrNull(f[ratingIdx]);
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const byeRounds = byeIdx !== -1 ? parseByeRounds(f[byeIdx]) : [];
        out.push({ name, rating, ...(byeRounds.length ? { byeRounds } : {}) });
      }
      if (out.length) return out;
    }
  }

  // Single-space (or unlabeled-column) wallchart: parse row-by-row with the pattern matcher.
  // The header line naturally fails to match (it doesn't start with a rank number) and is skipped.
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const row = parseWallchartLine(line);
    if (!row) continue;
    const key = row.name.toLowerCase();
    if (key === 'name' || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: row.name, rating: row.rating, ...(row.byeRounds.length ? { byeRounds: row.byeRounds } : {}) });
  }
  return out.length ? out : null;
}

/** Free-form list: one player per line, e.g. "Name", "Name Rating", "Name, Rating", "1. Name Rating". */
function parsePlainList(text: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  for (let raw of text.replace(/\r/g, '').split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    if ((/^(name|player|rank)\b/i.test(line) || /^#/.test(line)) && /rating|elo|\bid\b/i.test(line)) continue; // header row
    line = line.replace(/^\s*\d+\s*[.)-]\s*/, ''); // strip "1." / "1)" / "1-"
    // find a rating-like trailing number
    let rating: number | null = null;
    const numMatches = [...line.matchAll(/(\d{3,4})/g)];
    if (numMatches.length) {
      const last = numMatches[numMatches.length - 1];
      const val = parseInt(last[1], 10);
      if (val >= 100 && val <= 3500) {
        rating = val;
        line = (line.slice(0, last.index) + line.slice(last.index! + last[1].length));
      }
    }
    const name = line.replace(/[,;|\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/[,\s]+$/, '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, rating });
  }
  return out;
}

export type RosterFormat = 'auto' | 'nwchess' | 'table' | 'plain';

export function parseRoster(text: string, format: RosterFormat = 'auto'): RosterEntry[] {
  switch (format) {
    case 'nwchess': return parseNwchessRoster(text);
    case 'table': return parseHeaderTable(text) ?? [];
    case 'plain': return parsePlainList(text);
    default:
      if (isNwchessRoster(text)) return parseNwchessRoster(text);
      return parseHeaderTable(text) ?? parsePlainList(text);
  }
}

export function createTournament(name: string, roster: RosterEntry[]): Tournament {
  return {
    name: name || 'Swiss Tournament',
    createdAt: new Date().toISOString(),
    players: roster.map((r, i) => ({
      id: i + 1,
      name: r.name,
      rating: r.rating,
      score: 0,
      opponents: [],
      colors: [],
      byes: 0,
      requestedByes: 0,
      byeRequests: r.byeRounds ?? [],
      withdrawn: false,
    })),
    rounds: [],
  };
}

// ---------------- pairing ----------------
function colorBalance(p: Player): number {
  return p.colors.filter((c) => c === 'w').length - p.colors.filter((c) => c === 'b').length;
}
function lastColor(p: Player): Color | null {
  return p.colors.length ? p.colors[p.colors.length - 1] : null;
}

/** Decide who gets white in a pairing between a (higher seed) and b. */
function assignColors(a: Player, b: Player): { whiteId: number; blackId: number } {
  const balA = colorBalance(a);
  const balB = colorBalance(b);
  let aWhite: boolean;
  if (balA !== balB) {
    aWhite = balA < balB; // the one owed white (more negative balance) gets white
  } else {
    const la = lastColor(a), lb = lastColor(b);
    if (la !== lb && (la === 'b' || lb === 'w')) aWhite = la === 'b';
    else if (la !== lb) aWhite = lb === 'w';
    else aWhite = a.id < b.id; // fallback: higher seed white
  }
  return aWhite ? { whiteId: a.id, blackId: b.id } : { whiteId: b.id, blackId: a.id };
}

/**
 * Dutch-style "fold" pairing of one even-sized bracket (sorted by score desc, rating desc):
 * split into top half S1 and bottom half S2, then pair S1[i] with S2[i] (i.e. 1v(h+1), 2v(h+2)…),
 * permuting S2 by backtracking only as needed to avoid rematches.
 */
function foldPair(bracket: Player[], allowRematch: boolean): [Player, Player][] | null {
  const n = bracket.length;
  if (n === 0) return [];
  if (n % 2 === 1) return null;
  const half = n / 2;
  const S1 = bracket.slice(0, half);
  const S2 = bracket.slice(half);

  const bt = (i: number, used: boolean[]): [Player, Player][] | null => {
    if (i === half) return [];
    const a = S1[i];
    // Prefer the natural fold partner S2[i] first, then nearest alternatives outward.
    const order = [i, ...S2.map((_, j) => j).filter((j) => j !== i)];
    for (const j of order) {
      if (used[j]) continue;
      const b = S2[j];
      if (!allowRematch && a.opponents.includes(b.id)) continue;
      used[j] = true;
      const sub = bt(i + 1, used);
      if (sub !== null) return [[a, b], ...sub];
      used[j] = false;
    }
    return null;
  };
  return bt(0, new Array(half).fill(false));
}

/**
 * General bracket pairing with full backtracking, biased toward the Dutch fold: the top player
 * prefers the player at the top of the bottom half. Finds a rematch-free pairing whenever one
 * exists (unlike foldPair, which only permutes the bottom half).
 */
function generalPair(pool: Player[], allowRematch: boolean): [Player, Player][] | null {
  if (pool.length === 0) return [];
  const a = pool[0];
  const rest = pool.slice(1);
  const preferIdx = Math.floor(pool.length / 2) - 1; // index in `rest` of the natural fold partner
  // Prefer opponents on the same score first (score-group integrity), then the fold partner.
  const order = rest
    .map((_, i) => i)
    .sort((i, j) => {
      const si = Math.abs(rest[i].score - a.score);
      const sj = Math.abs(rest[j].score - a.score);
      if (si !== sj) return si - sj;
      return Math.abs(i - preferIdx) - Math.abs(j - preferIdx) || i - j;
    });
  for (const i of order) {
    const b = rest[i];
    if (!allowRematch && a.opponents.includes(b.id)) continue;
    const sub = generalPair(rest.filter((_, idx) => idx !== i), allowRematch);
    if (sub !== null) return [[a, b], ...sub];
  }
  return null;
}

/** Best even-bracket pairing: textbook fold first, then any rematch-free pairing, then relax. */
function pairEven(pool: Player[]): [Player, Player][] {
  return (
    foldPair(pool, false) ??
    generalPair(pool, false) ??
    foldPair(pool, true) ??
    generalPair(pool, true) ??
    []
  );
}

/** Pair a score bracket (possibly odd → one player down-floats). Returns pairs + the floater. */
function pairBracket(pool: Player[]): { pairs: [Player, Player][]; floater: Player | null } {
  if (pool.length % 2 === 0) return { pairs: pairEven(pool), floater: null };
  // Odd: float one player down. Try floating from the lowest upward until the rest pair cleanly.
  for (const relax of [false, true]) {
    for (let k = pool.length - 1; k >= 0; k--) {
      const rest = pool.filter((_, idx) => idx !== k);
      const pairs = relax ? generalPair(rest, true) : (foldPair(rest, false) ?? generalPair(rest, false));
      if (pairs) return { pairs, floater: pool[k] };
    }
  }
  return { pairs: [], floater: pool[pool.length - 1] };
}

export function pairNextRound(t: Tournament): Round {
  const nextRoundNo = t.rounds.length + 1;
  const active = t.players.filter((p) => !p.withdrawn);

  // Honour requested byes for this specific round — those players sit out with a half-point,
  // and everyone else is paired as usual.
  const requestedOut = active.filter((p) => (p.byeRequests ?? []).includes(nextRoundNo));
  const requestedOutIds = new Set(requestedOut.map((p) => p.id));
  const eligible = active.filter((p) => !requestedOutIds.has(p.id));

  const bySeed = (x: Player, y: Player) =>
    y.score - x.score || (y.rating ?? 0) - (x.rating ?? 0) || x.id - y.id;
  const sorted = [...eligible].sort(bySeed);

  let byePlayer: Player | null = null;
  let pool = sorted;
  if (sorted.length % 2 === 1) {
    // bye to the lowest-standing player who has had the fewest byes
    const candidates = [...sorted].sort(
      (x, y) => (x.byes ?? 0) - (y.byes ?? 0) || x.score - y.score || (x.rating ?? 0) - (y.rating ?? 0)
    );
    byePlayer = candidates[0];
    pool = sorted.filter((p) => p.id !== byePlayer!.id);
  }

  // Process score brackets from the top, down-floating odd players into the next bracket.
  // This favours score-integrity (players meet others on the same score).
  const scores = [...new Set(pool.map((p) => p.score))].sort((a, b) => b - a);
  let pairs: [Player, Player][] = [];
  let floaters: Player[] = [];
  for (const sc of scores) {
    const bracket = [...floaters, ...pool.filter((p) => p.score === sc)].sort(bySeed);
    const { pairs: bp, floater } = pairBracket(bracket);
    pairs.push(...bp);
    floaters = floater ? [floater] : [];
  }
  if (floaters.length) {
    const extra = foldPair(floaters.sort(bySeed), true);
    if (extra) pairs.push(...extra);
  }

  // If the bracket method produced any rematch, prefer a globally rematch-free pairing when one
  // exists (exhaustive fold-biased backtracking over the whole field).
  const rematches = (ps: [Player, Player][]) =>
    ps.filter(([a, b]) => a.opponents.includes(b.id)).length;
  if (rematches(pairs) > 0) {
    const global = generalPair(pool, false);
    if (global && rematches(global) === 0) pairs = global;
  }

  const pairings: Pairing[] = pairs.map(([a, b], i) => {
    const { whiteId, blackId } = assignColors(a, b);
    return { board: i + 1, whiteId, blackId, byeId: null, result: null };
  });
  for (const p of requestedOut) {
    pairings.push({ board: pairings.length + 1, whiteId: null, blackId: null, byeId: p.id, byePoints: 0.5, result: null });
  }
  if (byePlayer) {
    pairings.push({ board: pairings.length + 1, whiteId: null, blackId: null, byeId: byePlayer.id, byePoints: 1, result: null });
  }

  const round: Round = { number: nextRoundNo, pairings, complete: false };
  return round;
}

/** Apply a freshly created round (records opponents/colors; auto-scores byes). */
export function commitRound(t: Tournament, round: Round) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  for (const pr of round.pairings) {
    if (pr.byeId != null) {
      const p = byId.get(pr.byeId)!;
      const points = pr.byePoints ?? 1;
      p.opponents.push(-1);
      if (points === 0.5) p.requestedByes = (p.requestedByes ?? 0) + 1;
      else p.byes = (p.byes ?? 0) + 1;
      p.score += points;
    } else {
      const w = byId.get(pr.whiteId!)!;
      const b = byId.get(pr.blackId!)!;
      w.opponents.push(b.id); w.colors.push('w');
      b.opponents.push(w.id); b.colors.push('b');
    }
  }
  t.rounds.push(round);
}

/** Enter/replace a game result and keep scores consistent. */
export function setResult(t: Tournament, roundNo: number, board: number, result: GameResult) {
  const round = t.rounds.find((r) => r.number === roundNo);
  if (!round) return;
  const pr = round.pairings.find((p) => p.board === board);
  if (!pr || pr.byeId != null) return;
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const w = byId.get(pr.whiteId!)!;
  const b = byId.get(pr.blackId!)!;
  // undo previous
  if (pr.result === '1-0') w.score -= 1;
  else if (pr.result === '0-1') b.score -= 1;
  else if (pr.result === '1/2-1/2') { w.score -= 0.5; b.score -= 0.5; }
  // apply new
  if (result === '1-0') w.score += 1;
  else if (result === '0-1') b.score += 1;
  else if (result === '1/2-1/2') { w.score += 0.5; b.score += 0.5; }
  pr.result = result;
  round.complete = round.pairings.every((p) => p.byeId != null || p.result != null);
}

// ---------------- standings & tiebreaks ----------------
export interface Standing {
  rank: number;
  player: Player;
  score: number;
  buchholz: number;       // sum of opponents' scores
  sonnebornBerger: number;
  wins: number;
  draws: number;
  losses: number;
  colorBalance: number;
}

export function standings(t: Tournament): Standing[] {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const rows: Omit<Standing, 'rank'>[] = t.players.map((p) => {
    let buchholz = 0;
    let sb = 0;
    let wins = 0, draws = 0, losses = 0;
    p.opponents.forEach((oppId, idx) => {
      if (oppId === -1) { wins += 0; return; } // bye: not counted as win/draw/loss here
      const opp = byId.get(oppId)!;
      buchholz += opp.score;
      const myColor = p.colors[idx];
      // find the game result
      const round = t.rounds[idx];
      const pr = round?.pairings.find(
        (x) => (x.whiteId === p.id && x.blackId === oppId) || (x.blackId === p.id && x.whiteId === oppId)
      );
      if (pr && pr.result) {
        const iWon = (myColor === 'w' && pr.result === '1-0') || (myColor === 'b' && pr.result === '0-1');
        const iLost = (myColor === 'w' && pr.result === '0-1') || (myColor === 'b' && pr.result === '1-0');
        if (pr.result === '1/2-1/2') { draws++; sb += opp.score * 0.5; }
        else if (iWon) { wins++; sb += opp.score; }
        else if (iLost) { losses++; }
      }
    });
    // forced (full-point) byes read as wins; requested (half-point) byes read as draws
    wins += p.byes ?? 0;
    draws += p.requestedByes ?? 0;
    return {
      player: p,
      score: p.score,
      buchholz: Math.round(buchholz * 10) / 10,
      sonnebornBerger: Math.round(sb * 10) / 10,
      wins, draws, losses,
      colorBalance: colorBalance(p),
    };
  });
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.buchholz - a.buchholz ||
      b.sonnebornBerger - a.sonnebornBerger ||
      (b.player.rating ?? 0) - (a.player.rating ?? 0)
  );
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

/** Recommended number of rounds for n players (smallest r with 2^r >= n), min 3, capped 9. */
export function recommendedRounds(n: number): number {
  if (n < 2) return 0;
  let r = Math.ceil(Math.log2(n));
  return Math.max(3, Math.min(9, r));
}
