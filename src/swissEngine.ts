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
  isHouse?: boolean;      // a one-off fill-in added to play a bye recipient; excluded from standings & future pairing
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

export interface FamilyGroup {
  id: number;
  label: string;
  playerIds: number[];
}

export interface Tournament {
  name: string;
  players: Player[];
  rounds: Round[];
  createdAt: string;
  totalRounds: number; // TD-chosen (or auto-recommended) round count for this event
  familyGroups: FamilyGroup[]; // players who shouldn't face each other when avoidable (siblings, etc.)
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
    // Only dedupe an exact name+rating repeat — see parsePlainList for why name alone isn't enough.
    const key = `${name.toLowerCase()} ${rating ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const byeRounds = parseByeRounds(c[14]); // "Byes" column, e.g. "4,5"
    out.push({ name, rating, section: section || undefined, ...(byeRounds.length ? { byeRounds } : {}) });
  }
  return out;
}

function splitDelimited(line: string, kind: 'tab' | 'csv' | 'space'): string[] {
  if (kind === 'tab') {
    if (line.includes('\t')) return line.split('\t');
    // This one row lost its tabs — e.g. hand-typed or re-aligned with spaces instead of pasted
    // from a spreadsheet like the rest of the file. Falling back to splitting on runs of 2+
    // spaces (when present) keeps the row from silently vanishing just because it doesn't match
    // the delimiter the header happened to use.
    if (/\s{2,}/.test(line)) return line.split(/\s{2,}/);
    return [line];
  }
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
        // Only dedupe an exact name+rating repeat (e.g. the same row pasted twice) — two real
        // players can legitimately share a name, and silently dropping one is worse than
        // occasionally letting a true accidental duplicate through.
        const key = `${name.toLowerCase()} ${rating ?? ''}`;
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
    const key = `${row.name.toLowerCase()} ${row.rating ?? ''}`;
    if (row.name.toLowerCase() === 'name' || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: row.name, rating: row.rating, ...(row.byeRounds.length ? { byeRounds: row.byeRounds } : {}) });
  }
  return out.length ? out : null;
}

/** Free-form list: one player per line, e.g. "Name", "Name Rating", "Name, Rating", "1. Name Rating". */
function parsePlainList(text: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  // Guard against two entries ending up on one line — e.g. a newline lost while typing a new
  // player onto the end of the roster, or pasting text that collapsed line breaks. A numbered
  // marker ("12. " / "12) ") appearing mid-line, not just at the very start, is a strong signal
  // that a second entry is glued onto the first — split it back into its own line so it doesn't
  // silently get swallowed into the previous player's name/rating.
  const normalized = text.replace(/([^\n])\s+(\d{1,3}[.)]\s)/g, '$1\n$2');
  for (let raw of normalized.replace(/\r/g, '').split('\n')) {
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
    // Only treat this as an accidental duplicate (e.g. the same roster pasted twice into an
    // already-filled textarea) when BOTH the name and rating match exactly — two real players can
    // legitimately share a name, and silently dropping one with no feedback just makes them
    // disappear from the roster with no explanation.
    const key = `${name.toLowerCase()} ${rating ?? ''}`;
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

export function createTournament(name: string, roster: RosterEntry[], totalRounds?: number): Tournament {
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
    totalRounds: totalRounds && totalRounds > 0 ? totalRounds : recommendedRounds(roster.length),
    familyGroups: [],
  };
}

/** Marks 2+ players as related (siblings, parent/child, spouses, …) so the pairing engine avoids
 *  matching them against each other when an alternative pairing exists — the same soft-preference
 *  treatment already given to rematches. Returns the new group's id, or null if fewer than 2 valid
 *  player ids were given. */
export function addFamilyGroup(t: Tournament, label: string, playerIds: number[]): number | null {
  const valid = [...new Set(playerIds)].filter((id) => t.players.some((p) => p.id === id));
  if (valid.length < 2) return null;
  const id = Math.max(0, ...t.familyGroups.map((g) => g.id)) + 1;
  t.familyGroups.push({ id, label: label.trim() || `Group ${id}`, playerIds: valid });
  return id;
}

export function removeFamilyGroup(t: Tournament, groupId: number): void {
  t.familyGroups = t.familyGroups.filter((g) => g.id !== groupId);
}

function sameFamilyGroup(t: Tournament, aId: number, bId: number): boolean {
  return t.familyGroups.some((g) => g.playerIds.includes(aId) && g.playerIds.includes(bId));
}

// ---------------- pairing ----------------
function colorBalance(p: Player): number {
  return p.colors.filter((c) => c === 'w').length - p.colors.filter((c) => c === 'b').length;
}
function lastColor(p: Player): Color | null {
  return p.colors.length ? p.colors[p.colors.length - 1] : null;
}

type ColorPreference = { color: Color; strength: 1 | 2 | 3; label: 'alternation' | 'equalization' | 'consecutive-colors' } | null;

/**
 * Color due: a third consecutive color or a +/-2 imbalance is strongest;
 * a one-color imbalance is next; alternation is the lightest preference. Byes have no color
 * because they never enter `colors`.
 */
function colorPreference(p: Player): ColorPreference {
  const balance = colorBalance(p);
  const lastTwo = p.colors.slice(-2);
  if (lastTwo.length === 2 && lastTwo[0] === lastTwo[1]) {
    return { color: lastTwo[1] === 'w' ? 'b' : 'w', strength: 3, label: 'consecutive-colors' };
  }
  if (balance <= -2) return { color: 'w', strength: 3, label: 'equalization' };
  if (balance >= 2) return { color: 'b', strength: 3, label: 'equalization' };
  if (balance < 0) return { color: 'w', strength: 2, label: 'equalization' };
  if (balance > 0) return { color: 'b', strength: 2, label: 'equalization' };
  const last = lastColor(p);
  return last ? { color: last === 'w' ? 'b' : 'w', strength: 1, label: 'alternation' } : null;
}

/** Decide who gets white in a pairing between a (higher seed) and b. */
function assignColors(a: Player, b: Player): { whiteId: number; blackId: number } {
  const pa = colorPreference(a);
  const pb = colorPreference(b);
  const score = (aColor: Color, bColor: Color) =>
    (pa?.color === aColor ? pa.strength : 0) + (pb?.color === bColor ? pb.strength : 0);
  const aWhiteScore = score('w', 'b');
  const bWhiteScore = score('b', 'w');
  // In a true tie, the higher-seeded player (the first player in a bracket pair) wins the
  // preference, using a deterministic last-resort instead of a random coin flip.
  const aWhite = aWhiteScore === bWhiteScore ? a.id < b.id : aWhiteScore > bWhiteScore;
  return aWhite ? { whiteId: a.id, blackId: b.id } : { whiteId: b.id, blackId: a.id };
}

/**
 * Dutch-style "fold" pairing of one even-sized bracket (sorted by score desc, rating desc):
 * split into top half S1 and bottom half S2, then pair S1[i] with S2[i] (i.e. 1v(h+1), 2v(h+2)…),
 * permuting S2 by backtracking only as needed to avoid rematches.
 */
function foldPair(bracket: Player[], allowRematch: boolean, isFamilyConflict: (a: Player, b: Player) => boolean): [Player, Player][] | null {
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
      if (!allowRematch && (a.opponents.includes(b.id) || isFamilyConflict(a, b))) continue;
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
 * prefers the player at the top of the bottom half. Finds a rematch-free (and family-conflict-free)
 * pairing whenever one exists (unlike foldPair, which only permutes the bottom half).
 */
function generalPair(pool: Player[], allowRematch: boolean, isFamilyConflict: (a: Player, b: Player) => boolean): [Player, Player][] | null {
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
    if (!allowRematch && (a.opponents.includes(b.id) || isFamilyConflict(a, b))) continue;
    const sub = generalPair(rest.filter((_, idx) => idx !== i), allowRematch, isFamilyConflict);
    if (sub !== null) return [[a, b], ...sub];
  }
  return null;
}

/** Best even-bracket pairing: textbook fold first, then any rematch/family-conflict-free pairing, then relax. */
function pairEven(pool: Player[], isFamilyConflict: (a: Player, b: Player) => boolean): [Player, Player][] {
  return (
    foldPair(pool, false, isFamilyConflict) ??
    generalPair(pool, false, isFamilyConflict) ??
    foldPair(pool, true, isFamilyConflict) ??
    generalPair(pool, true, isFamilyConflict) ??
    []
  );
}

/** Pair a score bracket (possibly odd → one player down-floats). Returns pairs + the floater. */
function pairBracket(pool: Player[], isFamilyConflict: (a: Player, b: Player) => boolean): { pairs: [Player, Player][]; floater: Player | null } {
  if (pool.length % 2 === 0) return { pairs: pairEven(pool, isFamilyConflict), floater: null };
  // Odd: float one player down. Try floating from the lowest upward until the rest pair cleanly.
  for (const relax of [false, true]) {
    for (let k = pool.length - 1; k >= 0; k--) {
      const rest = pool.filter((_, idx) => idx !== k);
      const pairs = relax
        ? generalPair(rest, true, isFamilyConflict)
        : (foldPair(rest, false, isFamilyConflict) ?? generalPair(rest, false, isFamilyConflict));
      if (pairs) return { pairs, floater: pool[k] };
    }
  }
  return { pairs: [], floater: pool[pool.length - 1] };
}

/** The earliest round number that hasn't been paired yet — the only rounds a bye request can
 *  still affect, since pairNextRound() only ever reads byeRequests for the round it's about to
 *  create. */
export function nextRoundNumber(t: Tournament): number {
  return t.rounds.length + 1;
}

function scoreBeforeRound(t: Tournament, playerId: number, roundNo: number): number {
  let score = 0;
  for (let r = 1; r < roundNo; r++) {
    const round = t.rounds[r - 1];
    if (!round) break;
    const pr = round.pairings.find((p) => p.byeId === playerId || p.whiteId === playerId || p.blackId === playerId);
    if (!pr) continue;
    if (pr.byeId === playerId) { score += pr.byePoints ?? 1; continue; }
    const isWhite = pr.whiteId === playerId;
    if (pr.result === '1-0') score += isWhite ? 1 : 0;
    else if (pr.result === '0-1') score += isWhite ? 0 : 1;
    else if (pr.result === '1/2-1/2') score += 0.5;
  }
  return Math.round(score * 10) / 10;
}

/** Colors actually played in real games before `roundNo`, read from the round pairings directly
 *  rather than trusting player.colors (which byes don't push to, so it can drift out of
 *  round-index alignment for a player who's had one). */
function colorHistoryBeforeRound(t: Tournament, playerId: number, roundNo: number): Color[] {
  const hist: Color[] = [];
  for (let r = 1; r < roundNo; r++) {
    const round = t.rounds[r - 1];
    if (!round) break;
    const pr = round.pairings.find((p) => p.whiteId === playerId || p.blackId === playerId);
    if (pr) hist.push(pr.whiteId === playerId ? 'w' : 'b');
  }
  return hist;
}

function priorMeetingRound(t: Tournament, aId: number, bId: number, beforeRound: number): number | null {
  for (let r = 1; r < beforeRound; r++) {
    const round = t.rounds[r - 1];
    if (!round) break;
    const pr = round.pairings.find(
      (p) => p.byeId == null && ((p.whiteId === aId && p.blackId === bId) || (p.whiteId === bId && p.blackId === aId))
    );
    if (pr) return r;
  }
  return null;
}

/**
 * Human-readable reasons a board (or bye) was paired the way it was — score-group membership,
 * color-balance history, and rematch status. Reconstructed after the fact from the tournament's
 * round history rather than the pairing algorithm's internal trace, so it states the objective
 * facts of the match-up rather than every
 * tiebreak the algorithm weighed internally. Works for any round, not just the latest.
 */
export function explainPairing(t: Tournament, roundNo: number, board: number): string[] {
  const round = t.rounds[roundNo - 1];
  if (!round) return [];
  const pr = round.pairings.find((p) => p.board === board);
  if (!pr) return [];
  const byId = new Map(t.players.map((p) => [p.id, p]));

  if (pr.byeId != null) {
    const p = byId.get(pr.byeId);
    if (!p) return [];
    const score = scoreBeforeRound(t, p.id, roundNo);
    const requested = (pr.byePoints ?? 1) === 0.5;
    return [
      requested
        ? `${p.name} requested to sit out Round ${roundNo} and received a half-point bye.`
        : `${p.name} received the round's bye — the lowest-standing player (by score, then rating) who hadn't already had one, needed because the field was odd.`,
      `Entered the round with ${score} point(s).`,
    ];
  }

  const w = byId.get(pr.whiteId!);
  const b = byId.get(pr.blackId!);
  if (!w || !b) return [];
  const wScore = scoreBeforeRound(t, w.id, roundNo);
  const bScore = scoreBeforeRound(t, b.id, roundNo);
  const wHist = colorHistoryBeforeRound(t, w.id, roundNo);
  const bHist = colorHistoryBeforeRound(t, b.id, roundNo);
  const summarize = (h: Color[]) => (h.length ? `${h.filter((c) => c === 'w').length}W-${h.filter((c) => c === 'b').length}B` : 'none yet');
  const priorRound = priorMeetingRound(t, w.id, b.id, roundNo);
  const balance = (h: Color[]) => h.filter((c) => c === 'w').length - h.filter((c) => c === 'b').length;
  const due = (h: Color[]) => {
    const bal = balance(h);
    const lastTwo = h.slice(-2);
    if (lastTwo.length === 2 && lastTwo[0] === lastTwo[1]) return lastTwo[1] === 'w' ? { code: 'BB', color: 'b' as Color, why: 'avoids a third White in a row' } : { code: 'WW', color: 'w' as Color, why: 'avoids a third Black in a row' };
    if (bal <= -2) return { code: 'WW', color: 'w' as Color, why: 'strongly corrects the White–Black imbalance' };
    if (bal >= 2) return { code: 'BB', color: 'b' as Color, why: 'strongly corrects the White–Black imbalance' };
    if (bal < 0) return { code: 'W', color: 'w' as Color, why: 'equalizes the White–Black balance' };
    if (bal > 0) return { code: 'B', color: 'b' as Color, why: 'equalizes the White–Black balance' };
    const last = h[h.length - 1];
    return last ? { code: last === 'w' ? 'B' : 'W', color: last === 'w' ? 'b' as Color : 'w' as Color, why: 'alternates the previous color' } : null;
  };
  const wDue = due(wHist);
  const bDue = due(bHist);
  const dueText = (p: Player, d: ReturnType<typeof due>) => d ? `${p.name}: ${d.code} (${d.why})` : `${p.name}: no color due yet`;
  const met = (p: Player, d: ReturnType<typeof due>, assigned: Color) => !d ? null : `${p.name}'s ${d.code} preference was ${d.color === assigned ? 'met' : 'not met'}`;
  const colorReason = [met(w, wDue, 'w'), met(b, bDue, 'b')].filter((x): x is string => x != null).join('; ') || 'neither player had a prior color due, so the deterministic fallback assigned White to the listed White player';

