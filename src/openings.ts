/**
 * Opening identification.
 * Preference order: PGN "Opening" header (lichess) > ECOUrl (chess.com) > built-in book by move prefix.
 */

const BOOK: [string, string][] = [
  // [space-joined SAN prefix, name] — longest prefix wins
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy Lopez: Morphy Defense'],
  ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game: Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game: Two Knights Defense'],
  ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
  ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'Four Knights Game'],
  ['e4 e5 Nf3 Nf6', 'Petrov Defense'],
  ['e4 e5 Nf3 d6', 'Philidor Defense'],
  ['e4 e5 Nf3', 'King\'s Knight Opening'],
  ['e4 e5 Nc3', 'Vienna Game'],
  ['e4 e5 Bc4', 'Bishop\'s Opening'],
  ['e4 e5 f4', 'King\'s Gambit'],
  ['e4 e5 Qh5', 'Wayward Queen Attack'],
  ['e4 e5', 'King\'s Pawn Game'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Sicilian Defense: Najdorf Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'Sicilian Defense: Dragon Variation'],
  ['e4 c5 Nf3 d6', 'Sicilian Defense: Open'],
  ['e4 c5 Nf3 Nc6', 'Sicilian Defense: Old Sicilian'],
  ['e4 c5 Nf3 e6', 'Sicilian Defense: French Variation'],
  ['e4 c5 c3', 'Sicilian Defense: Alapin Variation'],
  ['e4 c5 Nc3', 'Sicilian Defense: Closed'],
  ['e4 c5', 'Sicilian Defense'],
  ['e4 e6 d4 d5 Nc3', 'French Defense: Main Line'],
  ['e4 e6 d4 d5 e5', 'French Defense: Advance Variation'],
  ['e4 e6 d4 d5 exd5', 'French Defense: Exchange Variation'],
  ['e4 e6', 'French Defense'],
  ['e4 c6 d4 d5 Nc3', 'Caro-Kann Defense: Main Line'],
  ['e4 c6 d4 d5 e5', 'Caro-Kann Defense: Advance Variation'],
  ['e4 c6 d4 d5 exd5', 'Caro-Kann Defense: Exchange Variation'],
  ['e4 c6', 'Caro-Kann Defense'],
  ['e4 d5', 'Scandinavian Defense'],
  ['e4 d6 d4 Nf6', 'Pirc Defense'],
  ['e4 d6', 'Pirc Defense'],
  ['e4 g6', 'Modern Defense'],
  ['e4 Nf6', 'Alekhine Defense'],
  ['d4 d5 c4 e6 Nc3 Nf6', 'Queen\'s Gambit Declined: Main Line'],
  ['d4 d5 c4 e6', 'Queen\'s Gambit Declined'],
  ['d4 d5 c4 c6', 'Slav Defense'],
  ['d4 d5 c4 dxc4', 'Queen\'s Gambit Accepted'],
  ['d4 d5 c4', 'Queen\'s Gambit'],
  ['d4 d5 Nf3 Nf6 Bf4', 'London System'],
  ['d4 d5 Bf4', 'London System'],
  ['d4 Nf6 Bf4', 'London System'],
  ['d4 d5 Nf3', 'Queen\'s Pawn Game: Zukertort'],
  ['d4 d5 e3', 'Queen\'s Pawn Game: Colle-ish'],
  ['d4 d5', 'Queen\'s Pawn Game'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian Defense'],
  ['d4 Nf6 c4 e6 Nf3 b6', 'Queen\'s Indian Defense'],
  ['d4 Nf6 c4 e6 g3', 'Catalan Opening'],
  ['d4 Nf6 c4 g6 Nc3 d5', 'Grünfeld Defense'],
  ['d4 Nf6 c4 g6', 'King\'s Indian Defense'],
  ['d4 Nf6 c4 c5', 'Benoni Defense'],
  ['d4 Nf6 c4 e5', 'Budapest Gambit'],
  ['d4 Nf6 c4', 'Indian Game'],
  ['d4 Nf6 Bg5', 'Trompowsky Attack'],
  ['d4 Nf6', 'Indian Game'],
  ['d4 f5', 'Dutch Defense'],
  ['d4 e6', 'Queen\'s Pawn Game: Franco-Sicilian'],
  ['d4', 'Queen\'s Pawn Opening'],
  ['c4 e5', 'English Opening: Reversed Sicilian'],
  ['c4 c5', 'English Opening: Symmetrical'],
  ['c4', 'English Opening'],
  ['Nf3 d5 g3', 'King\'s Indian Attack'],
  ['Nf3 d5 c4', 'Réti Opening'],
  ['Nf3', 'Réti / Zukertort Opening'],
  ['f4', 'Bird\'s Opening'],
  ['b3', 'Nimzo-Larsen Attack'],
  ['b4', 'Polish Opening'],
  ['g3', 'King\'s Fianchetto Opening'],
  ['g4', 'Grob\'s Attack'],
  ['f3', 'Barnes Opening'],
  ['Nc3', 'Van Geet Opening'],
  ['e4', 'King\'s Pawn Opening'],
];

// Longest prefixes first so the first match is the most specific.
const SORTED_BOOK = [...BOOK].sort((a, b) => b[0].length - a[0].length);

function fromEcoUrl(url: string): string | null {
  const m = url.match(/\/openings\/([^/?#]+)/);
  if (!m) return null;
  let name = decodeURIComponent(m[1]).replace(/-/g, ' ');
  // chess.com appends move sequences like "...Defense 3.Nc3 dxe4" — cut at first digit+dot token
  name = name.replace(/\s+\d+\..*$/, '').trim();
  return name || null;
}

export function identifyOpening(
  headers: Record<string, string>,
  sans: string[]
): { eco: string; opening: string; family: string } {
  const eco = headers['ECO'] && headers['ECO'] !== '?' ? headers['ECO'] : '';
  let opening = '';
  if (headers['Opening'] && headers['Opening'] !== '?') opening = headers['Opening'];
  else if (headers['ECOUrl']) opening = fromEcoUrl(headers['ECOUrl']) ?? '';
  if (!opening) {
    const line = sans.slice(0, 12).join(' ');
    for (const [prefix, name] of SORTED_BOOK) {
      if (line.startsWith(prefix)) {
        opening = name;
        break;
      }
    }
  }
  if (!opening) opening = 'Unknown Opening';
  const family = opening.split(':')[0].split(',')[0].trim();
  return { eco, opening, family };
}
