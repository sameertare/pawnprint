import type { ErrCounts, GameRecord, Phase, WorstMove } from './types';
import type { OpeningRow } from './aggregate';

const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];
const PHASE_LABEL: Record<Phase, string> = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };

export type Verdict = 'strength' | 'weakness' | 'neutral';

export interface PhaseAssessment {
  phase: Phase;
  verdict: Verdict;
  accuracy: number | null;
  errors: ErrCounts;
  reached: boolean; // false only for a middlegame/endgame the game never got to
  summary: string;  // one or two sentences, citing the actual flagged move(s) when the engine has one
}

export interface GameAssessment {
  overall: string;
  strengths: string[];
  weaknesses: string[];
  phases: PhaseAssessment[]; // always opening, middlegame, endgame in order
}

/** Accuracy band matching the common chess.com/lichess convention, used consistently across
 *  every phase and the overall figure so "strong"/"weak" means the same thing everywhere. */
function band(acc: number): 'excellent' | 'solid' | 'shaky' | 'weak' {
  if (acc >= 90) return 'excellent';
  if (acc >= 80) return 'solid';
  if (acc >= 70) return 'shaky';
  return 'weak';
}

function errTotal(e: ErrCounts): number {
  return e.inaccuracies + e.mistakes + e.blunders;
}

/** Turns one engine-flagged move into a concrete, game-specific sentence fragment — the actual
 *  move played, what it cost in win chance, and what the engine wanted instead. This is the
 *  dynamic, per-game detail a plain accuracy/error-count summary can't give you. */
function describeMove(m: WorstMove): string {
  const swing = Math.max(0, Math.round(m.winPctBefore - m.winPctAfter));
  const kindPhrase =
    m.kind === 'missed win' ? 'let a winning advantage slip'
    : m.kind === 'missed mate' ? 'missed a forced mate'
    : m.kind === 'blunder' ? 'was a blunder'
    : 'was a mistake';
  const bestNote = m.best ? ` (${m.best} kept the advantage)` : '';
  return `**${m.san}** on move ${m.moveNo} ${kindPhrase}${bestNote} — win chance dropped ${swing} point${swing === 1 ? '' : 's'} (${m.winPctBefore}% → ${m.winPctAfter}%)`;
}

function assessPhase(g: GameRecord, phase: Phase, opening?: OpeningRow): PhaseAssessment {
  const accuracy = g.accuracy[phase];
  const errors = g.errors[phase];
  const reached = phase === 'opening' || (phase === 'middlegame' ? true : g.reachedEndgame);
  const isDecisive = g.decisiveErrorPhase === phase;
  // Every engine-flagged move the game record kept for this phase — at minimum the single worst
  // one per phase, so a weak phase almost always has something concrete to point to.
  const phaseMoves = g.worstMoves.filter((m) => m.phase === phase);

  if (!reached) {
    const endedPhase = g.accuracy.middlegame != null || errTotal(g.errors.middlegame) > 0 ? 'middlegame' : 'opening';
    return {
      phase, verdict: 'neutral', accuracy: null, errors, reached,
      summary: `Endgame not reached — the game ended during the ${endedPhase}.`,
    };
  }
  if (accuracy == null) {
    return {
      phase, verdict: 'neutral', accuracy: null, errors, reached,
      summary: `Not enough moves in the ${PHASE_LABEL[phase].toLowerCase()} to assess (too few positions with move-quality data).`,
    };
  }

  const b = band(accuracy);
  const moveDetail = phaseMoves.length ? ` ${phaseMoves.map(describeMove).join('; ')}.` : '';
  const decisiveFlag = isDecisive && g.decisiveErrorMove != null && !phaseMoves.some((m) => m.moveNo === g.decisiveErrorMove)
    ? ` This is where the game turned (move ${g.decisiveErrorMove}).`
    : '';

  let verdict: Verdict;
  let summary: string;

  if (phase === 'opening') {
    const prepNote = opening && opening.games >= 2
      ? ` This is a repeated line for you (${opening.games} games, ${opening.avgAccuracy ?? '—'}% avg accuracy).`
      : opening
        ? ' A one-off line — not yet part of your repertoire.'
        : '';
    if ((b === 'excellent' || b === 'solid') && errors.blunders === 0 && !isDecisive) {
      verdict = 'strength';
      summary = `${accuracy}% accuracy, no serious errors — left theory in good shape.${prepNote}`;
    } else if (b === 'weak' || errors.blunders > 0 || isDecisive) {
      verdict = 'weakness';
      summary = `${accuracy}% accuracy in the opening.${moveDetail}${decisiveFlag}${prepNote}`;
    } else {
      verdict = 'neutral';
      summary = `${accuracy}% accuracy — playable but not sharp.${moveDetail}${prepNote}`;
    }
    return { phase, verdict, accuracy, errors, reached, summary };
  }

  if (phase === 'middlegame') {
    if ((b === 'excellent' || b === 'solid') && errors.blunders === 0 && !isDecisive) {
      verdict = 'strength';
      summary = `${accuracy}% accuracy, no blunders — calculation held up under pressure.`;
    } else if (b === 'weak' || errors.blunders > 0 || isDecisive) {
      verdict = 'weakness';
      summary = `${accuracy}% accuracy in the middlegame.${moveDetail}${decisiveFlag}`;
    } else {
      verdict = 'neutral';
      summary = `${accuracy}% accuracy — solid without being sharp.${moveDetail}`;
    }
    return { phase, verdict, accuracy, errors, reached, summary };
  }

  // endgame
  const typeNote = g.endgameType ? ` (${g.endgameType})` : '';
  if ((b === 'excellent' || b === 'solid') && errors.blunders === 0 && !isDecisive) {
    verdict = 'strength';
    summary = `${accuracy}% accuracy${typeNote} — technique held up.`;
  } else if (b === 'weak' || errors.blunders > 0 || isDecisive) {
    verdict = 'weakness';
    summary = `${accuracy}% accuracy${typeNote}.${moveDetail}${decisiveFlag}`;
  } else {
    verdict = 'neutral';
    summary = `${accuracy}% accuracy${typeNote} — adequate but not precise.${moveDetail}`;
  }
  return { phase, verdict, accuracy, errors, reached, summary };
}

