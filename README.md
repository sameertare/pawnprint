# ♖ OpenFile

A local-first chess toolkit with **six tools**, each its own single-page app, reachable from a hub landing page. Everything runs in the browser: **Stockfish 18** (lite) as a WASM worker, live games streamed straight from the lichess public API, and all analysis client-side — your games never leave your machine. An optional Node/Express backend adds server-side report storage, but the whole app also runs as a pure static site (e.g. GitHub Pages).

| Page | Tool | What it does |
|---|---|---|
| `index.html` | **Hub** | Landing page linking to the six tools |
| `analyze.html` | **Performance Analysis** | Deep performance report from chess.com / lichess PGNs |
| `live.html` | **Live & Engine** | Watch a live lichess game with move feedback; best-move suggestion from any position |
| `swiss.html` | **Swiss Pairings** | Run a full Swiss tournament from a roster |
| `opening-explorer.html` | **Opening Explorer** | Branching opening tree from your own PGNs, with master-game comparison |
| `rating.html` | **USCF Rating Estimator** | Estimate a new US Chess rating after an event |
| `fide-rating.html` | **FIDE Rating Estimator** | Estimate a new FIDE Standard rating after an event |

---

## Tool 1 — Performance Analysis

Turns PGN files from **chess.com** or **lichess** into a deep, parent-friendly performance report. Stores growing reports as Markdown you can re-open and extend over time.

The player the report is for is **auto-detected**, not picked from a dropdown: whichever name appears in the most games is assumed to be the report's subject, and every one of their games in the loaded file(s) is analyzed. Name variants that likely refer to the same person are folded together automatically — different casing, "Last, First" vs "First Last" order (common in tournament-software rosters), and a shortened nickname/first-name-only form (e.g. a lichess study chapter titled just "Eevie" alongside others titled "Eevie Tare") — so a file with inconsistent naming across chapters or exports doesn't silently drop that player's games. A chapter with **no player tags at all** (some lichess study chapters only have a title like "Black vs Opponent Name") is still included, attributed to the detected player with their color inferred from that title. Re-uploading a saved `.md` report weights its existing owner so the same player stays attributed across sessions.

---

## What it analyzes

- **Openings** — every opening played, with W/D/L, score %, colour split and accuracy; **strongest** and **weakest** openings called out in their own tables.
- **Game phases** — separate accuracy, inaccuracy/mistake/blunder counts for **opening / middlegame / endgame**, plus which phase decided each loss.
- **Endgames** — which endgame types you reach (rook, pawn, queen…) and your record in each.
- **Tactics** — missed wins, missed forced mates, missed tactical shots (engine's best was an unplayed capture/check), and your biggest single-move swings.
- **Errors in wins vs losses** — do blunders cluster in the games you lose?
- **Patterns** — thrown wins (winning position → loss), conversion rate of winning positions, resilience (saves from losing), time-trouble errors, and a plain-English narrative of the dominant loss pattern.
- **Time trouble** — its own small section: how many games had `[%clk]` data, how many blunders/mistakes were played with under 30 seconds left, and what share of your total errors that represents — clock management is something you can actually train, so it gets called out on its own rather than buried in a footnote.
- **Results by time control** — Bullet / Blitz / Rapid / Classical / Daily W-D-L and accuracy.
- **Training plan** — prioritized recommendations, each linking to the exact **lichess puzzle themes** to drill, plus concrete practice tips.
- **Games list with eval graphs** — every analyzed game, most recent first, with date, opponent, result, opening, accuracy, and a sparkline of the evaluation (white's perspective) across the whole game. A ▶ link opens a lichess-sourced game directly in **Live & Engine**, deep-linked to step through it move by move (chess.com games don't have a public live-game API, so the link only appears for lichess games). A ⬇ link downloads that game as a standard, annotated PGN — engine evals baked in as `[%eval ...]` comments plus a short note on any flagged inaccuracy/mistake/blunder — viewable in any ordinary PGN reader offline, no app required.

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

Then open **http://localhost:8787**, drop in your PGN(s), pick an engine depth, and click **Analyze games** — the player is auto-detected for you.

For development with hot reload:

```bash
npm run start        # terminal 1 — backend API on :8787 (optional, for server report storage)
npm run dev          # terminal 2 — Vite dev server with hot reload
```

## Deploy to GitHub Pages

OpenFile is built to run as a **pure static site** — Stockfish runs in the browser, live games stream directly from lichess (CORS-allowed), Swiss uses `localStorage`, and reports are saved via file download/upload. The only feature that needs the Node backend is *server-side* report storage, which is optional.

A workflow is included at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). To publish:

