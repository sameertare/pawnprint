import type { ErrCounts, GameRecord, Phase } from './types';
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
  summary: string;  // one or two sentences, specific numbers included
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

function assessPhase(g: GameRecord, phase: Phase, opening?: OpeningRow): PhaseAssessment {
  const accuracy = g.accuracy[phase];
  const errors = g.errors[phase];
  const reached = phase === 'opening' || (phase === 'middlegame' ? true : g.reachedEndgame);
  const isDecisive = g.decisiveErrorPhase === phase;

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
  const blunderNote = errors.blunders > 0 ? `, ${errors.blunders} blunder${errors.blunders === 1 ? '' : 's'}` : '';
  const mistakeNote = errors.mistakes > 0 ? `, ${errors.mistakes} mistake${errors.mistakes === 1 ? '' : 's'}` : '';
  const decisiveNote = isDecisive && g.decisiveErrorMove != null ? ` This is where the game turned (move ${g.decisiveErrorMove}).` : '';

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
      summary = `${accuracy}% accuracy${mistakeNote ? mistakeNote : ', no serious errors'} — left theory in good shape.${prepNote}`;
    } else if (b === 'weak' || errors.blunders > 0 || isDecisive) {
      verdict = 'weakness';
      summary = `${accuracy}% accuracy${blunderNote}${mistakeNote} in the opening.${decisiveNote}${prepNote}`;
    } else {
      verdict = 'neutral';
      summary = `${accuracy}% accuracy — playable but not sharp.${prepNote}`;
    }
    return { phase, verdict, accuracy, errors, reached, summary };
  }

  if (phase === 'middlegame') {
    if ((b === 'excellent' || b === 'solid') && errors.blunders === 0 && !isDecisive) {
      verdict = 'strength';
      summary = `${accuracy}% accuracy${mistakeNote ? mistakeNote : ', no blunders'} — calculation held up under pressure.`;
    } else if (b === 'weak' || errors.blunders > 0 || isDecisive) {
      verdict = 'weakness';
      summary = `${accuracy}% accuracy${blunderNote}${mistakeNote} in the middlegame.${decisiveNote}`;
    } else {
      verdict = 'neutral';
      summary = `${accuracy}% accuracy — solid without being sharp.`;
    }
    return { phase, verdict, accuracy, errors, reached, summary };
  }

  // endgame
  const typeNote = g.endgameType ? ` (${g.endgameType})` : '';
  if ((b === 'excellent' || b === 'solid') && errors.blunders === 0 && !isDecisive) {
    verdict = 'strength';
    summary = `${accuracy}% accuracy${typeNote}${mistakeNote ? mistakeNote : ''} — technique held up.`;
  } else if (b === 'weak' || errors.blunders > 0 || isDecisive) {
    verdict = 'weakness';
    summary = `${accuracy}% accuracy${typeNote}${blunderNote}${mistakeNote}.${decisiveNote}`;
  } else {
    verdict = 'neutral';
    summary = `${accuracy}% accuracy${typeNote} — adequate but not precise.`;
  }
  return { phase, verdict, accuracy, errors, reached, summary };
}

/** Per-game strength/weakness/overall assessment, derived entirely from the already-computed
 *  GameRecord fields (accuracy and errors per phase, worst moves, decisive-error phase, endgame
 *  type). No re-analysis — same philosophy as the rest of the app's post-hoc explanations. Pass
 *  the game's OpeningRow (from computeOpenings) to enrich the opening verdict with repertoire
 *  context; omit it and the opening assessment still works, just without that one sentence. */
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
  if (g.missedMates > 0) {
    weaknesses.push(`Missed ${g.missedMates} forced mate${g.missedMates === 1 ? '' : 's'}.`);
  }
  if (g.missedTactics > 0) {
    weaknesses.push(`Missed ${g.missedTactics} tactic${g.missedTactics === 1 ? '' : 's'} (engine's best move was an unplayed capture/check).`);
  }
  const totalBlunders = PHASES.reduce((s, p) => s + g.errors[p].blunders, 0);
  const totalErrors = errTotal(g.errors.opening) + errTotal(g.errors.middlegame) + errTotal(g.errors.endgame);
  if (totalBlunders === 0 && totalErrors <= 1 && weaknesses.length === 0) {
    strengths.push('Clean game overall — at most one flagged inaccuracy across the whole game.');
  }

  // Overall: lead with result + accuracy, then the single biggest factor (decisive phase, or
  // conversion/resilience if that's what actually decided the outcome).
  const acc = g.accuracy.overall;
  const resultWord = g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : g.result === 'draw' ? 'Draw' : 'Unfinished game';
  const colorWord = g.userColor === 'w' ? 'White' : 'Black';
  const accText = acc != null ? `${acc}% overall accuracy (${band(acc)})` : 'no overall accuracy available';
  let driver = '';
  if (g.lostFromWinning) {
    driver = ` The result hinges on conversion — a winning position (${g.bestWinPct}% win chance) wasn't closed out.`;
  } else if (g.savedFromLosing) {
    driver = ' A losing position was defended into a better result — resilience carried this one.';
  } else if (g.decisiveErrorPhase) {
    const dp = phases.find((p) => p.phase === g.decisiveErrorPhase);
    driver = ` The ${g.decisiveErrorPhase}${dp?.accuracy != null ? ` (${dp.accuracy}% accuracy)` : ''} was the deciding factor${g.decisiveErrorMove != null ? `, around move ${g.decisiveErrorMove}` : ''}.`;
  } else if (strengths.length && !weaknesses.length) {
    driver = ' A consistent performance across all phases.';
  }
  const overall = `${resultWord} as ${colorWord}, ${g.family || 'unspecified opening'}. ${accText}.${driver}`;

  return { overall, strengths, weaknesses, phases };
}
