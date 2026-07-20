/**
 * A small, simplified spaced-repetition scheduler (SM-2-lite: binary correct/incorrect instead of
 * SM-2's 0–5 quality scale, everything else the same shape) for drilling opening-tree positions.
 * Pure logic, no DOM, no localStorage I/O — src/openingTrainer.ts owns persistence and UI.
 */

export interface SrsCard {
  intervalDays: number;
  easeFactor: number;
  reps: number;
  lapses: number;
  dueAt: string; // ISO date (day precision)
}

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function newCard(now: Date = new Date()): SrsCard {
  return { intervalDays: 0, easeFactor: 2.5, reps: 0, lapses: 0, dueAt: now.toISOString() };
}

export function isDue(card: SrsCard, now: Date = new Date()): boolean {
  return new Date(card.dueAt).getTime() <= now.getTime();
}

/** Apply one review outcome, returning the updated card (does not mutate the input). */
export function review(card: SrsCard, correct: boolean, now: Date = new Date()): SrsCard {
  // Defends against corrupted stored data (hand-edited localStorage, a schema mismatch after an
  // update) producing a non-finite field here — left unguarded, a NaN interval/ease would
  // propagate into an invalid Date and throw on .toISOString(), silently freezing the drill UI
  // with no error surfaced (the click handler that calls this has no try/catch of its own).
  const safeInterval = Number.isFinite(card.intervalDays) ? card.intervalDays : 0;
  const safeEase = Number.isFinite(card.easeFactor) ? card.easeFactor : 2.5;
  const safeReps = Number.isFinite(card.reps) ? card.reps : 0;
  const safeLapses = Number.isFinite(card.lapses) ? card.lapses : 0;
  if (correct) {
    const reps = safeReps + 1;
    const easeFactor = Math.max(MIN_EASE, safeEase + 0.1);
    const intervalDays = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(safeInterval * safeEase);
    return { intervalDays, easeFactor, reps, lapses: safeLapses, dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString() };
  }
  return {
    intervalDays: 1,
    easeFactor: Math.max(MIN_EASE, safeEase - 0.2),
    reps: 0,
    lapses: safeLapses + 1,
    dueAt: new Date(now.getTime() + DAY_MS).toISOString(),
  };
}
