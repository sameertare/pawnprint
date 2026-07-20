/** Advanced analysis features: move time analysis, blunder clustering, opening prep stats. */

import type { GameRecord, Phase } from './types';

/** Approximates phase from move number alone — only used as a fallback for reports saved before
 *  clockSeries/errorSeries entries carried their own authoritative (piece-count-based) phase. */
function fallbackPhase(moveNo: number): Phase {
  if (moveNo <= 12) return 'opening';
  if (moveNo > 18) return 'endgame';
  return 'middlegame';
}

export interface TimePhaseStats {
  phase: 'opening' | 'middlegame' | 'endgame';
  avgSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  movesUnderThreshold: number;  // moves with <30s
  totalMoves: number;
}

export interface BlunderCluster {
  moveRange: [number, number];   // move numbers where blunders clustered
  count: number;
  phase: 'opening' | 'middlegame' | 'endgame' | 'mixed';
}

/** Analyze time distribution across game phases from clock series. */
export function analyzeTimeByPhase(games: GameRecord[]): TimePhaseStats[] {
  const phases: Record<string, { times: number[]; moveCount: number }> = {
    opening: { times: [], moveCount: 0 },
    middlegame: { times: [], moveCount: 0 },
    endgame: { times: [], moveCount: 0 },
  };

  for (const g of games) {
    if (!g.clockDataAvailable || !g.clockSeries.length) continue;
    for (const { moveNo, sec, phase: recorded } of g.clockSeries) {
      const phase = recorded ?? fallbackPhase(moveNo);
      phases[phase].times.push(sec);
      phases[phase].moveCount++;
    }
  }

  return Object.entries(phases).map(([phase, data]) => {
    const times = data.times;
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    const underThreshold = times.filter((t) => t < 30).length;
    return {
      phase: phase as 'opening' | 'middlegame' | 'endgame',
      avgSeconds: Math.round(avg),
      minSeconds: times.length ? Math.min(...times) : 0,
      maxSeconds: times.length ? Math.max(...times) : 0,
      movesUnderThreshold: underThreshold,
      totalMoves: data.moveCount,
    };
  });
}

/** Detect clustering of blunders by move number. */
export function findBlunderClusters(games: GameRecord[]): BlunderCluster[] {
  const blundersByMove = new Map<number, { count: number; phases: Set<Phase> }>();
  for (const g of games) {
    for (const err of g.errorSeries) {
      if (err.kind === 'blunder') {
        const entry = blundersByMove.get(err.moveNo) ?? { count: 0, phases: new Set<Phase>() };
        entry.count++;
        entry.phases.add(err.phase ?? fallbackPhase(err.moveNo));
        blundersByMove.set(err.moveNo, entry);
      }
    }
  }

  if (!blundersByMove.size) return [];

  const moves = Array.from(blundersByMove.keys()).sort((a, b) => a - b);
  const clusters: BlunderCluster[] = [];

  // A cluster's phase is the phase every blunder in it actually occurred in (from the real,
  // piece-count-based phase recorded per move) — 'mixed' only when they genuinely span phases,
  // rather than guessing a single phase from the cluster's first move number.
  const finalizeCluster = (moveNos: number[]) => {
    const total = moveNos.reduce((sum, m) => sum + (blundersByMove.get(m)?.count ?? 0), 0);
    if (total < 2) return;
    const phases = new Set<Phase>();
    for (const m of moveNos) for (const p of blundersByMove.get(m)!.phases) phases.add(p);
    const phase: BlunderCluster['phase'] = phases.size === 1 ? [...phases][0] : 'mixed';
    clusters.push({ moveRange: [moveNos[0], moveNos[moveNos.length - 1]], count: total, phase });
  };

  let currentCluster: number[] = [moves[0]];
  for (let i = 1; i < moves.length; i++) {
    // Cluster if within 2 moves of the previous.
    if (moves[i] - moves[i - 1] <= 2) {
      currentCluster.push(moves[i]);
    } else {
      finalizeCluster(currentCluster);
      currentCluster = [moves[i]];
    }
  }
  finalizeCluster(currentCluster);

  return clusters;
}

