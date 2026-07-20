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
  // Bumped by cancelPending() — see enqueue() below.
  private generation = 0;

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

  /** Run `job` after any prior queued search completes, keeping searches strictly sequential.
   *  `emptyResult` is what's returned instead of actually running `job` if this call was
   *  superseded by cancelPending() before its turn in the queue came up — every caller already
   *  discards a stale result via its own "is this still the position I care about" check once the
   *  promise resolves, so skipping straight to that placeholder (rather than running a real,
   *  possibly many-second search nobody wants anymore) is what lets cancelPending() actually free
   *  up the queue instead of merely interrupting whichever one job happens to be active. */
  private enqueue<T>(job: () => Promise<T>, emptyResult: T): Promise<T> {
    const gen = this.generation;
    const result = this.queue.then(() => (gen === this.generation ? job() : emptyResult));
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
      return new Promise<EngineEval>((resolve) => {
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
    }, { cp: 0, mateIn: null, bestmove: null, pv: [], depth: 0 });
  }

  /**
   * Evaluate a position and return the top `multiPv` candidate lines (rank 1 = best), for
   * "show me the top few moves" UIs. Sequenced through the same queue as `evaluate`.
   */
  evaluateMultiPv(fen: string, depth: number, multiPv: number): Promise<EngineEval[]> {
    return this.enqueue(() => {
      this.setMultiPv(multiPv);
      this.busy = true;
      return new Promise<EngineEval[]>((resolve) => {
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
    }, []);
  }

  /** Interrupt an in-flight search (best-effort). */
  stop() {
    if (this.busy) this.worker.postMessage('stop');
  }

  /**
   * Interrupts whatever's currently searching AND discards every not-yet-started job still
   * waiting behind it in the queue — stop() alone only handles the former. In Play vs Engine,
   * both a background eval (pump) and a multi-PV candidates search can get queued up while the
   * user is thinking; calling only stop() when they move frees up whichever of those two happens
   * to be the one currently running, but leaves the other to run to completion — at higher engine
   * strength, that's a second many-second search the engine's actual reply is stuck waiting behind,
   * which reads as the game being stuck. Call this right before enqueuing something that actually
   * matters (the engine's real move) so it never queues up behind now-irrelevant background work.
   */
  cancelPending() {
    this.generation++;
    this.stop();
  }

  destroy() {
    try {
      this.worker.postMessage('quit');
    } catch { /* already gone */ }
    this.worker.terminate();
  }
}