/** Per-game strength/weakness/overall assessment, derived entirely from the already-computed
 *  GameRecord fields — accuracy/errors per phase, the actual engine-flagged moves (SAN, move
 *  number, win%-swing, engine's suggested best move), decisive-error phase, and endgame type.
 *  No re-analysis — same post-hoc philosophy as the rest of the app's explanations, but grounded
 *  in specific moves from this game rather than aggregate counts alone. Pass the game's
 *  OpeningRow (from computeOpenings) to enrich the opening verdict with repertoire context; omit
 *  it and the opening assessment still works, just without that one sentence. */
export function assessGame(g: GameRecord, opening?: OpeningRow): GameAssessment | null {
  if (!g.analyzed) return null;

  const phases = PHASES.map((p) => assessPhase(g, p, p === 'opening' ? opening : undefined));
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  for (const p of phases) {
    if (p.verdict === 'strength') strengths.push(`${PHASE_LABEL[p.phase]}: ${p.summary}`);
    if (p.verdict === 'weakness') weaknesses.push(`${PHASE_LABEL[p.phase]}: ${p.summary}`);
  }

  if (g.savedFromLosing) {
    strengths.push(`Resilience: defended a losing position (down to ${g.worstWinPct}% win chance) and salvaged a ${g.result === 'win' ? 'win' : 'draw'}.`);
  }
  if (g.lostFromWinning) {
    weaknesses.push(`Conversion: reached a winning position (peaked at ${g.bestWinPct}% win chance) but let it slip to a loss.`);
  } else if (g.drewFromWinning) {
    weaknesses.push(`Conversion: reached a winning position (peaked at ${g.bestWinPct}% win chance) but only drew.`);
  }

  // Every missed win/mate the game record kept a move for, cited once each — the phase summaries
  // above already wove in whichever of these fell inside a weakness/neutral phase (a 'strength'
  // verdict's summary is a fixed sentence with no move detail, so its moves wouldn't be cited yet).
  const citedMoveNos = new Set(
    phases.filter((p) => p.verdict !== 'strength').flatMap((p) => g.worstMoves.filter((m) => m.phase === p.phase).map((m) => m.moveNo))
  );
  const missedMateMoves = g.worstMoves.filter((m) => m.kind === 'missed mate' && !citedMoveNos.has(m.moveNo));
  const missedWinMoves = g.worstMoves.filter((m) => m.kind === 'missed win' && !citedMoveNos.has(m.moveNo));
  for (const m of missedMateMoves) weaknesses.push(`Missed mate: ${describeMove(m)}.`);
  for (const m of missedWinMoves) weaknesses.push(`Missed win: ${describeMove(m)}.`);
  const shownMissedMates = g.worstMoves.filter((m) => m.kind === 'missed mate').length;
  if (g.missedMates > shownMissedMates) {
    weaknesses.push(`${g.missedMates} forced mate(s) missed in total (only the largest shown above).`);
  }
  if (g.missedTactics > 0) {
    weaknesses.push(`Missed ${g.missedTactics} tactic${g.missedTactics === 1 ? '' : 's'} overall (engine's best move was an unplayed capture/check).`);
  }

  const totalBlunders = PHASES.reduce((s, p) => s + g.errors[p].blunders, 0);
  const totalErrors = errTotal(g.errors.opening) + errTotal(g.errors.middlegame) + errTotal(g.errors.endgame);
  if (totalBlunders === 0 && totalErrors <= 1 && weaknesses.length === 0) {
    strengths.push('Clean game overall — at most one flagged inaccuracy across the whole game.');
  }

  // Overall: lead with result + accuracy, then the single biggest factor (decisive phase, cited
  // by its actual move if the engine flagged one, or conversion/resilience if that's what really
  // decided the outcome).
  const acc = g.accuracy.overall;
  const resultWord = g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : g.result === 'draw' ? 'Draw' : 'Unfinished game';
  const colorWord = g.userColor === 'w' ? 'White' : 'Black';
  const accText = acc != null ? `${acc}% overall accuracy (${band(acc)})` : 'no overall accuracy available';
  let driver = '';
  const worstMove = g.worstMoves[0]; // globally biggest swing, if any
  if (g.lostFromWinning) {
    driver = ` The result hinges on conversion — a winning position (${g.bestWinPct}% win chance) wasn't closed out.`;
  } else if (g.savedFromLosing) {
    driver = ' A losing position was defended into a better result — resilience carried this one.';
  } else if (worstMove && g.decisiveErrorPhase) {
    driver = ` The turning point: ${describeMove(worstMove)}, in the ${g.decisiveErrorPhase}.`;
  } else if (g.decisiveErrorPhase) {
    const dp = phases.find((p) => p.phase === g.decisiveErrorPhase);
    driver = ` The ${g.decisiveErrorPhase}${dp?.accuracy != null ? ` (${dp.accuracy}% accuracy)` : ''} was the deciding factor${g.decisiveErrorMove != null ? `, around move ${g.decisiveErrorMove}` : ''}.`;
  } else if (strengths.length && !weaknesses.length) {
    driver = ' A consistent performance across all phases.';
  }
  const overall = `${resultWord} as ${colorWord}, ${g.family || 'unspecified opening'}. ${accText}.${driver}`;

  return { overall, strengths, weaknesses, phases };
}
