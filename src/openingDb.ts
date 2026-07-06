import { Chess } from 'chess.js';

export interface OpeningEntry {
  opening: string;
  eco?: string;
  moves?: string;
  firstMoves: string[];
  plans: {
    white: {
      plans: string[];
      keyThemes: string[];
      typicalManeuvres: string[];
      pieceActivation: string;
      pawnStructure: string;
      commonTactics: string[];
    };
    black: {
      plans: string[];
      keyThemes: string[];
      typicalManeuvres: string[];
      pieceActivation: string;
      pawnStructure: string;
      commonTactics: string[];
    };
  };
}

export const openingDb: OpeningEntry[] = [
  {
    opening: 'Sicilian Defense: Dragon Variation',
    eco: 'B76-B77',
    moves: '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 g6',
    firstMoves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'],
    plans: {
      white: {
        plans: [
          'Launch kingside pawn storm with f4 and advance to create attacking chances',
          'Maneuver pieces to attack Black\'s fianchettoed bishop (e.g., h4-h5 and Bh6)',
          'Create weaknesses around Black\'s king by advancing pawns',
          'Establish control of d5 square for piece domination',
          'Execute a coordinated queen and rook attack on the kingside',
        ],
        keyThemes: [
          'Kingside pawn storm',
          'Attacking king on fianchetto',
          'Piece coordination for attack',
          'Central domination with knight on d5',
          'Exploitation of weak light squares',
        ],
        typicalManeuvres: [
          'f4-f5 pawn push, potentially followed by e5',
          'Be3-f4-g5 to attack knights and weaken kingside',
          'Rook lift Rf1-h1 followed by Rh3 for kingside attack',
          'Queen to d2 or c2 to coordinate with attack',
          'Knight jumps: Ne4 to d5 is a powerful outpost',
        ],
        pieceActivation:
          'Place rooks on f-file and h-file for attack. Queen supports from d2 or d3. Knights dominate central squares, especially d5. Bishop pair controls long diagonals.',
        pawnStructure:
          'White maintains central tension with e4 and launches pawn storm with f4-f5. Black has a pawn on e6 (usually) which Black defends carefully. Kingside pawn majority becomes White\'s attacking weapon.',
        commonTactics: [
          'Discovered attacks when knights move',
          'Tactical shots on h7 and f7',
          'Back rank vulnerabilities',
          'Removal of kingside defenders',
          'Sacrificial patterns (e5, f5 followed by opening lines)',
        ],
      },
      black: {
        plans: [
          'Create counterplay on queenside and center before kingside attack arrives',
          'Activate queen and rooks on queenside with ...a6-a5 or queenside pawn advances',
          'Generate threats against White\'s center and king',
          'Maintain piece activity despite White\'s kingside pressure',
          'Seek tactics and complications to complicate White\'s attack',
        ],
        keyThemes: [
          'Queenside counterattack',
          'Central resistance',
          'Active piece play',
          'King safety on kingside',
          'Time is crucial—Black must generate threats quickly',
        ],
        typicalManeuvres: [
          'Bishop fianchetto controlling long diagonal',
          'Rook to b8 for queenside play',
          'Queen activation (Qa5, Qb6, Qc7)',
          '...a6 to prepare ...b5 advance',
          'Knight hops to e5 or f4 for activity',
        ],
        pieceActivation:
          'Fianchettoed bishop on g7 controls long diagonal toward White\'s king. Rooks to queenside (Rab8, Rfd8). Queen mobile on a5-b6-c7 line. Knights seek active squares like e5 or f4.',
        pawnStructure:
          'Black\'s fianchetto pawn structure on kingside is solid. Central e6 pawn holds the center. Black typically advances queenside pawns (...a6, ...b5) to create counterplay. Structure is flexible for defense.',
        commonTactics: [
          'Counterattacks on a2, b2, c2 squares',
          'Discovery with bishop from g7',
          'Knight fork opportunities from e5 or f4',
          'Back rank tactics',
          'Removing key attacking pieces (Nd4, f4 bishop)',
        ],
      },
    },
  },
  {
    opening: 'Sicilian Defense: Najdorf Variation',
    eco: 'B90-B99',
    moves: '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6',
    firstMoves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    plans: {
      white: {
        plans: [
          'Establish control in the center and prevent Black\'s bishop from c5',
          'Prepare f4 advance or Be2-f3 setup depending on variation',
          'Develop pieces to active squares and maintain space advantage',
          'Look for tactical opportunities around d6 and e6 squares',
          'Exploit Black\'s slightly loose pawn structure with accurate piece placement',
        ],
        keyThemes: [
          'Center control',
          'Piece activity',
          'Prophylactic thinking',
          'Space advantage',
          'Positional pressure',
        ],
        typicalManeuvres: [
          'f4 advance to gain space (6.Be2 is alternative)',
          'Kh1 to prevent back rank issues',
          'Rook swings: Rf2-g2 or h2 for kingside pressure',
          'Knight repositioning with Nb3-d4-f5',
          'Be3 or Bf4 for piece coordination',
        ],
        pieceActivation:
          'Active piece play with well-placed knights and bishops. Rooks connect for potential attack. Queen supports center or kingside operation. Maintain flexibility for various plans.',
        pawnStructure:
          'White keeps central pawns and often plays f4 for space. Pawn structure remains relatively fixed, giving White space advantage. e4 pawn is solid central foundation.',
        commonTactics: [
          'Attacks on weak d6 pawn',
          'Knight fork opportunities',
          'Removal of defenders',
          'Pushing e5 in certain positions',
          'Discovered attacks with piece moves',
        ],
      },
      black: {
        plans: [
          'Complete development and create counterplay with ...e5 or queenside action',
          'Activate pieces with ...e6, ...Nbd7, ...Be7, and look for ...b5 or ...e5',
          'Create central tension to reduce White\'s space advantage',
          'Generate queenside or central threats before White\'s kingside attack',
          'Maintain piece coordination and look for tactical opportunities',
        ],
        keyThemes: [
          'Flexible piece setup',
          'Central counterplay',
          'Kingside solidity',
          'Queenside generation of threats',
          'Piece activity and coordination',
        ],
        typicalManeuvres: [
          '...e5 or ...e6 depending on setup',
          '...Nbd7 to support center',
          '...Be7 for solid defense',
          '...b5 for queenside expansion',
          'Queen to c7 for flexibility',
        ],
        pieceActivation:
          'Pieces develop toward central squares and queenside. Rooks connect and can move to active files. Queen flexible on c7 or a5. Knights occupy strong outposts.',
        pawnStructure:
          'Black\'s pawn structure is solid. Often Black has d6 and e6/e5 pawns as foundation. The ...a6 move prevents Nb5 ideas but can become a target. Queenside expansion with ...b5 is typical.',
        commonTactics: [
          'Counterattacks against a2 or b2',
          'Knight jumps to active squares',
          'Central breaks with ...e5',
          'Piece sacrifices for activity',
          'Removal of key attacking pieces',
        ],
      },
    },
  },
  {
    opening: 'Ruy Lopez: Open Variation',
    eco: 'C80-C99',
    moves: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.0-0 Nxe4',
    firstMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', '0-0', 'Nxe4'],
    plans: {
      white: {
        plans: [
          'Create central pressure and coordinate pieces to attack d5 square',
          'Move d4 to open lines and create imbalances',
          'Generate threats against Black\'s king or weak pawns',
          'Exploit Black\'s development lag from taking on e4',
          'Improve piece coordination with focused attack',
        ],
        keyThemes: [
          'Central control',
          'Active piece play',
          'Kingside attacking chances',
          'Exploitation of e5 pawn weakness',
          'Piece coordination',
        ],
        typicalManeuvres: [
          'd4 to create central tension',
          'Re1 to pressure e-file',
          'Nc3 developing with tempo (attacking e4 knight)',
          'Bf4 to control central squares',
          'Nxe5 tactical ideas',
        ],
        pieceActivation:
          'Active knights on c3 and f3 (or e5). Bishops on a2 diagonal and c-file direction. Rooks potentially on e-file or f-file. Queen ready to join attack.',
        pawnStructure:
          'White controls e4 square. Pawns stay central. d4 push creates immediate tension and imbalance. Pawn structure dynamic and fluid.',
        commonTactics: [
          'Knight tactics on e4 and e5',
          'Back rank issues',
          'Fork tricks with rooks and knights',
          'Removal of key pieces',
          'Central breaks',
        ],
      },
      black: {
        plans: [
          'Develop pieces quickly (Nf6, Be7, 0-0 typically)',
          'Create central counterplay with d5 or other central moves',
          'Activate queen and rooks for defense or counterattack',
          'Establish piece coordination to resist White\'s pressure',
          'Create complications and tactics to neutralize White\'s initiative',
        ],
        keyThemes: [
          'Quick development',
          'Central resistance',
          'Active defense',
          'Generating counterplay',
          'Piece coordination',
        ],
        typicalManeuvres: [
          'd5 central break',
          'Nf6 developing with tempo',
          'Be7 solid development',
          'c6 to support center and prepare queenside play',
          'Rook activation (Rae8 or other)',
        ],
        pieceActivation:
          'Knights actively placed on f6 and d7 or c6. Bishops on e7 and f8 (or c8). Rooks connect and potentially move to e-file. Queen flexible on various squares.',
        pawnStructure:
          'Black has e5 pawn that needs defending. Central pawns d5 and c6 often feature. Pawn structure solid but requires accurate play to balance.',
        commonTactics: [
          'Central breaks with d5',
          'Removing attacking pieces',
          'Piece sacrifices for activity',
          'Counterattacks',
          'Defensive tactics to resolve pressure',
        ],
      },
    },
  },
  {
    opening: 'French Defense: Winawer Variation',
    eco: 'C01-C02',
    moves: '1.e4 e6 2.d4 d5 3.Nc3 Bb4',
    firstMoves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'],
    plans: {
      white: {
        plans: [
          'Maintain central space with e5 pawn push and solid pawn center',
          'Create kingside attacking chances with kingside piece placement',
          'Control central squares (especially d4 and e5)',
          'Generate pressure on Black\'s queenside with f4 ideas',
          'Exploit pins on c3 knight with accurate maneuvres',
        ],
        keyThemes: [
          'Space advantage',
          'Central control',
          'Kingside attacking ideas',
          'Piece coordination against Black\'s bishop pair',
          'Exploitation of pin on c3 knight',
        ],
        typicalManeuvres: [
          'e5 pawn advance to gain space',
          'f4 for kingside expansion',
          'Bd2 to unpin and develop',
          'Nge2 or Nf3 development depending on variation',
          'Be2 or Be3 for solid piece placement',
        ],
        pieceActivation:
          'Knights well-placed to support center and kingside. Bishops coordinate on light and dark squares. Rooks potentially activate on kingside. Queen supports attack.',
        pawnStructure:
          'White\'s e5 pawn is strong and gives space. d4 pawn anchors center. f4 can follow for kingside expansion. Pawn structure controls board.',
        commonTactics: [
          'Removing Black\'s fianchettoed bishop',
          'Tactics involving c3 knight pin',
          'Kingside breakthrough ideas',
          'Exploitation of e6 weakness',
          'Central breaks',
        ],
      },
      black: {
        plans: [
          'Complete development and create active piece play to compensate for space disadvantage',
          'Exchange pieces especially bishops to reduce White\'s attacking potential',
          'Generate counterplay on queenside with ...b6 and piece activity',
          'Create central tension to reduce White\'s space',
          'Coordinate pieces for active defense or counterattack',
        ],
        keyThemes: [
          'Active piece play despite space disadvantage',
          'Piece exchanges to reduce attacking potential',
          'Queenside counterplay',
          'Central resistance',
          'Dynamic compensation',
        ],
        typicalManeuvres: [
          'Bxc3 to eliminate White\'s knight',
          '...Nc6 or ...Nd7 for piece activity',
          '...c5 central break',
          '...b6 and ...Ba6 for queenside activity',
          '...Bd7 for support and flexibility',
        ],
        pieceActivation:
          'Bishop pair activated on long diagonals and dark squares. Knights placed on active central squares. Rooks potentially on c-file or queenside. Queen flexible.',
        pawnStructure:
          'Black\'s e6 pawn is solid. Pawns on d5 and c5 or b6 create pawn tension. Pawn structure is flexible and can adapt to position.',
        commonTactics: [
          'Removing attacking pieces',
          'Central breaks with ...c5',
          'Bishop pair advantages',
          'Queenside tactics',
          'Piece sacrifices for activity',
        ],
      },
    },
  },
  {
    opening: 'Caro-Kann Defense: Classical Variation',
    eco: 'D10-D19',
    moves: '1.d4 d5 2.c4 dxc4 3.Nf3 Nf6 4.Nc3 a6',
    firstMoves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'Nc3', 'a6'],
    plans: {
      white: {
        plans: [
          'Recapture the c4 pawn and establish central control',
          'Launch kingside attack or create central pressure',
          'Develop pieces actively and create space advantage',
          'Exploit Black\'s slightly cramped position with piece coordination',
          'Create imbalances and pressure with pawn advances',
        ],
        keyThemes: [
          'Recapturing c4 pawn',
          'Central control',
          'Space advantage',
          'Piece activity',
          'Kingside pressure',
        ],
        typicalManeuvres: [
          'e3 and Bxc4 to recapture and develop',
          'Bf4 for piece activity',
          'Be2 or Bf1 for flexible development',
          'f4 for kingside expansion',
          'Nge2 or Nf3 development',
        ],
        pieceActivation:
          'Knight on c3 and f3 or e2. Bishops on c4 and f4 or e3. Rooks on d-file or kingside. Queen ready for support.',
        pawnStructure:
          'White has e3 pawn as foundation. After recapturing on c4, White has space in center. Pawn structure is solid and can expand.',
        commonTactics: [
          'Exploiting weak squares in Black\'s position',
          'Tactics on a6 pawn',
          'Piece forks and pins',
          'Central breaks',
          'Kingside breakthrough ideas',
        ],
      },
      black: {
        plans: [
          'Complete solid development with ...e6, ...Be7, ...0-0',
          'Create central counterplay and resist White\'s space advantage',
          'Generate activity on queenside or center',
          'Exchange pieces to reduce White\'s attacking potential',
          'Seek dynamic counterplay through piece coordination',
        ],
        keyThemes: [
          'Solid defense',
          'Central resistance',
          'Piece activity',
          'Queenside counterplay',
          'Dynamic compensation for space',
        ],
        typicalManeuvres: [
          '...e6 solid pawn support',
          '...Be7 for development',
          '...Nbd7 for piece activity',
          '...c5 central break',
          '...b5 or ...a5 for queenside expansion',
        ],
        pieceActivation:
          'Pieces develop toward center and queenside. Rooks potentially active on c-file or queenside. Queen flexible. Knights well-placed.',
        pawnStructure:
          'Black\'s d5 pawn is solid. e6 pawn supports center. Queenside pawns (a6, b5, c5) can create pawn tension. Structure is flexible.',
        commonTactics: [
          'Central breaks with c5',
          'Queenside tactics',
          'Piece removals',
          'Back rank considerations',
          'Counterattacks against White\'s center',
        ],
      },
    },
  },
  {
    opening: 'King\'s Indian Defense',
    eco: 'E60-E99',
    moves: '1.d4 Nf6 2.c4 g6 3.Nc3 Bg7',
    firstMoves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'],
    plans: {
      white: {
        plans: [
          'Establish central control with e4 and maintain space advantage',
          'Create queenside pressure with moves like b4 or a4',
          'Exploit the space advantage to restrict Black\'s pieces',
          'Create imbalances by controlling key central squares',
          'Generate tactical opportunities from space control',
        ],
        keyThemes: [
          'Central space control',
          'Queenside expansion',
          'Exploitation of space advantage',
          'Piece coordination',
          'Pawn structure control',
        ],
        typicalManeuvres: [
          'e4 to establish strong center',
          'Be2 or Nf3 for development',
          'Be3 for piece coordination',
          'f3 to support center',
          'Qd2 for flexibility',
        ],
        pieceActivation:
          'Knights on c3 and f3 supporting center. Bishops on e2 and e3. Rooks ready for queenside (Rfc1) or center operations. Queen flexible.',
        pawnStructure:
          'White establishes d4 and e4 pawns for strong center. c4 pawn supports center control. f3 can follow for pawn structure stability.',
        commonTactics: [
          'Attacking g7 bishop setup',
          'Exploiting e5 or d5 square weaknesses',
          'Queenside pawn breaks',
          'Central tactics',
          'Piece removals against fianchetto',
        ],
      },
      black: {
        plans: [
          'Create counterplay with ...e5 break to challenge White\'s center',
          'Activate pieces with ...c6, ...Nbd7, ...Bg7',
          'Generate pressure on queenside and center',
          'Exchange pieces to reduce White\'s space advantage',
          'Launch kingside counterattack in certain variations',
        ],
        keyThemes: [
          'Fianchetto bishop activity',
          'Central counterplay with ...e5',
          'Piece flexibility',
          'Kingside or queenside attacks',
          'Dynamic play against space advantage',
        ],
        typicalManeuvres: [
          'Fianchetto with ...g6 and ...Bg7',
          '...e5 central break to challenge White\'s center',
          '...c6 for support and flexibility',
          '...Nbd7 for piece coordination',
          '...0-0 for king safety',
        ],
        pieceActivation:
          'Fianchettoed bishop on g7 is strong. Rooks connect and potentially move to center or queenside. Queen flexible on various squares. Knights active.',
        pawnStructure:
          'Black\'s pawn structure is flexible. Fianchetto structure with g6 is solid. Central ...e5 break challenges White\'s center. Pawns adjust based on position.',
        commonTactics: [
          'Central break with ...e5',
          'Fianchetto bishop tactics',
          'Knight maneuvers to active squares',
          'Counterthrusts against White\'s center',
          'Piece sacrifices for activity',
        ],
      },
    },
  },
  {
    opening: 'Nimzo-Indian Defense',
    eco: 'E20-E59',
    moves: '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4',
    firstMoves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
    plans: {
      white: {
        plans: [
          'Control central squares and exploit the pin on c3 knight',
          'Create space advantage with pawn moves and piece activity',
          'Exploit the c4 pawn with central support',
          'Generate queenside pressure or kingside attack',
          'Coordinate pieces for a sustained initiative',
        ],
        keyThemes: [
          'Central control',
          'Exploitation of c3 pin',
          'Space advantage',
          'Piece coordination',
          'Queenside or kingside initiative',
        ],
        typicalManeuvres: [
          'Qc2 for queen activity and bishop pressure',
          'a3 to eliminate the pin (forcing ...Bxc3)',
          'e3 or e4 for center control',
          'Bd2 to prepare kingside or unpin',
          'Nf3 for piece development',
        ],
        pieceActivation:
          'Knights on c3 and f3 for center control. Bishops on d2 and e3 for piece coordination. Rooks potentially on c-file. Queen active on c2.',
        pawnStructure:
          'White controls center with d4 pawn. c4 pawn supports. e3 or e4 pawns strengthen center. Structure is solid and gives White space.',
        commonTactics: [
          'Exploiting c3 knight pin',
          'Central breaks',
          'Removal of fianchettoed bishop',
          'Queenside tactics',
          'Piece sacrifices for initiative',
        ],
      },
      black: {
        plans: [
          'Create active counterplay with ...c5 or ...d5 central breaks',
          'Activate pieces toward center and kingside',
          'Exchange pieces to reduce White\'s initiative',
          'Generate queenside or central pressure',
          'Coordinate pieces for dynamic compensation',
        ],
        keyThemes: [
          'Active counterplay',
          'Central breaks',
          'Piece activity',
          'Piece exchanges',
          'Dynamic compensation for space',
        ],
        typicalManeuvres: [
          '...Bxc3 to eliminate knight and fix c4 pawn',
          '...d6 or ...d5 for central activity',
          '...c5 central break',
          '...Nbd7 or ...Na6 for piece activity',
          '...0-0 for king safety',
        ],
        pieceActivation:
          'Pieces activate toward center. Rooks connect and potentially move to c-file or center. Queen flexible on various squares. Knights active.',
        pawnStructure:
          'Black\'s solid pawn structure with e6 and d-pawns. Central breaks with ...d5 or ...c5 are typical. Pawn structure flexible for various plans.',
        commonTactics: [
          'Central breaks',
          'Counterattacks against c4 pawn',
          'Piece removals',
          'Back rank tactics',
          'Tactical blows against White\'s center',
        ],
      },
    },
  },
  {
    opening: 'English Opening',
    eco: 'A10-A39',
    moves: '1.c4 e5',
    firstMoves: ['c4', 'e5'],
    plans: {
      white: {
        plans: [
          'Establish control of d5 square and create space advantage',
          'Maneuver pieces to strong squares and create imbalances',
          'Generate pressure on kingside or queenside based on Black\'s setup',
          'Maintain flexibility and adapt to Black\'s counterplay',
          'Create strategic pressure from the c4 opening',
        ],
        keyThemes: [
          'Control of d5 square',
          'Flexible piece placement',
          'Space management',
          'Strategic pressure',
          'Positional advantage',
        ],
        typicalManeuvres: [
          'Nf3 to support d5 control',
          'g3 and Bg2 for fianchetto',
          'd4 to challenge center',
          'Nc3 for piece development',
          'e3 for flexible pawn structure',
        ],
        pieceActivation:
          'Knights on f3 and c3 for central control. Bishops on g2 and e3 for long diagonal and piece coordination. Rooks potentially on d-file or c-file. Queen flexible.',
        pawnStructure:
          'White\'s c4 pawn is key. Flexible pawn structure that can adapt. g3 and e3 create solid foundation. d4 can be played for central tension.',
        commonTactics: [
          'Tactics on d5 square',
          'Piece maneuvres around center',
          'Queenside or kingside play',
          'Pawn breaks',
          'Positional squeezes',
        ],
      },
      black: {
        plans: [
          'Challenge White\'s center and create central counterplay',
          'Develop pieces actively and generate threats',
          'Create space for own pieces and restrict White\'s maneuvres',
          'Generate either kingside or queenside attacks based on position',
          'Maintain dynamic play to neutralize White\'s pressure',
        ],
        keyThemes: [
          'Active piece play',
          'Central resistance',
          'Piece flexibility',
          'Creating threats',
          'Dynamic compensation',
        ],
        typicalManeuvres: [
          'd5 to challenge c4 pawn',
          'Nc6 for piece activity',
          'Bg4 for piece activity',
          'Be6 for solid development',
          'f5 for kingside expansion (in some lines)',
        ],
        pieceActivation:
          'Pieces activate toward center and kingside/queenside. Rooks connect and potentially move to central files. Queen flexible. Bishops active.',
        pawnStructure:
          'Black\'s pawn structure is flexible. Central pawns d5 and e5 create tension. Pawn structure adapts to position.',
        commonTactics: [
          'Central breaks with d5',
          'Piece activity against White\'s center',
          'Tactical opportunities',
          'Kingside or queenside breaks',
          'Counterattacks',
        ],
      },
    },
  },
];

export function findOpeningByName(query: string): OpeningEntry[] {
  const lower = query.toLowerCase();
  return openingDb.filter(
    (o) =>
      o.opening.toLowerCase().includes(lower) ||
      (o.moves && o.moves.toLowerCase().includes(lower)) ||
      (o.eco && o.eco.toLowerCase().includes(lower))
  );
}

export function findOpeningByMoves(moves: string[]): OpeningEntry[] {
  return openingDb.filter((opening) => {
    if (moves.length < opening.firstMoves.length) return false;

    for (let i = 0; i < opening.firstMoves.length; i++) {
      if (moves[i].toLowerCase() !== opening.firstMoves[i].toLowerCase()) {
        return false;
      }
    }
    return true;
  });
}