```bash
git init && git add -A && git commit -m "OpenFile"
gh repo create openfile --public --source=. --push   # or create the repo in the GitHub UI and push
```

Then in the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push to `main` builds and deploys automatically. The workflow sets Vite's `--base` to your repo name, so assets resolve correctly at `https://<you>.github.io/<repo>/` (the 7 MB engine `.wasm` is committed and served with the right MIME type; single-threaded Stockfish means no special cross-origin-isolation headers are needed).

Prefer the backend features (server report storage) live too? Deploy the whole thing on Render/Railway/Fly from the same repo with build `npm run build` and start `npm start` — no code changes.

### Getting your PGN

- **chess.com** — Profile → Games → Download, or the monthly archive. Multiple monthly files? Drop them all in at once.
- **lichess** — Profile → Export games (`.pgn`). Lichess PGNs often include `[%eval]` and `[%clk]` tags; when present, OpenFile uses them directly (instant, no engine needed) — otherwise it runs Stockfish on every position.

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
  playerMatch.ts    groups PGN name variants (casing, "Last, First", nicknames) into one player
  engine.ts         Stockfish 18 (lite) WASM worker wrapper — shared by analyze & live
  analyze.ts        per-game analysis: win%, accuracy, errors, phases, patterns
  aggregate.ts      cross-game tables, pattern detection, puzzle recommendations
  markdown.ts       report render + round-trip parse + incremental merge
  main.ts           Performance Analysis UI
  board.ts          presentation-only chessboard (FEN render, arrows, click-to-move)
  live.ts           Live & Engine UI (position analysis + live-game feedback)
  sparkline.ts      eval-graph rendering, shared by Analyze (static) & Live (interactive/click-to-seek)
  pgnExport.ts      annotated-PGN builder ([%eval] + best-move comments), shared by Analyze & Live
  pwa.ts            service worker registration, shared by every page's entry module
  swissEngine.ts    pure Swiss logic: roster parsing, pairing, results, standings
  swiss.ts          Swiss Pairings UI
  openingTree.ts    pure opening-tree logic: builds a move trie from games, aggregates W/D/L per node
  openingExplorer.ts Opening Explorer UI (file load, player detection, tree navigation, master-game fetch)
  ratingEngine.ts   pure USCF rating-estimate logic
  rating.ts         USCF Rating Estimator UI
  fideRatingEngine.ts pure FIDE rating-estimate logic
  fideRating.ts     FIDE Rating Estimator UI
server/
  server.mjs      Express: static hosting, /api/reports save/load, /api/live/:id SSE relay
