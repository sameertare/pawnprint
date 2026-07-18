# ♖ OpenFile

A local-first chess toolkit with **seven tools**, each its own single-page app, reachable from a hub landing page. Everything runs in the browser: **Stockfish 18** (lite) as a WASM worker, live games streamed straight from the lichess public API, and all analysis client-side — your games never leave your machine. An optional Node/Express backend adds server-side report storage, but the whole app also runs as a pure static site (e.g. GitHub Pages).

| Page | Tool | What it does |
|---|---|---|
| `index.html` | **Hub** | Landing page linking to the seven tools |
| `analyze.html` | **Performance Analysis** | Deep performance report from chess.com / lichess PGNs |
| `live.html` | **Live & Engine** | Watch a live lichess game with move feedback; best-move suggestion from any position |
| `swiss.html` | **Swiss Pairings** | Run a full Swiss tournament from a roster |
| `opening-explorer.html` | **Opening Explorer** | Branching opening tree from your own PGNs |
| `compare-reports.html` | **Compare Reports** | Side-by-side metric delta between two saved Performance Analysis reports |
| `rating.html` | **USCF Rating Estimator** | Estimate a new US Chess rating after an event |
| `fide-rating.html` | **FIDE Rating Estimator** | Estimate a new FIDE Standard rating after an event |

---

## Tool 1 — Performance Analysis

Turns PGN files from **chess.com** or **lichess** into a deep, parent-friendly performance report. Stores growing reports as Markdown you can re-open and extend over time.

The player the report is for is **auto-detected**, not picked from a dropdown: whichever name appears in the most games is assumed to be the report's subject, and every one of their games in the loaded file(s) is analyzed. Name variants that likely refer to the same person are folded together automatically — different casing, "Last, First" vs "First Last" order (common in tournament-software rosters), and a shortened nickname/first-name-only form (e.g. a lichess study chapter titled just "Eevie" alongside others titled "Eevie Tare") — so a file with inconsistent naming across chapters or exports doesn't silently drop that player's games. A chapter with **no player tags at all** (some lichess study chapters only have a title like "Black vs Opponent Name") is still included, attributed to the detected player with their color inferred from that title. Re-uploading a saved `.md` report weights its existing owner so the same player stays attributed across sessions.

---

## What it analyzes

