/**
 * FIDE (Standard) rating estimator — an unofficial approximation of the published FIDE rating
 * formula (FIDE Handbook B.02): win expectancy on the logistic curve with the 400-point cap, and
 * a K-factor that's a flat tier lookup by rating (rather than USCF's dynamic N+games formula).
 * FIDE's Standard rating has no bonus-points provision.
 *
 * Simplified to rating-only K-factor tiers (no prior-games or age input): this assumes an
 * established player. FIDE also uses K=40 for a player's first 30 rated games regardless of
 * rating, which isn't modeled here since that requires knowing the games-played count.
 */

export interface FideEstimateInput {
  currentRating: number;
  totalScore: number;
  opponentRatings: number[]; // 1-15 entries
}

export interface FideEstimateResult {
  gamesCounted: number;
  winExpectancy: number;
  kFactor: number;
  kTierLabel: string;
  ratingChange: number;
  newRating: number;
  performanceRating: number;
  notes: string[];
}

export type FideEstimateOutcome =
  | { ok: true; result: FideEstimateResult }
  | { ok: false; error: string };

const MIN_RATING = 100;
const MAX_RATING = 3000;
const HIGH_RATING_THRESHOLD = 2400;
const RATING_DIFF_CAP = 400;
const FIDE_PUBLISH_FLOOR = 1400;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function winExpectancy(playerRating: number, opponentRating: number): number {
  const diff = clamp(playerRating - opponentRating, -RATING_DIFF_CAP, RATING_DIFF_CAP);
  return 1 / (1 + Math.pow(10, -diff / 400));
}

function kFactorFor(currentRating: number): { k: number; label: string } {
  if (currentRating >= HIGH_RATING_THRESHOLD) {
    return { k: 10, label: `Rated ${HIGH_RATING_THRESHOLD}+` };
  }
  return { k: 20, label: `Rated below ${HIGH_RATING_THRESHOLD}` };
}

export function estimateFideRating(input: FideEstimateInput): FideEstimateOutcome {
  const { currentRating, totalScore } = input;
  const opponents = input.opponentRatings.filter((r) => Number.isFinite(r));

  if (!Number.isFinite(currentRating) || currentRating < MIN_RATING || currentRating > MAX_RATING) {
    return { ok: false, error: `Current rating must be between ${MIN_RATING} and ${MAX_RATING}.` };
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
  const n = opponents.length;
  if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > n) {
    return { ok: false, error: `Total score must be between 0 and ${n} (the number of opponents entered).` };
  }

  const notes: string[] = [
    'Assumes an established rating. FIDE uses K=40 for a player\'s first 30 rated games regardless of rating — not modeled here.',
  ];
  const { k, label } = kFactorFor(currentRating);

  const we = opponents.reduce((sum, opp) => sum + winExpectancy(currentRating, opp), 0);
  const ratingChange = k * (totalScore - we);
  const newRating = currentRating + ratingChange;

  if (newRating < FIDE_PUBLISH_FLOOR) {
    notes.push(`FIDE does not publish Standard ratings below ${FIDE_PUBLISH_FLOOR} — this estimate is shown for reference only.`);
  }

  const avgOpponent = opponents.reduce((a, b) => a + b, 0) / n;
  const performanceRating = avgOpponent + 400 * (2 * (totalScore / n) - 1);

  return {
    ok: true,
    result: {
      gamesCounted: n,
      winExpectancy: Math.round(we * 100) / 100,
      kFactor: k,
      kTierLabel: label,
      ratingChange: Math.round(ratingChange * 10) / 10,
      newRating: Math.round(newRating),
      performanceRating: Math.round(performanceRating),
      notes,
    },
  };
}