public/engine/    Stockfish 18 (lite) worker + wasm
public/manifest.webmanifest, sw.js, icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png   PWA manifest, service worker, and app icons
samples/          example PGNs (bundled "try the sample" button)
```

## Notes

- Analysis of the user's moves only — the identified player is auto-detected from the PGN and selectable.
- All processing is local; no game data leaves your machine.

## Install as an app / offline use

OpenFile is an installable PWA (Progressive Web App):

- **Install** — most browsers show an install prompt (address-bar icon, or browser menu → "Install OpenFile" / "Add to Home Screen"). Installed, it opens in its own window with no browser chrome, like a native app.
- **Offline** — a service worker caches the app shell and the Stockfish engine files after your first visit. Content-hashed JS/CSS/image assets are cache-first with a background refresh (safe, since a new build gets a new URL); HTML pages are network-first so you always get the latest version when online, falling back to the cached copy only when you're offline. Once the engine has loaded once, position analysis and PGN review keep working with no connectivity at all — handy in a tournament hall with bad wifi. Live game streaming and lichess study/search lookups still need a connection, since those are fetched from lichess's API rather than cached.

---

## Tool 2 — Live & Engine (`/live.html`)

Two modes, one board (Stockfish 18 runs locally in the browser):

**Any position**
- Paste a FEN or click pieces to play moves on the board (moves are validated by chess.js).
- **Suggest best move** runs Stockfish 18 to your chosen depth and shows the best move (as an arrow + SAN), the evaluation, the eval bar, and the full principal variation.
- **Play best move** applies it so you can walk a line forward; **Undo** / **Start position** to reset.
- The **opening name** (book lookup, no PGN headers needed) is shown once the moves played match a known line, and keeps updating as you navigate.

**Live lichess game / study / position**
- Paste a lichess **game** URL or 8-character ID and **Connect** — the board follows the game move-by-move in real time (feedback begins from the position at the moment you connect; the stream doesn't replay earlier moves).
- Paste a lichess **study** link (with or without a chapter) to load that chapter as a static, navigable game — click pieces or step with ◀ ▶, same as Any Position. A study with multiple chapters loads chapter 1, with a note to paste a direct chapter link for another.
- Paste a lichess **analysis-board** link (with an embedded FEN) or just a bare **FEN** to load that single position.
- Every move gets **feedback** — Best / OK / Inaccuracy ?! / Mistake ? / Blunder ?? — based on the win-probability swing, with the engine's better move shown when relevant. The **● LIVE** badge (and jump-back-to-live button) only appears for an actual live game, not a study/position load.

**Top candidate moves (both modes)** — the currently viewed position always shows the top 3 engine moves (Stockfish's MultiPV), each with its evaluation and a short continuation, drawn on the board as three ranked arrows (green/gold/blue, thickest and brightest for the best move) — useful for seeing what else was worth considering, not just the single best line.

**Eval graph** — once a loaded game has at least two evaluated positions, a sparkline appears under the eval bar tracing the evaluation (white's perspective) across the whole game so far; click anywhere on it to jump straight to that ply. It fills in progressively as background evaluation catches up, and works in both modes. Opening a game from Analyze's games list (see below) via its ▶ link deep-links here and drops you straight onto this view.

**Export PGN** — the **⬇ PGN** button downloads the currently loaded line as a standard PGN, with the engine eval baked in as a `[%eval ...]` comment on every position that's been evaluated so far, plus a note wherever the engine's suggested best move differs from what was actually played — handy for a coach who wants to review offline without the app.

How the live board works: the browser streams `GET https://lichess.org/api/stream/game/{id}` (games) or `GET https://lichess.org/study/{id}[/{chapterId}].pgn` (studies) directly from the lichess public API (CORS-allowed) — no backend required, which is what lets the Live tool work on a static host like GitHub Pages. The bundled Node backend also exposes an equivalent `/api/live/:id` Server-Sent-Events relay for environments that prefer to proxy, but the frontend doesn't need it.

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
- **Wall chart:** a crosstable — one row per player (current standings order), one column per round — showing exactly who they played, with what color, and the result (e.g. `8w+` = played standings-#8 as White and won; `4b=` = played #4 as Black and drew; a pending pairing shows the opponent with no result yet). The single most useful view for a TD or parent scanning for repeat opponents or checking a player's path through the event at a glance.
- **Persistence:** the whole event auto-saves in your browser (localStorage). **Export/Import** it as JSON, and **Print all standings** for posting.
- **Navigation:** every tool page has a **🏠 Home** link in the top nav back to the OpenFile hub — your tournament stays saved when you navigate away and back.

The pairing engine (`src/swissEngine.ts`) is pure and framework-free. It has been stress-tested across many field sizes, round counts, and result models: no rematches when mathematically avoidable, byes capped at one per player, and conserved scores.

---

## Tool 4 — Opening Explorer (`/opening-explorer.html`)

Turns your own PGNs into a branching opening tree — like [openingtree.com](https://www.openingtree.com/), scoped to a v1: your own games in, no account/username fetch.

- **Input:** drop PGN file(s) (or try the bundled sample). The main player is auto-detected the same way Performance Analysis does it (most frequent name across games, with casing/"Last, First"/nickname variants folded together) — no picking required.
- **Tree:** built entirely client-side (`src/openingTree.ts`) by walking each game's move list into a trie, capped at 12 full moves (24 plies) — deeper transpositions rarely matter for repertoire prep. Every node tracks games/wins/draws/losses reached through it.
- **Browsing:** a board (reusing the same `Board` component as Live & Engine) plus a clickable breadcrumb and a move-list table sorted by frequency, each row showing games played, score %, and a win/draw/loss bar. Click a move to drill in; **Back**/**Start**/flip to navigate.
- **Filters:** color (White/Black — rebuilds the tree and flips the board), and a minimum-games threshold to hide rarely-played branches.
- **Master-game comparison:** the same position's stats from the free [Lichess masters explorer API](https://lichess.org/api#tag/Opening-Explorer) shown alongside your own, so you can see where your repertoire diverges from master play. Degrades gracefully with an inline notice if that public API is unavailable — your own tree is unaffected either way.

Not in v1 (noted as future work): username-based bulk game fetch from chess.com/lichess, opponent-prep mode (load someone else's games), and variant support — all real openingtree.com features, scoped out to keep this a focused first pass.

---

## Tool 5 — USCF Rating Estimator (`/rating.html`)

Estimate a new US Chess (USCF) rating after an event, using the published rating formula.

- **Inputs:** current rating, total score, number of prior rated games, age (optional), and up to 15 opponent ratings.
- **Formula:** per-game win expectancy on the classic logistic curve with the ±400 rating-difference cap; K-factor = 800 / (N + games), where N is 50 for an established player (≥ 26 prior games) or based on actual prior games for a provisional one; a bonus provision for scoring well above expectation; performance rating from the average opponent rating and score percentage.
- **Dual-rated option:** "Use lower K values for high rated players (2200 and up) for estimating regular ratings in dual-rated events" — when checked and the current rating is 2200+, effective games are boosted for a lower K.
- **Output:** new rating, rating change, performance rating, K value, plus a detail table (win expectancy sum, effective N, established/provisional status, base change vs. bonus) and contextual notes (provisional-rating caveat, junior-player note, dual-rated applicability, single-event swing cap).

This is an **unofficial estimate**, clearly labeled as such in the tool — US Chess's actual post-event computation is run centrally (Glickman-based) and may differ slightly; the estimator mirrors the classic public formula players commonly use to predict their own change. The engine (`src/ratingEngine.ts`) is pure and framework-free.

---

## Tool 6 — FIDE Rating Estimator (`/fide-rating.html`)

Estimate a new FIDE **Standard** rating after an event (Rapid/Blitz use separate rating pools and aren't covered).

- **Inputs:** current rating, total score, and up to 15 opponent ratings — no prior-games, age, or dual-rated fields (those are USCF-specific or not needed for this simplified estimate).
- **Formula:** the same win-expectancy logistic curve with the ±400 cap as the USCF tool, but a FIDE-style flat K-factor tier by rating instead of a dynamic N+games formula: **K = 20** below 2400, **K = 10** at 2400+. No bonus-points provision (FIDE Standard has none). Assumes an established rating — FIDE's K=40 tier for a player's first 30 rated games isn't modeled, since that needs a games-played input this tool omits.
- **Output:** new rating, rating change, performance rating, K value, plus games counted, win expectancy sum, and the K-factor tier reason. Notes flag the established-rating assumption and the sub-1400 publication floor.

Also an **unofficial estimate** (FIDE Handbook B.02) — actual FIDE processing is centralized and by rating period. The engine (`src/fideRatingEngine.ts`) is pure and framework-free.

---

### Engine notes

- First engine use downloads the ~7 MB Stockfish 18 (lite) build with its NNUE network embedded (served locally from `public/engine`), then it's cached — no separate network file, no cross-origin isolation headers needed.
