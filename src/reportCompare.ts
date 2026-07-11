/**
 * Pure delta-computation logic for comparing two Aggregates (from two loaded report.md files) —
 * no DOM, no rendering. src/compareReports.ts turns this into HTML.
 */
import type { Aggregates, OpeningRow, WDL } from './aggregate';
import { scorePct } from './aggregate';

/** Which direction counts as "improved" for a given metric — a blunder count going up is bad,
 *  a score% going up is good, and some metrics (e.g. game count) have no better/worse at all. */
export type Direction = 'higher-better' | 'lower-better' | 'neutral';

export interface DeltaRow {
  label: string;
  a: number | null;
  b: number | null;
  delta: number | null; // b - a
  direction: Direction;
  suffix: string; // '%', '', etc. — appended when displaying a/b/delta
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function deltaRow(label: string, a: number | null, b: number | null, direction: Direction, suffix = ''): DeltaRow {
  const delta = a !== null && b !== null ? round1(b - a) : null;
  return { label, a, b, delta, direction, suffix };
}

/** 'a' | 'b' | 'tie' | null (null when not comparable, e.g. one side has no data). Used to decide
 *  which side's cell gets the "better" highlight independent of how the delta itself is colored. */
export function betterSide(row: DeltaRow): 'a' | 'b' | 'tie' | null {
  if (row.a === null || row.b === null || row.direction === 'neutral') return null;
  if (row.a === row.b) return 'tie';
  if (row.direction === 'higher-better') return row.b > row.a ? 'b' : 'a';
  return row.b < row.a ? 'b' : 'a';
}

export interface OpeningDelta {
  family: string;
  eco: string;
  a: OpeningRow | null; // null if this opening didn't appear in report A
  b: OpeningRow | null; // null if this opening didn't appear in report B
  scoreDelta: number | null;
}

/** Matches openings by family name across both reports. An opening present in only one report
 *  still gets a row (the other side null) — surfaced separately in the UI as "new" / "dropped". */
export function compareOpenings(aRows: OpeningRow[], bRows: OpeningRow[]): OpeningDelta[] {
  const aByFamily = new Map(aRows.map((r) => [r.family, r]));
  const bByFamily = new Map(bRows.map((r) => [r.family, r]));
  const families = new Set([...aByFamily.keys(), ...bByFamily.keys()]);
  const out: OpeningDelta[] = [];
  for (const family of families) {
    const a = aByFamily.get(family) ?? null;
    const b = bByFamily.get(family) ?? null;
    out.push({
      family,
      eco: (a ?? b)!.eco,
      a,
      b,
      scoreDelta: a && b ? round1(scorePct(b) - scorePct(a)) : null,
    });
  }
  return out;
}

export interface ComparisonSections {
  overview: DeltaRow[];
  byColorWhite: DeltaRow[];
  byColorBlack: DeltaRow[];
  byTimeClass: { timeClass: string; rows: DeltaRow[] }[];
  phases: { phase: string; rows: DeltaRow[] }[];
  tactics: DeltaRow[];
  patterns: DeltaRow[];
  openings: OpeningDelta[];
}

function wdlRows(prefix: string, a: WDL, b: WDL): DeltaRow[] {
  return [
    deltaRow(`${prefix} score`, scorePct(a), scorePct(b), 'higher-better', '%'),
    deltaRow(`${prefix} games`, a.games, b.games, 'neutral'),
    deltaRow(`${prefix} wins`, a.wins, b.wins, 'higher-better'),
    deltaRow(`${prefix} draws`, a.draws, b.draws, 'neutral'),
    deltaRow(`${prefix} losses`, a.losses, b.losses, 'lower-better'),
  ];
}

/** Divides by game count for a fair per-game rate when the two reports cover very different
 *  numbers of games — comparing raw blunder counts between a 20-game and a 200-game report would
 *  otherwise always favor whichever has fewer games. */
function perGame(count: number, games: number): number | null {
  return games ? round1(count / games) : null;
}

export function compareReports(a: Aggregates, b: Aggregates): ComparisonSections {
  const overview: DeltaRow[] = [
    ...wdlRows('Overall', a.total, b.total),
    deltaRow('Overall accuracy', a.overallAccuracy, b.overallAccuracy, 'higher-better', '%'),
    deltaRow('Games analyzed', a.analyzedCount, b.analyzedCount, 'neutral'),
  ];

  const byColorWhite = wdlRows('White', a.byColor.white, b.byColor.white);
  const byColorBlack = wdlRows('Black', a.byColor.black, b.byColor.black);

  const timeClasses = new Set([...a.byTimeClass.map((t) => t.timeClass), ...b.byTimeClass.map((t) => t.timeClass)]);
  const byTimeClass = [...timeClasses].map((timeClass) => {
    const ta = a.byTimeClass.find((t) => t.timeClass === timeClass);
    const tb = b.byTimeClass.find((t) => t.timeClass === timeClass);
    const aWdl = ta?.wdl ?? { games: 0, wins: 0, draws: 0, losses: 0 };
    const bWdl = tb?.wdl ?? { games: 0, wins: 0, draws: 0, losses: 0 };
    return {
      timeClass,
      rows: [
        deltaRow('Score', ta ? scorePct(aWdl) : null, tb ? scorePct(bWdl) : null, 'higher-better', '%'),
        deltaRow('Games', ta ? aWdl.games : null, tb ? bWdl.games : null, 'neutral'),
        deltaRow('Accuracy', ta?.avgAccuracy ?? null, tb?.avgAccuracy ?? null, 'higher-better', '%'),
      ],
    };
  });

  const phaseNames = new Set([...a.phases.map((p) => p.phase), ...b.phases.map((p) => p.phase)]);
  const phases = [...phaseNames].map((phase) => {
    const pa = a.phases.find((p) => p.phase === phase);
    const pb = b.phases.find((p) => p.phase === phase);
    return {
      phase,
      rows: [
        deltaRow('Accuracy', pa?.avgAccuracy ?? null, pb?.avgAccuracy ?? null, 'higher-better', '%'),
        deltaRow('Blunders/game', pa?.blundersPerGame ?? null, pb?.blundersPerGame ?? null, 'lower-better'),
        deltaRow('Inaccuracies', pa?.inaccuracies ?? null, pb?.inaccuracies ?? null, 'lower-better'),
        deltaRow('Mistakes', pa?.mistakes ?? null, pb?.mistakes ?? null, 'lower-better'),
        deltaRow('Blunders', pa?.blunders ?? null, pb?.blunders ?? null, 'lower-better'),
        deltaRow('Decisive in losses', pa?.decisiveErrorsInLosses ?? null, pb?.decisiveErrorsInLosses ?? null, 'lower-better'),
      ],
    };
  });

  const tactics: DeltaRow[] = [
    deltaRow('Missed wins / game', perGame(a.tactics.missedWins, a.analyzedCount), perGame(b.tactics.missedWins, b.analyzedCount), 'lower-better'),
    deltaRow('Missed mates / game', perGame(a.tactics.missedMates, a.analyzedCount), perGame(b.tactics.missedMates, b.analyzedCount), 'lower-better'),
    deltaRow('Missed tactics / game', perGame(a.tactics.missedTactics, a.analyzedCount), perGame(b.tactics.missedTactics, b.analyzedCount), 'lower-better'),
    deltaRow('Blunders total / game', perGame(a.tactics.blundersTotal, a.analyzedCount), perGame(b.tactics.blundersTotal, b.analyzedCount), 'lower-better'),
    deltaRow('Missed wins (raw)', a.tactics.missedWins, b.tactics.missedWins, 'neutral'),
    deltaRow('Missed mates (raw)', a.tactics.missedMates, b.tactics.missedMates, 'neutral'),
    deltaRow('Missed tactics (raw)', a.tactics.missedTactics, b.tactics.missedTactics, 'neutral'),
    deltaRow('Blunders total (raw)', a.tactics.blundersTotal, b.tactics.blundersTotal, 'neutral'),
  ];

  const p = a.patterns, q = b.patterns;
  const patterns: DeltaRow[] = [
    deltaRow('Conversion rate (winning → win)', p.conversionRate, q.conversionRate, 'higher-better', '%'),
    deltaRow('Games reached winning', p.gamesReachedWinning, q.gamesReachedWinning, 'neutral'),
    deltaRow('Lost from winning', p.lostFromWinning.length, q.lostFromWinning.length, 'lower-better'),
    deltaRow('Drew from winning', p.drewFromWinning.length, q.drewFromWinning.length, 'lower-better'),
    deltaRow('Saved from losing', p.savedFromLosing.length, q.savedFromLosing.length, 'higher-better'),
    deltaRow('Avg move of first error', p.avgFirstErrorMove, q.avgFirstErrorMove, 'higher-better'),
    deltaRow('Time-pressure blunders', p.timePressureBlunders, q.timePressureBlunders, 'lower-better'),
    deltaRow('Games with clock data', p.clockGames, q.clockGames, 'neutral'),
  ];

  const openings = compareOpenings(a.openings, b.openings).sort((x, y) => {
    const bGames = (r: OpeningDelta) => (r.a?.games ?? 0) + (r.b?.games ?? 0);
    return bGames(y) - bGames(x);
  });

  return { overview, byColorWhite, byColorBlack, byTimeClass, phases, tactics, patterns, openings };
}