- **Openings** — every opening played, with W/D/L, score %, colour split and accuracy; **strongest** and **weakest** openings called out in their own tables, alongside a **repertoire coverage** stat (what % of your games followed an opening you've played 2+ times, i.e. "prepared," vs. a one-off/improvised line). When games span more than one time control, an **Openings by time control** section repeats the same breakdown per Bullet/Blitz/Rapid/Classical/Daily — a repertoire that scores well in Rapid can fall apart under Bullet's time pressure, and the aggregate-only view would hide that.
- **Game phases** — separate accuracy, inaccuracy/mistake/blunder counts for **opening / middlegame / endgame**, plus which phase decided each loss. An **errors-by-move-number** chart underneath plots inaccuracies/mistakes/blunders against the actual move number they happened on — more granular than the phase split, since two games can reach (say) the endgame at very different move numbers.
- **Endgames** — which endgame types you reach (rook, pawn, queen…) and your record in each.
- **Tactics** — missed wins, missed forced mates, missed tactical shots (engine's best was an unplayed capture/check), and your biggest single-move swings.
- **Errors in wins vs losses** — do blunders cluster in the games you lose?
- **Patterns** — thrown wins (winning position → loss), conversion rate of winning positions, resilience (saves from losing), time-trouble errors, and a plain-English narrative of the dominant loss pattern.
- **Time trouble** — its own small section: how many games had `[%clk]` data, how many blunders/mistakes were played with under 30 seconds left, and what share of your total errors that represents — clock management is something you can actually train, so it gets called out on its own rather than buried in a footnote. Underneath it, a **time-usage chart** plots average seconds remaining by move number across every game with clock data, so you can see whether time trouble tends to build up at a particular stage of the game rather than being spread evenly.
- **Head-to-head** — pick any opponent from a dropdown (populated from everyone in the loaded games) and see just that match-up: W/D/L, score, an opening breakdown for that opponent specifically, and the underlying game list — different from Compare Reports, which compares aggregate reports rather than filtering to one rivalry.
- **Results by time control** — Bullet / Blitz / Rapid / Classical / Daily W-D-L and accuracy.
- **Training plan** — prioritized recommendations, each linking to the exact **lichess puzzle themes** to drill, plus concrete practice tips.
- **Games list with eval graphs** — every analyzed game, most recent first, with date, opponent, result, opening, accuracy, and a sparkline of the evaluation (white's perspective) across the whole game. A ▶ link opens a lichess-sourced game directly in **Live & Engine**, deep-linked to step through it move by move (chess.com games don't have a public live-game API, so the link only appears for lichess games). A ⬇ link downloads that game as a standard, annotated PGN — engine evals baked in as `[%eval ...]` comments plus a short note on any flagged inaccuracy/mistake/blunder — viewable in any ordinary PGN reader offline, no app required.
- **Per-game strength/weakness assessment** — a 🩺 button on every analyzed game expands a verdict for that specific game, grounded in the actual engine feedback rather than just accuracy numbers: the overall summary names the exact turning-point move (e.g. "**axb4** on move 8 was a blunder — Nxe5 kept the advantage — win chance dropped 51 points"), and each phase's weakness citations do the same for every blunder/mistake/missed-win/missed-mate the engine flagged in that phase, not a generic "N errors" count. Opening/middlegame/endgame are each individually marked as a strength, weakness, or neutral (and for the opening, whether it's a repeated line from your repertoire or a one-off). Derived entirely from the already-computed accuracy/error/worst-move data — nothing is re-analyzed. Every analyzed game gets this breakdown in the **downloaded report** too, as its own numbered section.

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
index.html / analyze.html / live.html / swiss.html / opening-explorer.html / compare-reports.html / rating.html / fide-rating.html / about.html   the seven tool pages + About (Vite multi-page build)
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
  linechart.ts      generic multi-series SVG line chart, shared by the report trend chart & time-usage chart
  pgnExport.ts      annotated-PGN builder ([%eval] + best-move comments), shared by Analyze & Live
  pwa.ts            service worker registration, shared by every page's entry module
  theme.ts          light/dark theme toggle, shared by every page's entry module
  swissEngine.ts    pure Swiss logic: roster parsing, pairing, results, standings
  swiss.ts          Swiss Pairings UI
  openingTree.ts    pure opening-tree logic: builds a move trie from games, aggregates W/D/L per node
  openingExplorer.ts Opening Explorer UI (file load, player detection, tree navigation)
  reportCompare.ts  pure report-comparison logic: builds delta rows/direction for every aggregate metric
  compareReports.ts Compare Reports UI (two-file upload, delta tables, opening-by-opening diff)
  ratingEngine.ts   pure USCF rating-estimate logic
  rating.ts         USCF Rating Estimator UI
  fideRatingEngine.ts pure FIDE rating-estimate logic
  fideRating.ts     FIDE Rating Estimator UI
  about.ts          About page (static content, no logic of its own)
server/
  server.mjs      Express: static hosting, /api/reports save/load, /api/live/:id SSE relay
public/engine/    Stockfish 18 (lite) worker + wasm
public/manifest.webmanifest, sw.js, icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png   PWA manifest, service worker, and app icons
samples/          example PGNs (bundled "try the sample" button)
```

## Notes

- Analysis of the user's moves only — the identified player is auto-detected from the PGN and selectable.
- All processing is local; no game data leaves your machine.
- **Light/dark theme** — every page has a toggle (☀️/🌙) in the top nav. The choice is saved to `localStorage` and applied on every page via a small inline script in `<head>`, so it survives navigation without a flash of the wrong theme. Dark is the default. `src/theme.ts` wires up the toggle button on every page.
- **Board & pieces** — every interactive board (Live & Engine, Opening Explorer) uses a lichess-green square theme and the "cburnett" piece set by Colin M.L. Burnett ([GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)), bundled under `public/pieces/cburnett/`.

## Install as an app / offline use

OpenFile is an installable PWA (Progressive Web App):

- **Install** — most browsers show an install prompt (address-bar icon, or browser menu → "Install OpenFile" / "Add to Home Screen"). Installed, it opens in its own window with no browser chrome, like a native app.
- **Offline** — a service worker caches the app shell and the Stockfish engine files after your first visit. Content-hashed JS/CSS/image assets are cache-first with a background refresh (safe, since a new build gets a new URL); HTML pages are network-first so you always get the latest version when online, falling back to the cached copy only when you're offline. Once the engine has loaded once, position analysis and PGN review keep working with no connectivity at all — handy in a tournament hall with bad wifi. Live game streaming and lichess study/search lookups still need a connection, since those are fetched from lichess's API rather than cached.

---

## Tool 2 — Live & Engine (`/live.html`)

Two modes, one board (Stockfish 18 runs locally in the browser). Layout follows chesscompass.com's analysis-board pattern: a large board (sized off both the available width and your screen's height, not a fixed cap) with engine feedback — candidate moves, move assessment, move list — docked in a compact panel immediately beside it in both modes, so you never have to scroll past the board to see it. Each mode's own setup form (FEN/PGN entry, or the lichess connect form) sits underneath the board instead, since it's used once per session rather than watched continuously.

**Any position**
- Paste a FEN or click pieces to play moves on the board (moves are validated by chess.js).
- **Suggest best move** runs Stockfish 18 to your chosen depth and shows the best move (as an arrow + SAN), the evaluation, the eval bar, and the full principal variation.
- **Play best move** applies it so you can walk a line forward; **Undo** / **Start position** to reset.
- The **opening name** (book lookup, no PGN headers needed) is shown once the moves played match a known line, and keeps updating as you navigate.

**Live lichess game / study / position**
- Paste a lichess **game** URL or 8-character ID and **Connect** — loads the full game so far (so you can step through everything already played) and then follows new moves live. The live move stream and the game-history backfill start at the same time rather than one waiting on the other, so a move played while the history is still loading isn't missed.
- Paste a lichess **study** link (with or without a chapter) to load that chapter as a static, navigable game — click pieces or step with ◀ ▶, same as Any Position. A study with multiple chapters loads chapter 1, with a note to paste a direct chapter link for another.
- Paste a lichess **analysis-board** link (with an embedded FEN) or just a bare **FEN** to load that single position.
- Every move gets **feedback** — Best / OK / Inaccuracy ?! / Mistake ? / Blunder ?? — based on the win-probability swing, with the engine's better move shown when relevant. The **● LIVE** badge (and jump-back-to-live button) only appears for an actual live game, not a study/position load.
- **⧉ Copy FEN** / **⧉ Copy PGN** copy the currently viewed position or the whole game-so-far straight to the clipboard. **🔎 Analyze in Any Position** goes further: it switches to Any Position mode, loads that exact position, and immediately kicks off a full-depth engine search (whatever depth is set there) — the quickest way to get a slower, deeper look at a live-game position than Live mode's own background candidate-move analysis gives you.

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
- **Number of rounds:** shown next to the roster format on the setup screen — leave it blank to use the auto-recommended round count (smallest r with 2^r ≥ player count, min 3, max 9), or set your own. The chosen (or recommended) total is stored on the event and shown as "X/Y rounds played" from then on. Pairing past that total still works — "Pair next round" just asks for confirmation first, e.g. for a play-off round or an unplanned tie-break round.
- **Bye requests:** if the roster's bye column names round(s) a player is sitting out (e.g. `3` or `4,5`), that player is automatically given a **half-point bye** in that round instead of being paired, and the rest of the field pairs normally around them. Requests that come up mid-event (a player asks to sit out a round *after* the tournament has already started) are handled by the collapsed **Bye requests** card (its header shows a live pending count so it's not silently forgotten): check off any player, pick an upcoming round, and it's honored the next time that round is paired — same half-point-bye mechanics as a roster-declared request, just added on the fly. Pending requests are listed with a one-click cancel until that round is actually paired.
- **Fixing a pairing mistake in the latest round:** each round has a collapsed **"⚙ Fix a mistake in this round"** panel (kept out of the way since it's for corrections, not the normal per-round flow) with three tools — a **swap-colors** button per board (flips White/Black; if a result was already entered, it's flipped along with the colors so the actual winner stays the winner), a **swap-with** picker per bye row (reassigns the bye to a different player currently in an unplayed game that round, giving the original bye recipient that player's board and color instead), and a **swap two players between boards** control (e.g. "board 2 ↔ board 3" — pick any two players from different unplayed boards and trade their opponents, each taking over the other's board and color slot). All three only work on the round most recently paired, and only on boards that haven't had a result entered yet — editing an earlier or already-played board would leave later rounds' pairings out of sync with the color-balance/opponent history they were built from.
- **Family / sibling groups:** the collapsed **Family / sibling groups** card lets you mark players who shouldn't meet each other — siblings, parent/child, spouses, whatever the field needs — by checking two or more players and giving the group an optional label. It's a soft preference, handled exactly like rematch avoidance: the engine tries every pairing option before letting two group members play each other, and only pairs them anyway if the round is otherwise unpairable (e.g. a small odd field where no conflict-free combination exists).
- **Pairing engine:** Dutch-style fold pairing — round 1 pairs the top half vs the bottom half by rating; later rounds pair within score groups, down-float odd players, avoid rematches *and* marked family/sibling conflicts (each with a global fallback that relaxes automatically if a strict, conflict-free pairing isn't possible), assign colors by USCF-style color-due strength (a third consecutive color or a 2-game imbalance outweighs a 1-game imbalance, which outweighs plain alternation), and assign a full-point bye to the lowest player who hasn't had one when the field (after bye requests) is odd.
- **"How pairing logic works"** — a collapsed guide above the round list explains the whole system up front, in plain language and with a small diagram: score groups and natural (top-half-vs-bottom-half) pairings, the pairing order (byes → score groups → floaters → rematch/family avoidance → full bye), and the W/WW/B/BB color-due codes and what triggers each.
- **"Why this pairing?"** — a small ⓘ button next to every board (and bye) opens a SwissSys-style breakdown covering every criterion the engine actually weighed, not just the final result:
  - An SVG diagram — a box per player connected by a labeled "Board N" line, a gold ⇣ arrow into whichever player's box floated down to complete an odd bracket, and the connecting line itself turning gold with a warning label for a forced family conflict (or dashed for a forced rematch).
  - A color-due flow showing exactly what each player was due (W/WW/B/BB, USCF-style: a third consecutive color or a 2-game imbalance outranks a 1-game imbalance, which outranks plain alternation) and whether they got it.
  - The full **score bracket**, ranked by rating and split into the top half/bottom half the fold algorithm draws from, with both paired players highlighted — so a TD can see not just who a player was paired with, but who else was in the pool and why this specific cross-half pairing was the natural one.
  - For a bye: every eligible candidate ranked by the same order the engine uses (fewest prior byes, then lowest score, then lowest rating), with the recipient highlighted.
  - A bullet-point summary underneath states the same facts in plain English.

  Works on any round, not just the latest, and is reconstructed from the round-by-round history rather than the pairing algorithm's internal trace, so it reports the objective facts of the match-up rather than re-simulating every tiebreak the algorithm weighed internally.
- **"How this round was paired"** — a collapsed panel under each round's pairing table shows the whole round at a glance: players grouped into the score brackets they entered the round with, a ⇣ badge (with a tooltip) on whoever floated down to complete an odd bracket, and a notes line calling out any forced rematches or forced family-group conflicts that round required.
- **Results & standings:** enter 1-0 / ½-½ / 0-1 per board; standings update live with **Buchholz** and **Sonneborn-Berger** tiebreaks, W/D/L (a requested half-point bye counts as a draw, a forced full-point bye counts as a win), and color balance.
- **Wall chart:** a crosstable — one row per player (current standings order), one column per round — showing exactly who they played, with what color, and the result (e.g. `8w+` = played standings-#8 as White and won; `4b=` = played #4 as Black and drew; a pending pairing shows the opponent with no result yet). The single most useful view for a TD or parent scanning for repeat opponents or checking a player's path through the event at a glance.
- **Persistence:** the whole event auto-saves in your browser (localStorage). **Export/Import** it as JSON, and **Print all standings** for posting — these, plus "Back to roster" and "Delete & start over," live behind a collapsed **"⋯ More options"** toggle next to "Pair next round" so the round-to-round controls stay down to just the one button you actually click every round.
- **Navigation:** every tool page has a **🏠 Home** link in the top nav back to the OpenFile hub — your tournament stays saved when you navigate away and back.

The pairing engine (`src/swissEngine.ts`) is pure and framework-free. It has been stress-tested across many field sizes, round counts, and result models: no rematches when mathematically avoidable, byes capped at one per player, and conserved scores.

---

## Tool 4 — Opening Explorer (`/opening-explorer.html`)

Turns your own PGNs into a branching opening tree — like [openingtree.com](https://www.openingtree.com/). Same chesscompass.com-style big-board layout as Live & Engine, in its own wider page (up to 1400px instead of the site's usual 1060px) since the tree/games panel needs more room than Live & Engine's feedback panel does.

- **Two independent profiles:** a **🧑 My Repertoire** / **🎯 Opponent Prep** tab switch at the top. Each holds its own loaded games, detected player, and tree entirely independently — load your own games in one tab and an upcoming opponent's account in the other, then flip between the two trees instantly with no re-fetching. A status line under the tabs always shows what's loaded in both.
- **Input (per profile):** drop PGN file(s), try the bundled sample, or fetch an account's games directly by username — from **lichess** (`GET lichess.org/api/games/user/:username`, streamed as PGN) or **chess.com** (its public "Published Data API": fetch the account's monthly archive list, then the N most recent months in parallel, concatenating each game's own `pgn` field; its `[Site]` header is never a real URL, so the game's separate `url` field is injected as a `[Link]` header so the games-list "View" link still resolves). Neither needs auth for public games. The main player is auto-detected the same way Performance Analysis does it (most frequent name across games, with casing/"Last, First"/nickname variants folded together) — no picking required; a username fetch skips the heuristic entirely and attributes every game to that account directly.
- **Tree:** built entirely client-side (`src/openingTree.ts`) by walking each game's move list into a trie, capped at 12 full moves (24 plies) — deeper transpositions rarely matter for repertoire prep. Every node tracks games/wins/draws/losses reached through it, plus a reference to every underlying game that passed through (shared object references, not clones — cheap even for a large tree).
- **Browsing:** a board (reusing the same `Board` component as Live & Engine) plus a clickable breadcrumb and a move-list table sorted by frequency, each row showing games played, score %, and a win/draw/loss bar. Click a move to drill in; **Back**/**Start**/flip to navigate. Switching profile tabs resets the browsing position back to the start.
- **Filters:** color (White/Black — rebuilds the tree and flips the board), and a minimum-games threshold to hide rarely-played branches.
- **Games reaching this position:** every individual game behind the current node — opponent, result, date, a link to the game if the PGN had one, and an expandable full move list. Paginated (50 / 100 / 250 / All per page, with Prev/Next) rather than capped, so a popular position with hundreds of games is still fully browsable, not just the first 50. The page resets to 1 whenever you move to a different position in the tree, but stays put if you're just changing the page size or paging through the current one. The same "Show" dropdown also has a **⬇ Download all as PGN** option — every game reaching that position (not just the current page), bundled into one multi-game PGN file with headers reconstructed from what the tree tracks (opponent, date, result relative to you, and a link back to the source game where one exists).

Not in v1 (noted as future work): variant support and master-game comparison — real openingtree.com features, scoped out to keep this focused. (The Lichess masters-database comparison was tried and removed — see git history — after their public API proved unreliable.)

---

## Tool 5 — Compare Reports (`/compare-reports.html`)

Upload two saved Performance Analysis `report.md` files and see every metric compared side by side, with the delta highlighted.

- **Input:** two independent drop zones, Report A (baseline) and Report B (compare against) — each takes a single saved `report.md`. A file that doesn't contain the embedded `chess-insight:data:v1` block is rejected with an inline error and clears that slot (a failed re-upload never leaves a stale comparison from a previous successful load showing).
- **What's compared:** the exact same aggregates Performance Analysis computes (`src/aggregate.ts`) for each report — overview score/games/accuracy, by-color (White/Black) breakdowns, by-time-control tables, per-phase (opening/middlegame/endgame) accuracy and errors, tactics (missed wins/mates/tactics, blunders), patterns (conversion rate, thrown wins, saves, time-pressure blunders), and an opening-by-opening score comparison matched by opening family, repeated per time control — openings present in only one report (or one time control) are marked "(only in A)" / "(only in B)" rather than silently dropped.
- **Delta semantics:** every row is colored green/red based on whether B is better or worse than A for *that specific metric* — e.g. a drop in losses or blunder rate is green (good), a drop in accuracy or score % is red (bad); count-only rows with no inherent direction (like game counts) are left uncolored. Tactics counts are normalized to **per-game rates** for the purpose of coloring (so a report with far more games isn't unfairly flagged worse just for having more raw blunders) — the raw counts are still shown alongside, uncolored, for reference.
- **Two modes, auto-detected:** if both reports have the same username, the page frames it as one player's **progress over time**. If the usernames differ, it switches to a **head-to-head** framing instead — same tables, same metrics, but the header shows a verdict card tallying which player leads on more of the compared metrics overall (e.g. "Alice comes out ahead, leading on 13 of 39 compared metrics"), handy for scouting an opponent or comparing two players directly.
- **Trend across reports:** a separate section below the A/B comparison accepts three or more `report.md` files at once (or added incrementally) for the same player, sorts them chronologically by report date, and charts overall score % and accuracy % over time — more signal than a single before/after snapshot. Reports for different usernames are still charted (in date order) but flagged with a warning, since a trend line only really means something for one player over time.

Pure comparison logic lives in `src/reportCompare.ts` (no DOM), separate from the `src/compareReports.ts` UI controller — same split used by Opening Explorer and the rating estimators. The trend and time-usage charts share a small generic SVG line-chart renderer, `src/linechart.ts`.

---

## Tool 6 — USCF Rating Estimator (`/rating.html`)

Estimate a new US Chess (USCF) rating after an event, using the published rating formula.

- **Inputs:** current rating, total score, number of prior rated games, age (optional), and up to 15 opponent ratings.
- **Formula:** implements the published US Chess rating formula (Glickman & Doan, "The US Chess Rating System," rev. Sept 2020), Sections 3–4.2. Per-game win expectancy uses the classic logistic curve (no rating-difference cap). The effective number of games is `N = min(priorGames, N*)`, where the rating-dependent ceiling `N* = 50 / sqrt(0.662 + 0.00000739 × (2569 − R)²)` (capped at 50 above rating 2355) — not a flat 50. Players with **8 or fewer** prior games use the simplified "special"/provisional formula (Section 4.1); above that, the standard formula applies with K = 800 / (N′ + m) and a bonus provision (bonus multiplier B = 10, effective 2025-06-03) added when the base change exceeds `B × √max(m, 4)`. Performance rating is derived from the average opponent rating and score percentage.
- **Dual-rated option:** "Use lower K values for high rated players (2200 and up) for estimating regular ratings in dual-rated events" — when checked and the current rating is above 2200, K is overridden: `K = 200/(N′+m)` at 2500+, or `K = 800(6.5 − 0.0025×R)/(N′+m)` between 2200 and 2500.
- **Output:** new rating, rating change, performance rating, K value, plus a detail table (win expectancy sum, effective N, established/provisional status, base change vs. bonus) and contextual notes (provisional-rating caveat, junior-player note, dual-rated applicability, single-event swing cap).

This is an **unofficial estimate**, clearly labeled as such in the tool — US Chess's actual post-event computation is run centrally (Glickman-based), also folding in opponent-repeat and all-win/all-loss adjustments this tool doesn't track, and may differ slightly. The engine (`src/ratingEngine.ts`) is pure and framework-free.

---

## Tool 7 — FIDE Rating Estimator (`/fide-rating.html`)

Estimate a new FIDE **Standard** rating after an event (Rapid/Blitz use separate rating pools and aren't covered).

- **Inputs:** current rating, total score, and up to 15 opponent ratings — no prior-games, age, or dual-rated fields (those are USCF-specific or not needed for this simplified estimate).
- **Formula:** the same win-expectancy logistic curve with the ±400 cap as the USCF tool, but a FIDE-style flat K-factor tier by rating instead of a dynamic N+games formula: **K = 20** below 2400, **K = 10** at 2400+. No bonus-points provision (FIDE Standard has none). Assumes an established rating — FIDE's K=40 tier for a player's first 30 rated games isn't modeled, since that needs a games-played input this tool omits.
- **Output:** new rating, rating change, performance rating, K value, plus games counted, win expectancy sum, and the K-factor tier reason. Notes flag the established-rating assumption and the sub-1400 publication floor.

Also an **unofficial estimate** (FIDE Handbook B.02) — actual FIDE processing is centralized and by rating period. The engine (`src/fideRatingEngine.ts`) is pure and framework-free.

---

### Engine notes

- First engine use downloads the ~7 MB Stockfish 18 (lite) build with its NNUE network embedded (served locally from `public/engine`), then it's cached — no separate network file, no cross-origin isolation headers needed.
