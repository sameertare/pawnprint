# ♟ PawnPrint

A local-first chess toolkit with **five tools**, each its own single-page app, reachable from a hub landing page. Everything runs in the browser: **Stockfish 18** (lite) as a WASM worker, live games streamed straight from the lichess public API, and all analysis client-side — your games never leave your machine. An optional Node/Express backend adds server-side report storage, but the whole app also runs as a pure static site (e.g. GitHub Pages).

| Page | Tool | What it does |
|---|---|---|
| `index.html` | **Hub** | Landing page linking to the five tools |
| `analyze.html` | **Analyze PGN** | Deep performance report from chess.com / lichess PGNs |
| `live.html` | **Live & Engine** | Watch a live lichess game with move feedback; best-move suggestion from any position |
| `swiss.html` | **Swiss Pairings** | Run a full Swiss tournament from a roster |
| `rating.html` | **USCF Rating Estimator** | Estimate a new US Chess rating after an event |
| `fide-rating.html` | **FIDE Rating Estimator** | Estimate a new FIDE Standard rating after an event |

---

## Tool 1 — Analyze PGN

Turns PGN files from **chess.com** or **lichess** into a deep, parent-friendly performance report. Stores growing reports as Markdown you can re-open and extend over time.

---

## What it analyzes

- **Openings** — every opening played, with W/D/L, score %, colour split and accuracy; **strongest** and **weakest** openings called out in their own tables.
- **Game phases** — separate accuracy, inaccuracy/mistake/blunder counts for **opening / middlegame / endgame**, plus which phase decided each loss.
- **Endgames** — which endgame types you reach (rook, pawn, queen…) and your record in each.
- **Tactics** — missed wins, missed forced mates, missed tactical shots (engine's best was an unplayed capture/check), and your biggest single-move swings.
- **Errors in wins vs losses** — do blunders cluster in the games you lose?
- **Patterns** — thrown wins (winning position → loss), conversion rate of winning positions, resilience (saves from losing), time-trouble errors, and a plain-English narrative of the dominant loss pattern.
- **Results by time control** — Bullet / Blitz / Rapid / Classical / Daily W-D-L and accuracy.
- **Training plan** — prioritized recommendations, each linking to the exact **lichess puzzle themes** to drill, plus concrete practice tips.

## Save & track over time

- **Download report.md** — a self-contained Markdown file. Human-readable tables *and* an embedded machine-readable data block.
- **Re-open it later** — drop the `.md` back in **together with new PGN files**. Already-analyzed games are kept as-is; only the new games are analyzed, and the report accumulates a session history.
- **Save on / load from server** — optional server-side storage so reports persist between machines.
- **Multiple files at once** — drop any number of `.pgn` files (and a report `.md`) in a single input.

---

## Run it

```bash
npm install          # first time only (also fetches the Stockfish engine)
npm run serve        # builds the SPA and serves it at http://localhost:8787
```

Then open **http://localhost:8787**, drop in your PGN(s), pick the player and engine depth, and click **Analyze games**.

For development with hot reload:

```bash
npm run start        # terminal 1 — backend API on :8787 (optional, for server report storage)
npm run dev          # terminal 2 — Vite dev server with hot reload
```

## Deploy to GitHub Pages

PawnPrint is built to run as a **pure static site** — Stockfish runs in the browser, live games stream directly from lichess (CORS-allowed), Swiss uses `localStorage`, and reports are saved via file download/upload. The only feature that needs the Node backend is *server-side* report storage, which is optional.

A workflow is included at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). To publish:

```bash
git init && git add -A && git commit -m "PawnPrint"
gh repo create pawnprint --public --source=. --push   # or create the repo in the GitHub UI and push
```

Then in the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push to `main` builds and deploys automatically. The workflow sets Vite's `--base` to your repo name, so assets resolve correctly at `https://<you>.github.io/<repo>/` (the 7 MB engine `.wasm` is committed and served with the right MIME type; single-threaded Stockfish means no special cross-origin-isolation headers are needed).

Prefer the backend features (server report storage) live too? Deploy the whole thing on Render/Railway/Fly from the same repo with build `npm run build` and start `npm start` — no code changes.

### Getting your PGN

- **chess.com** — Profile → Games → Download, or the monthly archive. Multiple monthly files? Drop them all in at once.
- **lichess** — Profile → Export games (`.pgn`). Lichess PGNs often include `[%eval]` and `[%clk]` tags; when present, PawnPrint uses them directly (instant, no engine needed) — otherwise it runs Stockfish on every position.

