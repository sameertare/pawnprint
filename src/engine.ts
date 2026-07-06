/** Thin promise wrapper around the single-threaded Stockfish 18 (lite) WASM worker. */

// Base-path aware so it resolves correctly under a subpath (e.g. GitHub Pages project sites).
export const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-18-lite-single.js`;
export const ENGINE_NAME = 'Stockfish 18 (lite, single-threaded)';

export interface EngineEval {
  cp: number;             // centipawns from the side-to-move's perspective (mate mapped to ±(10000-n))
  mateIn: number | null;  // >0 mate for side to move, <0 getting mated
  bestmove: string | null;// UCI, null at game-over positions
  pv: string[];           // principal variation (UCI moves), best line first
  depth: number;          // depth actually reached
}

export class Engine {
  private worker: Worker;
  private ready: Promise<void>;
  private busy = false;
  // Serializes every search through this worker — UCI doesn't support overlapping `go` commands,
  // so a second caller (e.g. multi-PV candidates while the background pump is mid-search) must
  // wait its turn rather than racing and garbling both results.
  private queue: Promise<void> = Promise.resolve();
  private multiPvSet = 1;

  constructor(url: string = ENGINE_URL) {
    this.worker = new Worker(url);
    this.ready = new Promise<void>((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (String(e.data) === 'uciok') {
          this.worker.removeEventListener('message', onMsg);
          resolve();
        }
      };
      this.worker.addEventListener('message', onMsg);
      this.worker.postMessage('uci');
    });
  }

  async init(): Promise<void> {
    await this.ready;
    this.worker.postMessage('setoption name Threads value 1');
    this.worker.postMessage('setoption name Hash value 64');
    this.worker.postMessage('isready');
    await this.waitFor('readyok');
  }

  private waitFor(token: string): Promise<void> {
    return new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (String(e.data).startsWith(token)) {
          this.worker.removeEventListener('message', onMsg);
          resolve();
        }
      };
      this.worker.addEventListener('message', onMsg);
    });
  }

  private setMultiPv(n: number) {
    if (this.multiPvSet === n) return;
    this.worker.postMessage(`setoption name MultiPV value ${n}`);
    this.multiPvSet = n;
  }

  /** Run `job` after any prior queued search completes, keeping searches strictly sequential. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job);
    this.queue = result.then(
      () => undefined,
      () => undefined // don't let one failed search jam the queue for later callers
    );
    return result;
  }

  /**
   * Evaluate a position. Score is from the side-to-move's perspective.
   * `onInfo` streams intermediate depth updates (for live UIs).
   */
  evaluate(
    fen: string,
    depth: number,
    onInfo?: (partial: EngineEval) => void
  ): Promise<EngineEval> {
    return this.enqueue(() => {
      this.setMultiPv(1);
      this.busy = true;
      return new Promise((resolve) => {
        let lastCp = 0;
        let lastMate: number | null = null;
        let lastPv: string[] = [];
        let lastDepth = 0;
        const onMsg = (e: MessageEvent) => {
          const line = String(e.data);
          if (line.startsWith('info') && line.includes(' score ')) {
            // Defensive: ignore any stray non-primary multipv line (shouldn't occur once
            // setMultiPv(1) above has taken effect, but a search started just before it did
            // could still emit one).
            const mMulti = line.match(/ multipv (\d+)/);
            if (mMulti && mMulti[1] !== '1') return;
            const mDepth = line.match(/ depth (\d+)/);
            const mCp = line.match(/score cp (-?\d+)/);
            const mMate = line.match(/score mate (-?\d+)/);
            const mPv = line.match(/ pv (.+)$/);
            if (mDepth) lastDepth = parseInt(mDepth[1], 10);
            if (mMate) {
              const n = parseInt(mMate[1], 10);
              lastMate = n;
              lastCp = n > 0 ? 10000 - n : -10000 - n;
            } else if (mCp) {
              lastMate = null;
              lastCp = parseInt(mCp[1], 10);
            }
            if (mPv) lastPv = mPv[1].trim().split(/\s+/);
            onInfo?.({ cp: lastCp, mateIn: lastMate, bestmove: lastPv[0] ?? null, pv: lastPv, depth: lastDepth });
          } else if (line.startsWith('bestmove')) {
            this.worker.removeEventListener('message', onMsg);
            this.busy = false;
            const bm = line.split(/\s+/)[1];
            resolve({
              cp: lastCp,
              mateIn: lastMate,
              bestmove: bm && bm !== '(none)' ? bm : null,
              pv: lastPv,
              depth: lastDepth,
            });
          }
        };
        this.worker.addEventListener('message', onMsg);
        this.worker.postMessage('position fen ' + fen);
        this.worker.postMessage('go depth ' + depth);
      });
    });
  }

  /**
   * Evaluate a position and return the top `multiPv` candidate lines (rank 1 = best), for
   * "show me the top few moves" UIs. Sequenced through the same queue as `evaluate`.
   */
  evaluateMultiPv(fen: string, depth: number, multiPv: number): Promise<EngineEval[]> {
    return this.enqueue(() => {
      this.setMultiPv(multiPv);
      this.busy = true;
      return new Promise((resolve) => {
        const lines = new Map<number, EngineEval>();
        const onMsg = (e: MessageEvent) => {
          const line = String(e.data);
          if (line.startsWith('info') && line.includes(' score ') && line.includes(' multipv ')) {
            const mIdx = line.match(/ multipv (\d+)/)!;
            const idx = parseInt(mIdx[1], 10);
            const mDepth = line.match(/ depth (\d+)/);
            const mCp = line.match(/score cp (-?\d+)/);
            const mMate = line.match(/score mate (-?\d+)/);
            const mPv = line.match(/ pv (.+)$/);
            let cp = lines.get(idx)?.cp ?? 0;
            let mate: number | null = lines.get(idx)?.mateIn ?? null;
            if (mMate) {
              const n = parseInt(mMate[1], 10);
              mate = n;
              cp = n > 0 ? 10000 - n : -10000 - n;
            } else if (mCp) {
              mate = null;
              cp = parseInt(mCp[1], 10);
            }
            const pv = mPv ? mPv[1].trim().split(/\s+/) : lines.get(idx)?.pv ?? [];
            const d = mDepth ? parseInt(mDepth[1], 10) : lines.get(idx)?.depth ?? 0;
            lines.set(idx, { cp, mateIn: mate, bestmove: pv[0] ?? null, pv, depth: d });
          } else if (line.startsWith('bestmove')) {
            this.worker.removeEventListener('message', onMsg);
            this.busy = false;
            const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
            resolve(sorted);
          }
        };
        this.worker.addEventListener('message', onMsg);
        this.worker.postMessage('position fen ' + fen);
        this.worker.postMessage('go depth ' + depth);
      });
    });
  }

  /** Interrupt an in-flight search (best-effort). */
  stop() {
    if (this.busy) this.worker.postMessage('stop');
  }

  destroy() {
    try {
      this.worker.postMessage('quit');
    } catch { /* already gone */ }
    this.worker.terminate();
  }
}
