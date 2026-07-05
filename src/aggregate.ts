import type { ErrCounts, GameRecord, Phase } from './types';
import { LOSING_WINPCT, WINNING_WINPCT } from './analyze';

export interface WDL {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export function scorePct(w: WDL): number {
  return w.games ? Math.round(((w.wins + 0.5 * w.draws) / w.games) * 1000) / 10 : 0;
}

export interface OpeningRow extends WDL {
  family: string;
  eco: string;
  asWhite: number;
  asBlack: number;
  avgAccuracy: number | null;
  avgOpeningAccuracy: number | null;
}

export interface PhaseStats {
  phase: Phase;
  avgAccuracy: number | null;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  blundersPerGame: number;
  decisiveErrorsInLosses: number; // losses whose decisive error fell in this phase
}

export interface Patterns {
  lostFromWinning: GameRecord[];
  drewFromWinning: GameRecord[];
  savedFromLosing: GameRecord[];
  conversionRate: number | null;  // of games where user hit >= WINNING_WINPCT, % won
  gamesReachedWinning: number;
  decisivePhaseInLosses: Record<Phase, number>;
  avgFirstErrorMove: number | null;
  timePressureBlunders: number;
  clockGames: number;
  endgameTypeCounts: Record<string, WDL>;
  errorsInWins: ErrCounts;
  errorsInLosses: ErrCounts;
  analyzedWins: number;
  analyzedLosses: number;
  narrative: string[];
}

export interface Recommendation {
  area: string;
  severity: 'high' | 'medium' | 'low';
  why: string;
  themes: { name: string; label: string }[]; // lichess puzzle theme keys
  drills: string[];
}

export interface Aggregates {
  total: WDL;
  byColor: { white: WDL; black: WDL };
  openings: OpeningRow[];
  strongest: OpeningRow[];
  weakest: OpeningRow[];
  byTimeClass: { timeClass: string; wdl: WDL; avgAccuracy: number | null }[];
  phases: PhaseStats[];
  overallAccuracy: number | null;
  tactics: {
    missedWins: number;
    missedMates: number;
    missedTactics: number;
    blundersTotal: number;
    worstMoments: { game: GameRecord; move: GameRecord['worstMoves'][0] }[];
  };
  patterns: Patterns;
  recommendations: Recommendation[];
  analyzedCount: number;
}

function emptyWDL(): WDL {
  return { games: 0, wins: 0, draws: 0, losses: 0 };
}

function addResult(w: WDL, r: GameRecord) {
  w.games++;
  if (r.result === 'win') w.wins++;
  else if (r.result === 'loss') w.losses++;
  else w.draws++;
}

function avg(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
}

const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

export function aggregate(games: GameRecord[]): Aggregates {
  const total = emptyWDL();
  const byColor = { white: emptyWDL(), black: emptyWDL() };
  const openingMap = new Map<string, OpeningRow>();
  const tcMap = new Map<string, { wdl: WDL; accs: number[] }>();
  const analyzed = games.filter((g) => g.analyzed);

  for (const g of games) {
    addResult(total, g);
    addResult(g.userColor === 'w' ? byColor.white : byColor.black, g);

    let row = openingMap.get(g.family);
    if (!row) {
      row = {
        family: g.family, eco: g.eco, ...emptyWDL(),
        asWhite: 0, asBlack: 0, avgAccuracy: null, avgOpeningAccuracy: null,
      };
      openingMap.set(g.family, row);
    }
    addResult(row, g);
    if (g.userColor === 'w') row.asWhite++;
    else row.asBlack++;
    if (g.eco && !row.eco) row.eco = g.eco;

    let tc = tcMap.get(g.timeClass);
    if (!tc) {
      tc = { wdl: emptyWDL(), accs: [] };
      tcMap.set(g.timeClass, tc);
    }
    addResult(tc.wdl, g);
    if (g.accuracy.overall !== null) tc.accs.push(g.accuracy.overall);
  }

  for (const row of openingMap.values()) {
    const inFam = analyzed.filter((g) => g.family === row.family);
    row.avgAccuracy = avg(inFam.map((g) => g.accuracy.overall).filter((x): x is number => x !== null));
    row.avgOpeningAccuracy = avg(inFam.map((g) => g.accuracy.opening).filter((x): x is number => x !== null));
  }

  const openings = [...openingMap.values()].sort((a, b) => b.games - a.games);
  const ranked = openings.filter((o) => o.games >= 2);
  const byScore = [...ranked].sort((a, b) => scorePct(b) - scorePct(a) || b.games - a.games);
  const strongest = byScore.filter((o) => scorePct(o) >= 50).slice(0, 5);
  const weakest = [...byScore].reverse().filter((o) => scorePct(o) < 50).slice(0, 5);

  // Phase stats
  const phases: PhaseStats[] = PHASES.map((phase) => {
    const accs = analyzed
      .map((g) => g.accuracy[phase])
      .filter((x): x is number => x !== null);
    let inacc = 0, mist = 0, blund = 0, decisive = 0;
    for (const g of analyzed) {
      inacc += g.errors[phase].inaccuracies;
      mist += g.errors[phase].mistakes;
      blund += g.errors[phase].blunders;
      if (g.result === 'loss' && g.decisiveErrorPhase === phase) decisive++;
    }
    return {
      phase,
      avgAccuracy: avg(accs),
      inaccuracies: inacc,
      mistakes: mist,
      blunders: blund,
      blundersPerGame: analyzed.length ? Math.round((blund / analyzed.length) * 100) / 100 : 0,
      decisiveErrorsInLosses: decisive,
    };
  });

  const overallAccuracy = avg(
    analyzed.map((g) => g.accuracy.overall).filter((x): x is number => x !== null)
  );

  // Tactics
  const worstMoments = analyzed
    .flatMap((g) => g.worstMoves.map((m) => ({ game: g, move: m })))
    .sort((a, b) => (b.move.winPctBefore - b.move.winPctAfter) - (a.move.winPctBefore - a.move.winPctAfter))
    .slice(0, 10);
  const tactics = {
    missedWins: analyzed.reduce((s, g) => s + g.missedWins, 0),
    missedMates: analyzed.reduce((s, g) => s + g.missedMates, 0),
    missedTactics: analyzed.reduce((s, g) => s + g.missedTactics, 0),
    blundersTotal: phases.reduce((s, p) => s + p.blunders, 0),
    worstMoments,
  };

  // Patterns
  const lostFromWinning = analyzed.filter((g) => g.lostFromWinning);
  const drewFromWinning = analyzed.filter((g) => g.drewFromWinning);
  const savedFromLosing = analyzed.filter((g) => g.savedFromLosing);
  const reachedWinning = analyzed.filter((g) => g.bestWinPct >= WINNING_WINPCT);
  const conversionRate = reachedWinning.length
    ? Math.round((reachedWinning.filter((g) => g.result === 'win').length / reachedWinning.length) * 100)
    : null;
  const decisivePhaseInLosses: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  for (const g of analyzed) {
    if (g.result === 'loss' && g.decisiveErrorPhase) decisivePhaseInLosses[g.decisiveErrorPhase]++;
  }
  const firstErrs = analyzed.map((g) => g.firstErrorMove).filter((x): x is number => x !== null);
  const clockGames = games.filter((g) => g.clockDataAvailable).length;
  const timePressureBlunders = games.reduce((s, g) => s + g.timePressureBlunders, 0);

  const endgameTypeCounts: Record<string, WDL> = {};
  for (const g of games) {
    if (g.reachedEndgame && g.endgameType) {
      endgameTypeCounts[g.endgameType] ??= emptyWDL();
      addResult(endgameTypeCounts[g.endgameType], g);
    }
  }

  const errorsInWins: ErrCounts = { inaccuracies: 0, mistakes: 0, blunders: 0 };
  const errorsInLosses: ErrCounts = { inaccuracies: 0, mistakes: 0, blunders: 0 };
  let analyzedWins = 0, analyzedLosses = 0;
  for (const g of analyzed) {
    const bucket = g.result === 'win' ? errorsInWins : g.result === 'loss' ? errorsInLosses : null;
    if (g.result === 'win') analyzedWins++;
    if (g.result === 'loss') analyzedLosses++;
    if (!bucket) continue;
    for (const p of PHASES) {
      bucket.inaccuracies += g.errors[p].inaccuracies;
      bucket.mistakes += g.errors[p].mistakes;
      bucket.blunders += g.errors[p].blunders;
    }
  }

  const narrative = buildNarrative({
    analyzed, lostFromWinning, savedFromLosing, conversionRate,
    reachedWinning: reachedWinning.length, decisivePhaseInLosses,
    phases, timePressureBlunders, clockGames, total,
  });

  const patterns: Patterns = {
    lostFromWinning, drewFromWinning, savedFromLosing, conversionRate,
    gamesReachedWinning: reachedWinning.length,
    decisivePhaseInLosses,
    avgFirstErrorMove: avg(firstErrs),
    timePressureBlunders, clockGames, endgameTypeCounts,
    errorsInWins, errorsInLosses, analyzedWins, analyzedLosses,
    narrative,
  };

  const recommendations = recommend(phases, tactics, patterns, weakest, analyzed.length);

  return {
    total, byColor, openings, strongest, weakest,
    byTimeClass: [...tcMap.entries()]
      .map(([timeClass, v]) => ({ timeClass, wdl: v.wdl, avgAccuracy: avg(v.accs) }))
      .sort((a, b) => b.wdl.games - a.wdl.games),
    phases, overallAccuracy, tactics, patterns, recommendations,
    analyzedCount: analyzed.length,
  };
}

function buildNarrative(ctx: {
  analyzed: GameRecord[];
  lostFromWinning: GameRecord[];
  savedFromLosing: GameRecord[];
  conversionRate: number | null;
  reachedWinning: number;
  decisivePhaseInLosses: Record<Phase, number>;
  phases: PhaseStats[];
  timePressureBlunders: number;
  clockGames: number;
  total: WDL;
}): string[] {
  const out: string[] = [];
  const losses = ctx.analyzed.filter((g) => g.result === 'loss');
  const decisiveTotal = PHASES.reduce((s, p) => s + ctx.decisivePhaseInLosses[p], 0);

  if (decisiveTotal > 0) {
    const worstPhase = PHASES.reduce((a, b) =>
      ctx.decisivePhaseInLosses[a] >= ctx.decisivePhaseInLosses[b] ? a : b
    );
    const n = ctx.decisivePhaseInLosses[worstPhase];
    if (n / decisiveTotal >= 0.5 && n >= 2) {
      out.push(
        `**Loss pattern:** in ${n} of ${decisiveTotal} losses with an identifiable turning point, the decisive mistake came in the **${worstPhase}**. Positions were equal or better before that point — this phase is where games are being given away.`
      );
    } else {
      const parts = PHASES.filter((p) => ctx.decisivePhaseInLosses[p] > 0)
        .map((p) => `${ctx.decisivePhaseInLosses[p]} in the ${p}`);
      out.push(`**Where losses originate:** ${parts.join(', ')} (out of ${losses.length} analyzed losses).`);
    }
  }

  if (ctx.lostFromWinning.length > 0) {
    out.push(
      `**Thrown wins:** ${ctx.lostFromWinning.length} game(s) were lost after reaching a winning position (≥${WINNING_WINPCT}% win chance). Conversion of winning positions is currently ${ctx.conversionRate ?? '—'}% (${ctx.reachedWinning} games reached winning positions).`
    );
  } else if (ctx.conversionRate !== null && ctx.reachedWinning >= 3) {
    out.push(
      `**Conversion:** of ${ctx.reachedWinning} games that reached a winning position, ${ctx.conversionRate}% were won.` +
      (ctx.conversionRate >= 80 ? ' Converting well — keep it up.' : ' There is room to convert more of these.')
    );
  }

  if (ctx.savedFromLosing.length > 0) {
    out.push(
      `**Resilience:** ${ctx.savedFromLosing.length} game(s) were saved (draw or win) from losing positions (≤${LOSING_WINPCT}% win chance) — good fighting spirit.`
    );
  }

  const withAcc = ctx.phases.filter((p) => p.avgAccuracy !== null);
  if (withAcc.length >= 2) {
    const weakest = withAcc.reduce((a, b) => (a.avgAccuracy! <= b.avgAccuracy! ? a : b));
    const strongest = withAcc.reduce((a, b) => (a.avgAccuracy! >= b.avgAccuracy! ? a : b));
    if (strongest.avgAccuracy! - weakest.avgAccuracy! >= 5) {
      out.push(
        `**Phase gap:** strongest phase is the **${strongest.phase}** (${strongest.avgAccuracy}% accuracy), weakest is the **${weakest.phase}** (${weakest.avgAccuracy}%). A ${Math.round(strongest.avgAccuracy! - weakest.avgAccuracy!)}-point gap is worth targeted training.`
      );
    }
  }

  if (ctx.clockGames > 0 && ctx.timePressureBlunders >= 2) {
    out.push(
      `**Time trouble:** ${ctx.timePressureBlunders} serious errors were played with under 30 seconds on the clock. Consider faster decisions in the opening/middlegame to bank time, or longer time controls for training.`
    );
  }
  return out;
}

const THEME_LABELS: Record<string, string> = {
  hangingPiece: 'Hanging pieces',
  fork: 'Forks',
  pin: 'Pins',
  skewer: 'Skewers',
  discoveredAttack: 'Discovered attacks',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mate: 'Checkmate patterns',
  backRankMate: 'Back-rank mates',
  advantage: 'Convert an advantage',
  crushing: 'Crushing (winning material)',
  defensiveMove: 'Defensive moves',
  endgame: 'Endgames (all)',
  rookEndgame: 'Rook endgames',
  pawnEndgame: 'Pawn endgames',
  queenEndgame: 'Queen endgames',
  knightEndgame: 'Knight endgames',
  bishopEndgame: 'Bishop endgames',
  middlegame: 'Middlegame positions',
  opening: 'Opening-phase puzzles',
  quietMove: 'Quiet moves',
  zugzwang: 'Zugzwang',
};

export function themeUrl(theme: string): string {
  return `https://lichess.org/training/${theme}`;
}
export function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? theme;
}

