// 'unknown' is an unfinished/undecided game (PGN Result "*" or missing) — not a draw, and
// excluded from win/loss/draw tallies since there's no decided outcome to count.
export type Result = 'win' | 'loss' | 'draw' | 'unknown';
export type Phase = 'opening' | 'middlegame' | 'endgame';
export type Color = 'w' | 'b';

export interface ErrCounts {
  inaccuracies: number;
  mistakes: number;
  blunders: number;
}

export interface WorstMove {
  moveNo: number;       // full-move number
  san: string;
  phase: Phase;
  kind: 'blunder' | 'mistake' | 'missed win' | 'missed mate';
  winPctBefore: number; // user perspective
  winPctAfter: number;
  best?: string;        // engine best move (SAN) if known
}

/** Everything needed to rebuild every aggregate — persisted in the .md report. */
export interface GameRecord {
  id: string;
  date: string;
  site: string;
  event: string;
  white: string;
  black: string;
  userColor: Color;
  result: Result;
  resultRaw: string;      // "1-0" etc.
  termination: string;
  eco: string;
  opening: string;        // full opening name
  family: string;         // opening family (before ":" / first comma)
  timeControl: string;
  timeClass: string;      // Bullet | Blitz | Rapid | Classical | Daily | Unknown
  moveCount: number;      // plies played by user
  analyzed: boolean;      // engine or %eval based move-quality data available
  evalSource: 'engine' | 'pgn' | 'none';
  engineDepth?: number;
  accuracy: {
    overall: number | null;
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  errors: Record<Phase, ErrCounts>;
  missedWins: number;
  missedMates: number;
  missedTactics: number;    // engine best was a big-gain capture/check the user didn't play
  bestWinPct: number;       // peak win% the user reached
  worstWinPct: number;
  lostFromWinning: boolean; // was >= WINNING_WINPCT at some point, then lost
  drewFromWinning: boolean;
  savedFromLosing: boolean; // was <= LOSING_WINPCT, then drew/won
  decisiveErrorPhase: Phase | null;
  decisiveErrorMove: number | null;
  firstErrorMove: number | null;
  reachedEndgame: boolean;
  endgameType: string | null;   // e.g. "Rook endgame", "Pawn endgame"
  clockDataAvailable: boolean;
  timePressureBlunders: number; // blunders/mistakes played with < 30s on the clock
  clockSeries: { moveNo: number; sec: number; phase?: Phase }[]; // seconds remaining after each of the user's moves, in order
  errorSeries: { moveNo: number; kind: 'inaccuracy' | 'mistake' | 'blunder'; phase?: Phase }[]; // every flagged move, in order
  worstMoves: WorstMove[];
  evalGraph: number[] | null; // white-perspective cp per ply (start position + after each move), clamped for charting; null if not analyzed
  sans: string[]; // SAN for every ply, for reconstructing an annotated PGN on export
}

export interface ReportMeta {
  username: string;
  createdAt: string;   // ISO
  updatedAt: string;
  sessions: { date: string; gamesAdded: number; source: string }[];
}

export interface ReportData {
  version: 1;
  meta: ReportMeta;
  games: GameRecord[];
}
