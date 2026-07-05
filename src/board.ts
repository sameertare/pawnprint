/** Presentation-only chessboard: renders from FEN, supports highlights, a move arrow, and click callbacks. */

const GLYPHS: Record<string, string> = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

export type Square = string; // 'e4'

export class Board {
  private root: HTMLElement;
  private orientation: 'w' | 'b' = 'w';
  private fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  private selected: Square | null = null;
  private highlights = new Set<Square>();
  private lastMove: [Square, Square] | null = null;
  private arrow: [Square, Square] | null = null;
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
  setArrow(m: [Square, Square] | null) { this.arrow = m; this.render(); }

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
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${coord}${
          piece ? `<span class="pc ${piece === piece.toUpperCase() ? 'white' : 'black'}">${GLYPHS[piece]}</span>` : ''
        }</div>`;
      }
    }
    html += '</div>';

    if (this.arrow) {
      const a = this.centerPct(this.arrow[0]);
      const b = this.centerPct(this.arrow[1]);
      html += `<svg class="board-arrows" viewBox="0 0 8 8" preserveAspectRatio="none">
        <defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 z" fill="var(--accent)"/></marker></defs>
        <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent)" stroke-width="0.16"
          stroke-linecap="round" opacity="0.85" marker-end="url(#ah)"/></svg>`;
    }
    this.root.innerHTML = html;

    this.root.querySelectorAll<HTMLElement>('.sq').forEach((el) => {
      el.addEventListener('click', () => this.onSquareClick?.(el.dataset.sq as Square));
    });
  }
}
