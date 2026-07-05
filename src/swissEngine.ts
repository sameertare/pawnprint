/** A self-contained Swiss-system tournament engine: roster parsing, pairing, results, standings. */

export type Color = 'w' | 'b';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | null;

export interface Player {
  id: number;
  name: string;
  rating: number | null;
  score: number;
  opponents: number[];   // opponent ids per round played (byes recorded as -1)
  colors: Color[];       // colors received in order
  byes: number;
  withdrawn: boolean;
}

export interface Pairing {
  board: number;
  whiteId: number | null;
  blackId: number | null;
  byeId: number | null;  // full-point bye
  result: GameResult;    // null until entered; byes auto-scored
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
export function parseRoster(text: string): { name: string; rating: number | null }[] {
  const out: { name: string; rating: number | null }[] = [];
  const seen = new Set<string>();
  for (let raw of text.replace(/\r/g, '').split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    if (/^(name|player|rank)\b/i.test(line) && /rating|elo/i.test(line)) continue; // header row
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

export function createTournament(
  name: string,
  roster: { name: string; rating: number | null }[]
): Tournament {
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
  const active = t.players.filter((p) => !p.withdrawn);
  const bySeed = (x: Player, y: Player) =>
    y.score - x.score || (y.rating ?? 0) - (x.rating ?? 0) || x.id - y.id;
  const sorted = [...active].sort(bySeed);

  let byePlayer: Player | null = null;
  let pool = sorted;
  if (sorted.length % 2 === 1) {
    // bye to the lowest-standing player who has had the fewest byes
    const candidates = [...sorted].sort(
      (x, y) => x.byes - y.byes || x.score - y.score || (x.rating ?? 0) - (y.rating ?? 0)
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
  if (byePlayer) {
    pairings.push({ board: pairings.length + 1, whiteId: null, blackId: null, byeId: byePlayer.id, result: null });
  }

  const round: Round = { number: t.rounds.length + 1, pairings, complete: false };
  return round;
}

/** Apply a freshly created round (records opponents/colors; auto-scores byes). */
export function commitRound(t: Tournament, round: Round) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  for (const pr of round.pairings) {
    if (pr.byeId != null) {
      const p = byId.get(pr.byeId)!;
      p.opponents.push(-1);
      p.byes++;
      p.score += 1; // full-point bye
      pr.result = '1-0'; // marker; not a real game
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
    // count bye wins toward win column
    wins += p.byes;
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
