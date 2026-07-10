/**
 * US Chess (USCF) rating estimator — implements the published rating formula from
 * "The US Chess Rating System" (Glickman & Doan, rev. Sept 2020), Section 3 (effective
 * number of games) and Section 4.2 (standard rating formula, incl. dual-rated K and the
 * bonus provision, bonus multiplier B=10 effective 2025-06-03). Players with 8 or fewer
 * prior games use the simplified "special" formula (Section 4.1) rather than the full
 * iterative linear-programming solve, per the document's own note that this single-step
 * approximation is "usually identical" to the full result. US Chess's actual computation
 * also folds in opponent-repeat and all-win/all-loss adjustments this tool doesn't track.
 */

export interface RatingEstimateInput {
  currentRating: number;
  totalScore: number;
  priorGames: number;
  age?: number;
  opponentRatings: number[]; // 1-15 entries
  useDualRatedLowerK: boolean;
}

export interface RatingEstimateResult {
  gamesCounted: number;
  winExpectancy: number; // sum of per-game expectancies ("We" / "E")
  kFactor: number;
  effectiveN: number;
  established: boolean;
  baseRatingChange: number;
  bonus: number;
  ratingChange: number;
  newRating: number;
  performanceRating: number;
  notes: string[];
}

export type RatingEstimateOutcome =
  | { ok: true; result: RatingEstimateResult }
  | { ok: false; error: string };

const MIN_RATING = 100;
const MAX_RATING = 3200;
const ESTABLISHED_GAMES = 26; // "established" per US Chess (>25 games) — used for notes only
const SPECIAL_FORMULA_MAX_GAMES = 8; // N <= 8 uses the "special" (provisional) formula
const BONUS_MIN_GAMES = 3; // bonus provision only applies when m >= 3
const BONUS_MULTIPLIER_B = 10; // effective 2025-06-03 (was 12 from 2023, 14 from 2017)
const DUAL_RATED_THRESHOLD = 2200;
const DUAL_RATED_TOP = 2500;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** N* — the rating-dependent ceiling on effective games (Section 3, eq. 1). */
function nStar(rating: number): number {
  if (rating > 2355) return 50;
  return 50 / Math.sqrt(0.662 + 0.00000739 * (2569 - rating) ** 2);
}

/** Standard winning expectancy (Section 4.2) — no rating-difference cap. */
function winExpectancy(playerRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, -(playerRating - opponentRating) / 400));
}

/** K-factor, including the dual-rated (OTB Quick/Regular) override for 2200+ players. */
function kFactor(rating: number, effectiveN: number, m: number, useDualRatedLowerK: boolean, notes: string[]): number {
  if (useDualRatedLowerK && rating > DUAL_RATED_THRESHOLD) {
    if (rating >= DUAL_RATED_TOP) {
      notes.push(`Dual-rated K applied: rating ≥ ${DUAL_RATED_TOP}, using K = 200/(N′+m).`);
      return 200 / (effectiveN + m);
    }
    notes.push(`Dual-rated K applied: using K = 800(6.5 − 0.0025×R)/(N′+m) for ratings between ${DUAL_RATED_THRESHOLD} and ${DUAL_RATED_TOP}.`);
    return (800 * (6.5 - 0.0025 * rating)) / (effectiveN + m);
  }
  if (useDualRatedLowerK) {
    notes.push(`Dual-rated lower-K option is checked, but only applies above ${DUAL_RATED_THRESHOLD} — not used for this rating.`);
  }
  return 800 / (effectiveN + m);
}