function recommend(
  phases: PhaseStats[],
  tactics: Aggregates['tactics'],
  patterns: Patterns,
  weakest: OpeningRow[],
  analyzedCount: number
): Recommendation[] {
  const recs: Recommendation[] = [];
  if (analyzedCount === 0) return recs;
  const t = (names: string[]) => names.map((n) => ({ name: n, label: themeLabel(n) }));

  const withAcc = phases.filter((p) => p.avgAccuracy !== null);
  const weakestPhase = withAcc.length
    ? withAcc.reduce((a, b) => (a.avgAccuracy! <= b.avgAccuracy! ? a : b))
    : null;

  if (weakestPhase?.phase === 'endgame' || (phases[2].blunders >= 3)) {
    const egTypes = Object.entries(patterns.endgameTypeCounts).sort((a, b) => b[1].games - a[1].games);
    const themes = ['endgame'];
    for (const [type] of egTypes.slice(0, 2)) {
      if (type.startsWith('Rook')) themes.push('rookEndgame');
      else if (type.startsWith('Pawn')) themes.push('pawnEndgame');
      else if (type.startsWith('Queen')) themes.push('queenEndgame');
      else if (type.startsWith('Minor')) themes.push('bishopEndgame', 'knightEndgame');
    }
    recs.push({
      area: 'Endgame technique',
      severity: weakestPhase?.phase === 'endgame' ? 'high' : 'medium',
      why: `Endgame accuracy is ${phases[2].avgAccuracy ?? '—'}% with ${phases[2].blunders} blunder(s) and ${phases[2].decisiveErrorsInLosses} loss(es) decided there. Most common endgame reached: ${egTypes[0]?.[0] ?? 'n/a'}.`,
      themes: t([...new Set(themes)]),
      drills: [
        'Practice K+P vs K opposition and the "square of the pawn" until automatic.',
        'Learn the Lucena and Philidor rook-endgame positions.',
        'Play out won endgames vs an engine from your own games.',
      ],
    });
  }

  if (weakestPhase?.phase === 'middlegame' || phases[1].blunders >= 3) {
    recs.push({
      area: 'Middlegame calculation',
      severity: weakestPhase?.phase === 'middlegame' ? 'high' : 'medium',
      why: `Middlegame accuracy is ${phases[1].avgAccuracy ?? '—'}% with ${phases[1].blunders} blunder(s); ${phases[1].decisiveErrorsInLosses} loss(es) were decided in the middlegame.`,
      themes: t(['middlegame', 'fork', 'pin', 'discoveredAttack', 'hangingPiece']),
      drills: [
        'Before every move, run a blunder check: "What are ALL checks, captures, and threats against me?"',
        'Do 15 minutes of mixed tactics daily at slow pace — accuracy over speed.',
        'Annotate one of your middlegame losses per week without an engine first.',
      ],
    });
  }

  if (weakestPhase?.phase === 'opening' || phases[0].blunders + phases[0].mistakes >= 3 || weakest.length > 0) {
    const openingList = weakest.slice(0, 3).map((o) => `${o.family} (${o.wins}W-${o.draws}D-${o.losses}L)`).join(', ');
    recs.push({
      area: 'Opening preparation',
      severity: weakestPhase?.phase === 'opening' ? 'high' : 'low',
      why: `Opening accuracy is ${phases[0].avgAccuracy ?? '—'}%.` + (openingList ? ` Worst-scoring openings: ${openingList}.` : ''),
      themes: t(['opening']),
      drills: [
        'Pick ONE reply to 1.e4 and ONE to 1.d4 and build a 6–8 move repertoire file.',
        'After every loss, check where the game left your known theory and learn one move deeper.',
        'Drill your repertoire lines on a board until recall is instant.',
      ],
    });
  }

  if (tactics.missedMates >= 1) {
    recs.push({
      area: 'Checkmate patterns',
      severity: tactics.missedMates >= 3 ? 'high' : 'medium',
      why: `${tactics.missedMates} forced mate(s) were missed in analyzed games.`,
      themes: t(['mateIn1', 'mateIn2', 'backRankMate', 'mate']),
      drills: ['Do 10 mate-in-1 and 10 mate-in-2 puzzles daily for two weeks — pattern recognition compounds fast.'],
    });
  }

  if (tactics.missedTactics >= 2 || tactics.blundersTotal >= 3) {
    recs.push({
      area: 'Tactical awareness & board vision',
      severity: 'high',
      why: `${tactics.blundersTotal} blunder(s) and ${tactics.missedTactics} missed tactic(s) (engine's best move was a capture/check that went unplayed).`,
      themes: t(['hangingPiece', 'fork', 'skewer', 'crushing']),
      drills: [
        'Adopt a pre-move checklist: checks, captures, threats — for BOTH sides.',
        'Puzzle Streak / Puzzle Rush 5 minutes daily.',
      ],
    });
  }

  if (patterns.lostFromWinning.length >= 1 || (patterns.conversionRate !== null && patterns.conversionRate < 70 && patterns.gamesReachedWinning >= 3)) {
    recs.push({
      area: 'Converting winning positions',
      severity: patterns.lostFromWinning.length >= 2 ? 'high' : 'medium',
      why: `${patterns.lostFromWinning.length} win(s) thrown away; conversion rate from winning positions is ${patterns.conversionRate ?? '—'}%.`,
      themes: t(['advantage', 'crushing', 'defensiveMove', 'quietMove']),
      drills: [
        'When winning: trade pieces, not pawns; keep asking "what is my opponent\'s only hope?"',
        'Play out +2 positions from your games vs an engine until you win 5 in a row.',
      ],
    });
  }

  if (patterns.timePressureBlunders >= 2) {
    recs.push({
      area: 'Time management',
      severity: 'medium',
      why: `${patterns.timePressureBlunders} serious errors came with under 30s on the clock.`,
      themes: t(['middlegame']),
      drills: [
        'Set a personal rule: never below 50% of the opponent\'s clock before move 20.',
        'Train at one time control slower than your usual (e.g. 15+10 instead of 10+0).',
      ],
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
