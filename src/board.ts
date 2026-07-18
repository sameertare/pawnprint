/** Presentation-only chessboard: renders from FEN, supports highlights, a move arrow, and click callbacks. */

// Piece art: lichess's "cburnett" set (Colin M.L. Burnett, GPLv2+ — see public/pieces/cburnett).
// Base-path aware so it resolves correctly under a subpath (e.g. GitHub Pages project sites).
const PIECE_URL = (code: string) => `${import.meta.env.BASE_URL}pieces/cburnett/${code}.svg`;

export type Square = string; // 'e4'

export interface RankedArrow {
  from: Square;
  to: Square;
  rank: 1 | 2 | 3; // 1 = best move (thickest/brightest), higher ranks progressively thinner/dimmer
}

const ARROW_STYLE: Record<1 | 2 | 3, { color: string; width: number; opacity: number }> = {
  1: { color: 'var(--accent)', width: 0.16, opacity: 0.9 },
  2: { color: 'var(--gold)', width: 0.11, opacity: 0.75 },
  3: { color: 'var(--blue)', width: 0.08, opacity: 0.65 },
};

export class Board {
  private root: HTMLElement;
  private orientation: 'w' | 'b' = 'w';
  private fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  private selected: Square | null = null;
  private highlights = new Set<Square>();
  private lastMove: [Square, Square] | null = null;
  private arrows: RankedArrow[] = [];
  onSquareClick?: (sq: Square) => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('board-wrap');
    this.render();
  }

  setOrientation(o: 'w' | 'b') { this.orientation = o; this.render(); }
  flip() { this.orientation = this.orientation === 'w' ? 'b' : 'w'; this.render(); }
  getOrientation() { return this.orientation; }

  setFen(fen: string) { this.fen = fen; this.render(); }
  getSelected() { return this.selected; }
  setSelected(sq: Square | null) { this.selected = sq; this.render(); }
  setHighlights(sqs: Square[]) { this.highlights = new Set(sqs); this.render(); }
  setLastMove(m: [Square, Square] | null) { this.lastMove = m; this.render(); }
  /** Single best-move arrow (rank 1). Convenience wrapper over setArrows. */
  setArrow(m: [Square, Square] | null) { this.arrows = m ? [{ from: m[0], to: m[1], rank: 1 }] : []; this.render(); }
  /** Up to a few ranked candidate-move arrows, rendered thickest/brightest for rank 1. */
  setArrows(arrows: RankedArrow[]) { this.arrows = arrows; this.render(); }

  private files(): string[] {
    const f = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    return this.orientation === 'w' ? f : [...f].reverse();
  }
  private ranks(): number[] {
    const r = [8, 7, 6, 5, 4, 3, 2, 1];
    return this.orientation === 'w' ? r : [...r].reverse();
  }

  private board2d(): Record<Square, string> {
    const rows = this.fen.split(' ')[0].split('/');
    const map: Record<Square, string> = {};
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) file += parseInt(ch, 10);
        else {
          const sq = 'abcdefgh'[file] + (8 - r);
          map[sq] = ch;
          file++;
        }
      }
    }
    return map;
  }

  private centerPct(sq: Square): { x: number; y: number } {
    const fi = this.files().indexOf(sq[0]);
    const ri = this.ranks().indexOf(parseInt(sq[1], 10));
    return { x: fi + 0.5, y: ri + 0.5 };
  }

  private render() {
    const map = this.board2d();
    const files = this.files();
    const ranks = this.ranks();
    let html = '<div class="board">';
    for (let ri = 0; ri < 8; ri++) {
      for (let fi = 0; fi < 8; fi++) {
        const sq = files[fi] + ranks[ri];
        const dark = (fi + ri) % 2 === 1;
        const cls = ['sq', dark ? 'dark' : 'light'];
        if (this.selected === sq) cls.push('sel');
        if (this.highlights.has(sq)) cls.push('hl');
        if (this.lastMove && (this.lastMove[0] === sq || this.lastMove[1] === sq)) cls.push('last');
        const piece = map[sq];
        const coord =
          (fi === 0 ? `<span class="coord rank">${ranks[ri]}</span>` : '') +
          (ri === 7 ? `<span class="coord file">${files[fi]}</span>` : '');
        const code = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') + piece.toUpperCase() : '';
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${coord}${
          piece ? `<img class="pc" src="${PIECE_URL(code)}" alt="" draggable="false" />` : ''
        }</div>`;
      }
    }
    html += '</div>';

    if (this.arrows.length) {
      const defs = ([1, 2, 3] as const)
        .map((r) => `<marker id="ah${r}" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 z" fill="${ARROW_STYLE[r].color}"/></marker>`)
        .join('');
      // Draw lowest rank first so the best-move arrow (rank 1) ends up on top.
      const lines = [...this.arrows]
        .sort((x, y) => y.rank - x.rank)
        .map((ar) => {
          const a = this.centerPct(ar.from);
          const b = this.centerPct(ar.to);
          const s = ARROW_STYLE[ar.rank];
          return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${s.color}" stroke-width="${s.width}"
            stroke-linecap="round" opacity="${s.opacity}" marker-end="url(#ah${ar.rank})"/>`;
        })
        .join('');
      html += `<svg class="board-arrows" viewBox="0 0 8 8" preserveAspectRatio="none"><defs>${defs}</defs>${lines}</svg>`;
    }
    this.root.innerHTML = html;

    this.root.querySelectorAll<HTMLElement>('.sq').forEach((el) => {
      el.addEventListener('click', () => this.onSquareClick?.(el.dataset.sq as Square));
    });
  }
}