### Engine depth

| Setting | Speed | Use for |
|---|---|---|
| Fast (depth 8) | ~1–2 s/game | Large batches, quick pass |
| Balanced (depth 12) | default | Most cases |
| Deep (depth 16) | slow | Small, important sets |
| No engine | instant | PGNs that already have `[%eval]` tags |

---

## How the metrics are computed

- **Win %** and **per-move accuracy** use the lichess models (logistic win-probability from centipawns; accuracy from the win-% drop your move caused).
- **Move quality:** inaccuracy ≥ 10% win-chance drop, mistake ≥ 20%, blunder ≥ 30%.
- **Phase split:** by remaining major/minor pieces (endgame ≤ 6, middlegame ≤ 10 or past move 12, else opening) — the lichess-style division.
- **Openings:** PGN `Opening` header (lichess) → `ECOUrl` (chess.com) → a built-in move-prefix book fallback.
- A game counts toward "winning" at ≥ 70% win chance and "losing" at ≤ 30%.

## Project layout

```
index.html / analyze.html / live.html / swiss.html / rating.html / fide-rating.html   the six pages (Vite multi-page build)
src/
  types.ts          shared data model (also the shape persisted in the .md)
  pgn.ts            multi-game PGN splitting & parsing, eval/clock tag extraction
  openings.ts       opening identification (header → ECOUrl → book)
  engine.ts         Stockfish 18 (lite) WASM worker wrapper — shared by analyze & live
  analyze.ts        per-game analysis: win%, accuracy, errors, phases, patterns
  aggregate.ts      cross-game tables, pattern detection, puzzle recommendations
  markdown.ts       report render + round-trip parse + incremental merge
  main.ts           Analyze-PGN UI
  board.ts          presentation-only chessboard (FEN render, arrows, click-to-move)
  live.ts           Live & Engine UI (position analysis + live-game feedback)
  swissEngine.ts    pure Swiss logic: roster parsing, pairing, results, standings
  swiss.ts          Swiss Pairings UI
  ratingEngine.ts   pure USCF rating-estimate logic
  rating.ts         USCF Rating Estimator UI
  fideRatingEngine.ts pure FIDE rating-estimate logic
  fideRating.ts     FIDE Rating Estimator UI
server/
  server.mjs      Express: static hosting, /api/reports save/load, /api/live/:id SSE relay
public/engine/    Stockfish 18 (lite) worker + wasm
samples/          example PGNs (bundled "try the sample" button)
```

## Notes

- Analysis of the user's moves only — the identified player is auto-detected from the PGN and selectable.
- All processing is local; no game data leaves your machine.

---

## Tool 2 — Live & Engine (`/live.html`)

Two modes, one board (Stockfish 18 runs locally in the browser):

**Any position**
- Paste a FEN or click pieces to play moves on the board (moves are validated by chess.js).
- **Suggest best move** runs Stockfish 18 to your chosen depth and shows the best move (as an arrow + SAN), the evaluation, the eval bar, and the full principal variation.
- **Play best move** applies it so you can walk a line forward; **Undo** / **Start position** to reset.

**Live lichess game**
- Paste a lichess game URL or 8-character ID and **Connect**.
- The board follows the game move-by-move in real time.
- Every move gets **feedback** — Best / OK / Inaccuracy ?! / Mistake ? / Blunder ?? — based on the win-probability swing, with the engine's better move shown when relevant.
- The engine's suggested move for the side to move is always displayed and drawn as an arrow.