  const lines = [
    wScore === bScore
      ? `Both entered Round ${roundNo} with ${wScore} point(s) — paired within the same score group.`
      : `${wScore > bScore ? w.name : b.name} entered with ${Math.max(wScore, bScore)} point(s) and floated down to pair against ${wScore > bScore ? b.name : w.name} (${Math.min(wScore, bScore)} point(s)), needed to complete an odd bracket.`,
    `Color history before this round — ${w.name}: ${summarize(wHist)}. ${b.name}: ${summarize(bHist)}.`,
    `Color due before assignment — ${dueText(w, wDue)}. ${dueText(b, bDue)}.`,
    `Color decision — ${colorReason}.`,
    priorRound ? `Rematch — they also played in Round ${priorRound}. Paired again only because no rematch-free pairing was available.` : 'First meeting between these two players.',
  ];
  if (sameFamilyGroup(t, w.id, b.id)) {
    const group = t.familyGroups.find((g) => g.playerIds.includes(w.id) && g.playerIds.includes(b.id));
    lines.push(`${w.name} and ${b.name} are marked as "${group?.label ?? 'a family group'}" — paired anyway because no conflict-free pairing was available this round.`);
  }
  return lines;
}

export interface RoundPlayerInfo {
  id: number;
  name: string;
  scoreBefore: number;
  opponentName: string | null; // null if this player had a bye
  opponentScoreBefore: number | null;
  floated: boolean; // true when paired against a different score group
}