export function estimateRating(input: RatingEstimateInput): RatingEstimateOutcome {
  const { currentRating, totalScore, priorGames, age, useDualRatedLowerK } = input;
  const opponents = input.opponentRatings.filter((r) => Number.isFinite(r));

  if (!Number.isFinite(currentRating) || currentRating < MIN_RATING || currentRating > MAX_RATING) {
    return { ok: false, error: `Current rating must be between ${MIN_RATING} and ${MAX_RATING}.` };
  }
  if (!Number.isFinite(priorGames) || priorGames < 0) {
    return { ok: false, error: 'Number of prior games must be zero or more.' };
  }
  if (opponents.length === 0) {
    return { ok: false, error: 'Enter at least one opponent rating.' };
  }
  if (opponents.length > 15) {
    return { ok: false, error: 'Enter at most 15 opponent ratings.' };
  }
  if (opponents.some((r) => r < MIN_RATING || r > MAX_RATING)) {
    return { ok: false, error: `Opponent ratings must be between ${MIN_RATING} and ${MAX_RATING}.` };
  }
  const m = opponents.length;
  if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > m) {
    return { ok: false, error: `Total score must be between 0 and ${m} (the number of opponents entered).` };
  }

  const established = priorGames >= ESTABLISHED_GAMES;
  const notes: string[] = [];

  let we: number;
  let k: number;
  let effectiveN: number;
  let baseChange: number;
  let bonus = 0;

  if (priorGames <= SPECIAL_FORMULA_MAX_GAMES) {
    // Special/provisional formula (Section 4.1), approximated by its single-step estimate —
    // the document notes this matches the full iterative solve in most cases.
    effectiveN = Math.min(priorGames, nStar(currentRating));
    we = opponents.reduce((sum, opp) => sum + winExpectancy(currentRating, opp), 0);
    k = 800 / (effectiveN + m);
    const sumOpponents = opponents.reduce((a, b) => a + b, 0);
    const M = (effectiveN * currentRating + sumOpponents + 400 * (2 * totalScore - m)) / (effectiveN + m);
    baseChange = M - currentRating;
    notes.push(
      `With ${priorGames} prior rated game(s) (≤ ${SPECIAL_FORMULA_MAX_GAMES}), US Chess uses the "special" (provisional) formula, ` +
      `approximated here by its single-step estimate rather than the full iterative solve.`
    );
  } else {
    // Standard formula (Section 4.2).
    effectiveN = Math.min(priorGames, nStar(currentRating));
    we = opponents.reduce((sum, opp) => sum + winExpectancy(currentRating, opp), 0);
    k = kFactor(currentRating, effectiveN, m, useDualRatedLowerK, notes);
    baseChange = k * (totalScore - we);
    if (m >= BONUS_MIN_GAMES) {
      const mPrime = Math.max(m, 4);
      bonus = Math.max(0, baseChange - BONUS_MULTIPLIER_B * Math.sqrt(mPrime));
      if (bonus > 0) notes.push(`Bonus applied (B=${BONUS_MULTIPLIER_B}): scored well above the K(S−E) + B√m′ threshold.`);
    } else {
      notes.push(`Bonus provision requires at least ${BONUS_MIN_GAMES} games in the event — not applicable here.`);
    }
  }

  if (!established) {
    notes.push(`With ${priorGames} prior rated game(s), this player is not yet "established" (fewer than ${ESTABLISHED_GAMES}) under US Chess's definition.`);
  }
  if (age !== undefined && Number.isFinite(age) && age < 20) {
    notes.push('Junior player (under 20) — US Chess scholastic rating floors and related provisions may apply beyond this estimate.');
  }

  const uncappedNewRating = currentRating + baseChange + bonus;
  const newRating = clamp(Math.round(uncappedNewRating), MIN_RATING, 2700);
  const ratingChange = newRating - currentRating;

  const avgOpponent = opponents.reduce((a, b) => a + b, 0) / m;
  let performanceRating: number;
  if (totalScore === 0) {
    performanceRating = avgOpponent - 400;
  } else if (totalScore === m) {
    performanceRating = avgOpponent + 400;
  } else {
    performanceRating = avgOpponent + 400 * Math.log10(totalScore / (m - totalScore));
  }

  return {
    ok: true,
    result: {
      gamesCounted: m,
      winExpectancy: Math.round(we * 100) / 100,
      kFactor: Math.round(k * 10) / 10,
      effectiveN: Math.round(effectiveN * 10) / 10,
      established,
      baseRatingChange: Math.round(baseChange * 10) / 10,
      bonus: Math.round(bonus * 10) / 10,
      ratingChange,
      newRating,
      performanceRating: Math.round(performanceRating),
      notes,
    },
  };
}