How the live board works: the browser streams `GET https://lichess.org/api/stream/game/{id}` directly from the lichess public API (NDJSON, CORS-allowed) — no backend required, which is what lets the Live tool work on a static host like GitHub Pages. Feedback begins from the position at the moment you connect (the stream doesn't replay earlier moves). The bundled Node backend also exposes an equivalent `/api/live/:id` Server-Sent-Events relay for environments that prefer to proxy, but the frontend doesn't need it.

---

## Tool 3 — Swiss Pairings (`/swiss.html`)

Run a complete Swiss-system tournament in the browser.

- **Roster format is explicit, not auto-detected** — pick **Plain list**, **US Chess table**, or **NWChess RosterTable.csv** from the format dropdown before creating the tournament. Each format shows its own hint text and its own "Load a sample roster" example.
  - **Plain list:** one player per line — `Name`, `Name Rating`, or `Name, Rating`, with optional `1.` numbering.
  - **US Chess table:** a labeled wallchart table (`#`, `Name`, `US Chess ID`, `Rating`, `Bye Rds`, …), tab- or comma-separated **or pasted with plain single spaces** (e.g. copied straight off a web page) — the column layout is detected either way.
  - **NWChess RosterTable.csv:** FIDE ratings are ignored, each player is seeded by **max(NWSRS, USCF)**, withdrawn players are dropped. If the roster spans several sections (e.g. *Newport Open*, *Somerset U1700*), creating the tournament sets up **every section at once**.
- **Multi-section events:** when a roster has sections, one "Pair next round" click pairs **all sections together**; a tab bar lets you switch between sections, each with its own pairings/results/standings. "Print all standings" prints a wall chart covering every section.
- **Bye requests:** if the roster's bye column names round(s) a player is sitting out (e.g. `3` or `4,5`), that player is automatically given a **half-point bye** in that round instead of being paired, and the rest of the field pairs normally around them.
- **Pairing engine:** Dutch-style fold pairing — round 1 pairs the top half vs the bottom half by rating; later rounds pair within score groups, down-float odd players, avoid rematches (with a global rematch-free fallback), balance colors, and assign a full-point bye to the lowest player who hasn't had one when the field (after bye requests) is odd.
- **Results & standings:** enter 1-0 / ½-½ / 0-1 per board; standings update live with **Buchholz** and **Sonneborn-Berger** tiebreaks, W/D/L (a requested half-point bye counts as a draw, a forced full-point bye counts as a win), and color balance.
- **Persistence:** the whole event auto-saves in your browser (localStorage). **Export/Import** it as JSON, and **Print all standings** for posting.
- **Navigation:** every tool page has a **🏠 Home** link in the top nav back to the PawnPrint hub — your tournament stays saved when you navigate away and back.

The pairing engine (`src/swissEngine.ts`) is pure and framework-free. It has been stress-tested across many field sizes, round counts, and result models: no rematches when mathematically avoidable, byes capped at one per player, and conserved scores.

---

## Tool 4 — USCF Rating Estimator (`/rating.html`)

Estimate a new US Chess (USCF) rating after an event, using the published rating formula.

- **Inputs:** current rating, total score, number of prior rated games, age (optional), and up to 15 opponent ratings.
- **Formula:** per-game win expectancy on the classic logistic curve with the ±400 rating-difference cap; K-factor = 800 / (N + games), where N is 50 for an established player (≥ 26 prior games) or based on actual prior games for a provisional one; a bonus provision for scoring well above expectation; performance rating from the average opponent rating and score percentage.
- **Dual-rated option:** "Use lower K values for high rated players (2200 and up) for estimating regular ratings in dual-rated events" — when checked and the current rating is 2200+, effective games are boosted for a lower K.
- **Output:** new rating, rating change, performance rating, K value, plus a detail table (win expectancy sum, effective N, established/provisional status, base change vs. bonus) and contextual notes (provisional-rating caveat, junior-player note, dual-rated applicability, single-event swing cap).

This is an **unofficial estimate**, clearly labeled as such in the tool — US Chess's actual post-event computation is run centrally (Glickman-based) and may differ slightly; the estimator mirrors the classic public formula players commonly use to predict their own change. The engine (`src/ratingEngine.ts`) is pure and framework-free.

---

## Tool 5 — FIDE Rating Estimator (`/fide-rating.html`)

Estimate a new FIDE **Standard** rating after an event (Rapid/Blitz use separate rating pools and aren't covered).

- **Inputs:** current rating, total score, and up to 15 opponent ratings — no prior-games, age, or dual-rated fields (those are USCF-specific or not needed for this simplified estimate).
- **Formula:** the same win-expectancy logistic curve with the ±400 cap as the USCF tool, but a FIDE-style flat K-factor tier by rating instead of a dynamic N+games formula: **K = 20** below 2400, **K = 10** at 2400+. No bonus-points provision (FIDE Standard has none). Assumes an established rating — FIDE's K=40 tier for a player's first 30 rated games isn't modeled, since that needs a games-played input this tool omits.
- **Output:** new rating, rating change, performance rating, K value, plus games counted, win expectancy sum, and the K-factor tier reason. Notes flag the established-rating assumption and the sub-1400 publication floor.

Also an **unofficial estimate** (FIDE Handbook B.02) — actual FIDE processing is centralized and by rating period. The engine (`src/fideRatingEngine.ts`) is pure and framework-free.

---

### Engine notes

- First engine use downloads the ~7 MB Stockfish 18 (lite) build with its NNUE network embedded (served locally from `public/engine`), then it's cached — no separate network file, no cross-origin isolation headers needed.