export interface RoundSummary {
  groups: { score: number; players: RoundPlayerInfo[] }[]; // by each player's own pre-round score, desc
  forcedRematches: { aName: string; bName: string; lastRound: number }[];
  forcedFamilyConflicts: { aName: string; bName: string; label: string }[];
}

/**
 * Whole-round methodology summary: every player grouped by the score they entered the round
 * with, who floated across a score-group boundary to complete an odd bracket, and any rematches
 * or family-group conflicts that were unavoidable this round. Feeds the round diagram in the UI.
 * Reconstructed after the fact from round history, same approach as explainPairing.
 */
export function explainRound(t: Tournament, roundNo: number): RoundSummary {
  const round = t.rounds[roundNo - 1];
  if (!round) return { groups: [], forcedRematches: [], forcedFamilyConflicts: [] };
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const infos: RoundPlayerInfo[] = [];
  const forcedRematches: RoundSummary['forcedRematches'] = [];
  const forcedFamilyConflicts: RoundSummary['forcedFamilyConflicts'] = [];

  for (const pr of round.pairings) {
    if (pr.byeId != null) {
      const p = byId.get(pr.byeId);
      if (!p) continue;
      infos.push({
        id: p.id, name: p.name, scoreBefore: scoreBeforeRound(t, p.id, roundNo),
        opponentName: null, opponentScoreBefore: null, floated: false,
      });
      continue;
    }
    const w = byId.get(pr.whiteId!);
    const b = byId.get(pr.blackId!);
    if (!w || !b) continue;
    const wScore = scoreBeforeRound(t, w.id, roundNo);
    const bScore = scoreBeforeRound(t, b.id, roundNo);
    // Only the higher-scoring player is the one who actually moved brackets (down-floated to
    // complete an odd group) — the lower-scoring player is correctly paired within their own
    // group, just with an extra (higher-scoring) opponent, so they aren't marked as floated.
    infos.push({ id: w.id, name: w.name, scoreBefore: wScore, opponentName: b.name, opponentScoreBefore: bScore, floated: wScore > bScore });
    infos.push({ id: b.id, name: b.name, scoreBefore: bScore, opponentName: w.name, opponentScoreBefore: wScore, floated: bScore > wScore });

    const priorRound = priorMeetingRound(t, w.id, b.id, roundNo);
    if (priorRound) forcedRematches.push({ aName: w.name, bName: b.name, lastRound: priorRound });
    if (sameFamilyGroup(t, w.id, b.id)) {
      const group = t.familyGroups.find((g) => g.playerIds.includes(w.id) && g.playerIds.includes(b.id));
      forcedFamilyConflicts.push({ aName: w.name, bName: b.name, label: group?.label ?? 'family group' });
    }
  }

  const scoreVals = [...new Set(infos.map((i) => i.scoreBefore))].sort((a, b) => b - a);
  const groups = scoreVals.map((score) => ({
    score,
    players: infos.filter((i) => i.scoreBefore === score).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return { groups, forcedRematches, forcedFamilyConflicts };
}

/**
 * Records a half-point bye request for `playerId` in a future round — e.g. a player who played
 * round 1 now knows they'll be away for round 3. Only affects rounds not yet paired; requesting a
 * bye for a round that's already been paired (or is in progress) is a no-op, since pairNextRound()
 * only consults byeRequests at the moment it creates that round. Returns false if the round has
 * already passed or the player wasn't found.
 */
export function requestByeForRound(t: Tournament, playerId: number, roundNo: number): boolean {
  if (roundNo < nextRoundNumber(t)) return false;
  const player = t.players.find((p) => p.id === playerId);
  if (!player || player.withdrawn || player.isHouse) return false;
  if (!player.byeRequests) player.byeRequests = [];
  if (!player.byeRequests.includes(roundNo)) player.byeRequests.push(roundNo);
  return true;
}

/** Cancels a not-yet-paired bye request, e.g. the player changed their mind before that round was paired. */
export function cancelByeRequest(t: Tournament, playerId: number, roundNo: number): void {
  const player = t.players.find((p) => p.id === playerId);
  if (!player) return;
  player.byeRequests = (player.byeRequests ?? []).filter((r) => r !== roundNo);
}

export function pairNextRound(t: Tournament): Round {
  const nextRoundNo = t.rounds.length + 1;
  const active = t.players.filter((p) => !p.withdrawn && !p.isHouse);
  const isFamilyConflict = (a: Player, b: Player) => sameFamilyGroup(t, a.id, b.id);

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
    const { pairs: bp, floater } = pairBracket(bracket, isFamilyConflict);
    pairs.push(...bp);
    floaters = floater ? [floater] : [];
  }
  if (floaters.length) {
    const extra = foldPair(floaters.sort(bySeed), true, isFamilyConflict);
    if (extra) pairs.push(...extra);
  }

  // If the bracket method produced any rematch or family conflict, prefer a globally clean
  // pairing when one exists (exhaustive fold-biased backtracking over the whole field).
  const rematches = (ps: [Player, Player][]) =>
    ps.filter(([a, b]) => a.opponents.includes(b.id)).length;
  const familyConflicts = (ps: [Player, Player][]) => ps.filter(([a, b]) => isFamilyConflict(a, b)).length;
  if (rematches(pairs) > 0 || familyConflicts(pairs) > 0) {
    const global = generalPair(pool, false, isFamilyConflict);
    if (global && rematches(global) === 0 && familyConflicts(global) === 0) pairs = global;
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

/**
 * Convert a bye in the most recently paired round into a real game against a manually-entered
 * "house" (fill-in) player — e.g. a coach, spectator, or extra player on hand who isn't
 * officially entered but is available so the bye recipient gets a game instead of sitting out.
 * The house player is added to the roster so a normal result can be recorded and displayed, but
 * is excluded from standings and from all future round pairings, since they aren't part of the
 * Swiss field.
 *
 * Only the latest round can be edited this way: undoing a bye recorded in an earlier round would
 * misalign the bye recipient's per-round opponents/colors history against every round paired
 * since (standings() reads that history by matching array index to round index).
 */
export function addExtraGameForBye(
  t: Tournament,
  roundNo: number,
  byeId: number,
  houseName: string,
  houseRating: number | null
): boolean {
  if (roundNo !== t.rounds.length) return false; // only the latest round is safe to edit
  const round = t.rounds[roundNo - 1];
  if (!round) return false;
  const pr = round.pairings.find((p) => p.byeId === byeId);
  if (!pr) return false;
  const player = t.players.find((p) => p.id === byeId);
  if (!player) return false;
  const name = houseName.trim();
  if (!name) return false;

  // Undo the bye.
  const points = pr.byePoints ?? 1;
  player.score -= points;
  player.opponents.pop(); // the -1 recorded by commitRound
  if (points === 0.5) player.requestedByes = Math.max(0, (player.requestedByes ?? 0) - 1);
  else player.byes = Math.max(0, (player.byes ?? 0) - 1);

  // Add the house player.
  const nextId = Math.max(0, ...t.players.map((p) => p.id)) + 1;
  const house: Player = {
    id: nextId,
    name,
    rating: houseRating,
    score: 0,
    opponents: [],
    colors: [],
    byes: 0,
    requestedByes: 0,
    byeRequests: [],
    withdrawn: false,
    isHouse: true,
  };
  t.players.push(house);

  // Pair them for real, honouring the bye recipient's actual color balance/history.
  const { whiteId, blackId } = assignColors(player, house);
  pr.byeId = null;
  pr.byePoints = undefined;
  pr.whiteId = whiteId;
  pr.blackId = blackId;
  pr.result = null;

  const w = whiteId === player.id ? player : house;
  const b = blackId === player.id ? player : house;
  w.opponents.push(b.id); w.colors.push('w');
  b.opponents.push(w.id); b.colors.push('b');

  round.complete = round.pairings.every((p) => p.byeId != null || p.result != null);
  return true;
}

/**
 * Swaps which of the two paired players is White vs Black on a board — e.g. the TD notices
 * colors were assigned backwards. Whoever actually won stays the winner: if a result was already
 * entered, it's flipped (1-0 ↔ 0-1) along with the colors so the recorded outcome still points at
 * the same player, not the same color. Only the latest round can be edited this way, matching
 * addExtraGameForBye's restriction — editing a past round's colors would leave later rounds'
 * pairings out of sync with the color-balance history they were built from.
 */
export function swapColors(t: Tournament, roundNo: number, board: number): boolean {
  if (roundNo !== t.rounds.length) return false;
  const round = t.rounds[roundNo - 1];
  if (!round) return false;
  const pr = round.pairings.find((p) => p.board === board);
  if (!pr || pr.byeId != null || pr.whiteId == null || pr.blackId == null) return false;

  const byId = new Map(t.players.map((p) => [p.id, p]));
  const w = byId.get(pr.whiteId);
  const b = byId.get(pr.blackId);
  if (!w || !b) return false;

  [pr.whiteId, pr.blackId] = [pr.blackId, pr.whiteId];
  if (pr.result === '1-0') pr.result = '0-1';
  else if (pr.result === '0-1') pr.result = '1-0';

  // Flip the most recent (this round's) color entry for each player — using the *last* array
  // index rather than roundNo-1 keeps this correct even if a player's colors/opponents history
  // has ever gone out of round-index alignment (e.g. from a bye elsewhere).
  if (w.colors.length) w.colors[w.colors.length - 1] = w.colors[w.colors.length - 1] === 'w' ? 'b' : 'w';
  if (b.colors.length) b.colors[b.colors.length - 1] = b.colors[b.colors.length - 1] === 'w' ? 'b' : 'w';
  return true;
}

/**
 * Reassigns a bye from one player to another player currently paired in the same round — e.g.
 * the wrong player was given the bye and someone else should have sat out instead. The original
 * bye recipient takes over the other player's board (same color, same opponent); the other
 * player gets the bye instead. Only the latest round, and only when that board hasn't had a
 * result entered yet (swapping after a game's been played would require un-scoring it, which
 * isn't supported here). Returns false if any precondition isn't met.
 */
export function swapByeWithPlayer(t: Tournament, roundNo: number, byeId: number, otherPlayerId: number): boolean {
  if (roundNo !== t.rounds.length || byeId === otherPlayerId) return false;
  const round = t.rounds[roundNo - 1];
  if (!round) return false;
  const byePr = round.pairings.find((p) => p.byeId === byeId);
  if (!byePr) return false;
  const otherPr = round.pairings.find(
    (p) => p.byeId == null && (p.whiteId === otherPlayerId || p.blackId === otherPlayerId)
  );
  if (!otherPr || otherPr.result != null) return false;

  const byId = new Map(t.players.map((p) => [p.id, p]));
  const byePlayer = byId.get(byeId);
  const otherPlayer = byId.get(otherPlayerId);
  if (!byePlayer || !otherPlayer || byePlayer.withdrawn || otherPlayer.withdrawn) return false;

  const otherWasWhite = otherPr.whiteId === otherPlayerId;
  const thirdId = otherWasWhite ? otherPr.blackId! : otherPr.whiteId!;
  const thirdPlayer = byId.get(thirdId);
  if (!thirdPlayer) return false;

  // Undo the bye.
  const points = byePr.byePoints ?? 1;
  byePlayer.score -= points;
  byePlayer.opponents.pop();
  if (points === 0.5) byePlayer.requestedByes = Math.max(0, (byePlayer.requestedByes ?? 0) - 1);
  else byePlayer.byes = Math.max(0, (byePlayer.byes ?? 0) - 1);

  // Undo the other player's real-game commit and give them the bye instead.
  otherPlayer.opponents.pop();
  otherPlayer.colors.pop();
  otherPlayer.opponents.push(-1);
  if (points === 0.5) otherPlayer.requestedByes = (otherPlayer.requestedByes ?? 0) + 1;
  else otherPlayer.byes = (otherPlayer.byes ?? 0) + 1;
  otherPlayer.score += points;

  // Give the original bye recipient the vacated board — same color slot, same opponent.
  const slotColor: Color = otherWasWhite ? 'w' : 'b';
  byePlayer.opponents.push(thirdId);
  byePlayer.colors.push(slotColor);
  thirdPlayer.opponents[thirdPlayer.opponents.length - 1] = byeId;

  byePr.byeId = otherPlayerId;
  if (otherWasWhite) otherPr.whiteId = byeId;
  else otherPr.blackId = byeId;

  round.complete = round.pairings.every((p) => p.byeId != null || p.result != null);
  return true;
}

/**
 * Swaps two players who are on different boards in the latest round — e.g. board 2 and board 3
 * should have been paired against each other instead of who they actually got. Each player takes
 * over the other's board and color slot (against the other's original opponent); who's White vs
 * Black on each board is unaffected by the swap itself. Only the latest round, and only when
 * neither board has a result entered yet. Returns false if any precondition isn't met (including
 * both players already being on the same board — nothing to swap).
 */
export function swapPlayersAcrossBoards(t: Tournament, roundNo: number, playerAId: number, playerBId: number): boolean {
  if (roundNo !== t.rounds.length || playerAId === playerBId) return false;
  const round = t.rounds[roundNo - 1];
  if (!round) return false;
  const prA = round.pairings.find((p) => p.byeId == null && (p.whiteId === playerAId || p.blackId === playerAId));
  const prB = round.pairings.find((p) => p.byeId == null && (p.whiteId === playerBId || p.blackId === playerBId));
  if (!prA || !prB || prA === prB) return false;
  if (prA.result != null || prB.result != null) return false;

  const byId = new Map(t.players.map((p) => [p.id, p]));
  const playerA = byId.get(playerAId);
  const playerB = byId.get(playerBId);
  if (!playerA || !playerB || playerA.withdrawn || playerB.withdrawn) return false;

  const aWasWhite = prA.whiteId === playerAId;
  const bWasWhite = prB.whiteId === playerBId;
  const aOpponentId = aWasWhite ? prA.blackId! : prA.whiteId!;
  const bOpponentId = bWasWhite ? prB.blackId! : prB.whiteId!;
  const aOpponent = byId.get(aOpponentId);
  const bOpponent = byId.get(bOpponentId);
  if (!aOpponent || !bOpponent) return false;

  // Give each player the other's board/color slot/opponent.
  playerA.opponents.pop(); playerA.colors.pop();
  playerB.opponents.pop(); playerB.colors.pop();
  playerA.opponents.push(bOpponentId); playerA.colors.push(bWasWhite ? 'w' : 'b');
  playerB.opponents.push(aOpponentId); playerB.colors.push(aWasWhite ? 'w' : 'b');

  // Their former opponents now face the new arrival instead.
  aOpponent.opponents[aOpponent.opponents.length - 1] = playerBId;
  bOpponent.opponents[bOpponent.opponents.length - 1] = playerAId;

  if (aWasWhite) prA.whiteId = playerBId; else prA.blackId = playerBId;
  if (bWasWhite) prB.whiteId = playerAId; else prB.blackId = playerAId;
  return true;
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
  const byId = new Map(t.players.map((p) => [p.id, p])); // keeps house players so opponents can resolve them
  const rows: Omit<Standing, 'rank'>[] = t.players.filter((p) => !p.isHouse).map((p) => {
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
