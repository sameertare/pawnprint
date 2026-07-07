// Middlegame strategy database for common openings
export const openingDatabase = {
  "Sicilian Defense": {
    White: {
      plans: [
        "Control the d5 square and prevent Black's counterplay",
        "Develop with tempo by attacking the d6 pawn or c6 knight",
        "Launch a kingside attack once pieces are active",
        "Create threats along the d-file to exploit the central weakness",
        "Coordinate rooks and queen for a decisive attack"
      ],
      keyThemes: [
        "Central control (d4/d5 square)",
        "Kingside attack",
        "Piece development advantage",
        "Exploiting d6 weakness",
        "Time advantage from forcing play"
      ],
      pawnStructure: "Your e4 and d4 pawns control the center. Black's d6 pawn is often weak. Avoid premature pawn breaks that damage your position. Push f4 only when the kingside is secure.",
      pieceActivation: "Place your knight on d5 (outpost), maneuver bishops to active diagonals, centralize rooks on d and f files. Consider Bb5+ to develop with tempo.",
      typicalManeuvres: [
        "Nd5 forcing rook moves or exchanges",
        "f4 followed by f5 to open kingside",
        "Bb5+ followed by Bxc6 to damage structure",
        "Qe2-h5 preparing kingside attack",
        "Rook infiltration on d6 or d7"
      ],
      commonTactics: [
        "Back rank weaknesses in Black's position",
        "Undefended pieces on d6 and f7",
        "Sacrifices on d6 or e6 for attack",
        "Pin tactics along the d-file",
        "Discovered attacks with knight from d5"
      ]
    },
    Black: {
      plans: [
        "Generate immediate counterplay on the queenside or center",
        "Activate your pieces before White completes development",
        "Create threats that force White to respond defensively",
        "Look for tactical breaks with ...e5 or ...c5",
        "Exploit any weakness in White's kingside"
      ],
      keyThemes: [
        "Queenside counterplay",
        "Central breaks",
        "Dynamic piece play",
        "Tactical opportunities",
        "Pawn structure resilience"
      ],
      pawnStructure: "Defend d6 carefully but don't be passive. Prepare ...e5 or ...c5 to challenge White's center. The d6 pawn is your anchor; keep it defended.",
      pieceActivation: "Get your knights to b4 or e5, rooks to c and d files, bishop to active squares. Avoid passive piece placement that allows White's attack.",
      typicalManeuvres: [
        "Nc6-b4 attacking c2 or pinning pieces",
        "Ne7-e5 to centralize and attack d3",
        "Ra8-c8 for queenside pressure",
        "b5 pushing queenside pawns",
        "f7-f5 counterplay in center/kingside"
      ],
      commonTactics: [
        "Tactics on the queenside (b2, c2)",
        "Central breaks with e5",
        "Knight forks from b4 or e5",
        "Rook pressure on c2",
        "Tactical shots with f5"
      ]
    }
  },

  "Ruy Lopez": {
    White: {
      plans: [
        "Maintain the pin on the c6 knight and use it as leverage",
        "Advance d4 at the right moment to secure the center",
        "Create pressure along the a4-e8 diagonal",
        "Develop with tempo and keep Black under constant pressure",
        "Execute a kingside attack with pieces placed actively"
      ],
      keyThemes: [
        "Control of d4",
        "Pin on c6 knight",
        "Kingside attack",
        "Space advantage",
        "Development lead"
      ],
      pawnStructure: "Your d3 pawn supports the center. Prepare d4 carefully, ensuring Black cannot gain time with ...d5. Keep the center solid.",
      pieceActivation: "Bishop on g5 controls key squares, knight on f3 supports the center, rooks ready for the d-file. Get your queen to active squares like e2 or d1.",
      typicalManeuvres: [
        "d4 at the right moment",
        "f4 preparing kingside expansion",
        "Nbd2 developing toward the kingside",
        "Kh1 and f4-f5 launching attack",
        "Rook to f3-g3 for kingside assault"
      ],
      commonTactics: [
        "Pinned c6 knight is overloaded",
        "Sacrifices on e6 or f7",
        "Back rank tactics after ...Nxe4",
        "Undefended pieces due to development lag",
        "Kingside weaknesses from f7-f6"
      ]
    },
    Black: {
      plans: [
        "Develop quickly and neutralize White's initiative",
        "Counter the pin with ...a6 and ...b5 preparation",
        "Break up White's attack with tactical opportunities",
        "Create counterplay with ...d5 or ...e5 at the right moment",
        "Keep your king safe while generating threats"
      ],
      keyThemes: [
        "Queenside expansion (...a6, ...b5)",
        "Central breaks",
        "Piece coordination",
        "Piece activity over pawn structure",
        "Counterplay generation"
      ],
      pawnStructure: "Your pawns control e6/d6 and e5 squares. Prepare ...a6 and ...b5 to gain space and relieve pressure. Only push if the kingside is secure.",
      pieceActivation: "Knights to b4/d7 for active play, rooks to c and d files, bishops to key diagonals. Avoid slow piece placement.",
      typicalManeuvres: [
        "...a6 followed by ...b5 for queenside space",
        "...Nbd7 preparing e5 or b4",
        "...d5 challenging center",
        "...c5 attacking center pawns",
        "...b4 attacking knight on c3"
      ],
      commonTactics: [
        "Knight fork from b4",
        "Central break ...d5 with tempo",
        "Rook pressure on c-file",
        "Tactical opportunities with ...e5",
        "Piece activity compensating for space deficit"
      ]
    }
  },

  "French Defense": {
    White: {
      plans: [
        "Establish a central pawn on e4 with support from d4",
        "Advance f4 to gain space and prepare kingside attack",
        "Create a space advantage and restrict Black's pieces",
        "Look for kingside attacking chances with pieces",
        "Exploit the d5-e6 complex for tactical opportunities"
      ],
      keyThemes: [
        "Space advantage",
        "Kingside attack",
        "Central superiority",
        "Light square control (d5)",
        "Piece coordination"
      ],
      pawnStructure: "Your e4 pawn gives you space. Advance f4 to gain kingside space and prevent Black's counterplay. The d4 pawn supports e4.",
      pieceActivation: "Place knights on d5 and f3, bishops on the long diagonal and e2. Rooks belong on central files. Coordinate pieces for kingside attack.",
      typicalManeuvres: [
        "f4 gaining space",
        "Nd5 as a strong outpost",
        "f5 breaking open Black's kingside",
        "h4-h5 launching kingside assault",
        "Rf3-g3 for kingside attack"
      ],
      commonTactics: [
        "Sacrifices on e6 or f7",
        "Weak d5 square exploitation",
        "Undefended bishops on d6/e7",
        "Back rank tactics",
        "Knight on d5 dominance"
      ]
    },
    Black: {
      plans: [
        "Challenge White's center with timely breaks",
        "Activate your light-squared bishop on d6 or b4",
        "Create queenside counterplay with ...c5",
        "Break up White's attack before it becomes dangerous",
        "Generate tactical opportunities with piece play"
      ],
      keyThemes: [
        "Queenside counterplay (...c5)",
        "Light-squared control",
        "Piece activity",
        "Central breaks",
        "Defensive resources"
      ],
      pawnStructure: "Your e6 pawn is solid but block...ing the diagonal. Prepare ...c5 to challenge d4. The ...f6 is often needed for king safety.",
      pieceActivation: "Bishops to b4 or d6 for active play, knights to e4 or c5, rooks to c and d files. Keep pieces active and well-coordinated.",
      typicalManeuvres: [
        "...c5 challenging the center",
        "...Nbd7-c5 attacking e4",
        "...Ba6 pinning pieces",
        "...Nc5 attacking d3 or e4",
        "...Bf4 activating the bishop"
      ],
      commonTactics: [
        "Knight fork from c5 or e4",
        "Central breaks creating opportunities",
        "Rook and knight tactics on queenside",
        "Piece sacrifices for counterplay",
        "Bishop pair exploitation"
      ]
    }
  },

  "Caro-Kann Defense": {
    White: {
      plans: [
        "Maintain the d4 pawn and keep it supported",
        "Prepare f4 to gain kingside space",
        "Activate your pieces with tempo and purpose",
        "Launch a kingside attack when ready",
        "Exploit any weakness in Black's position"
      ],
      keyThemes: [
        "Central control (d4)",
        "Kingside expansion (f4)",
        "Piece activity",
        "Space advantage",
        "King safety threats"
      ],
      pawnStructure: "Your e4 and d4 pawns give you a strong center. The e4 pawn is stable. Advance f4 at the right moment for kingside expansion.",
      pieceActivation: "Bishops on active diagonals (f4 or g5), knights on f3 and c3 or d5, rooks on central files. Create threats with every piece.",
      typicalManeuvres: [
        "f4 gaining kingside space",
        "Bg5 targeting the knight",
        "Nd5 as an outpost",
        "f5 attacking e6",
        "Qe2 preparing kingside play"
      ],
      commonTactics: [
        "Sacrifices on e6",
        "Knight on d5 dominance",
        "Undefended pieces in Black's position",
        "Tactical breaks on the kingside",
        "Pin and attack combinations"
      ]
    },
    Black: {
      plans: [
        "Control d5 to prevent White's knight outpost",
        "Generate queenside counterplay with ...c5 or ...b5",
        "Activate your pieces quickly",
        "Create tactical opportunities",
        "Defend solidly while seeking counterplay"
      ],
      keyThemes: [
        "Solid pawn structure",
        "Control of d5",
        "Queenside counterplay",
        "Piece activity",
        "Tactical defense"
      ],
      pawnStructure: "Your c6 and e6 pawns are solid. Prepare ...c5 to challenge d4 and control d4. The structure is resistant to White's attack.",
      pieceActivation: "Knights to e4 or c5, bishops to f5 or c7, rooks to c and d files. Keep pieces well-coordinated and ready to defend.",
      typicalManeuvres: [
        "...c5 challenging the center",
        "...Nf6-e4 centralizing",
        "...a5-b5 queenside expansion",
        "...Bf5 active bishop",
        "...Nc5 attacking e4 or d3"
      ],
      commonTactics: [
        "Knight fork from e4 or c5",
        "Control of d5 preventing Nd5",
        "Rook and knight tactics",
        "Central breaks with ...c5",
        "Piece activity compensation"
      ]
    }
  },

  "Italian Game": {
    White: {
      plans: [
        "Control the d5 square with your pawns and pieces",
        "Develop rapidly with threats (d4, Ng5, etc)",
        "Launch a kingside attack after d4",
        "Create tactical opportunities with pins and forks",
        "Exploit the weak f7 square and d5 outpost"
      ],
      keyThemes: [
        "f7 weakness",
        "d5 outpost",
        "Rapid development",
        "Kingside attack",
        "Tactical opportunities"
      ],
      pawnStructure: "Your center pawns e4 and d4 control the board. Push d4 at the right moment. The e4 pawn gives space.",
      pieceActivation: "Bishop on b5 pins the knight, knight on f3 supports center, bishops on active diagonals. Create threats immediately.",
      typicalManeuvres: [
        "d4 seizing center",
        "Ng5 attacking f7",
        "Bxc6 damaging structure",
        "f4 attacking e5",
        "Qe2 preparing kingside"
      ],
      commonTactics: [
        "Sacrifices on f7",
        "Back rank tactics",
        "Pins along the d-file",
        "Knight forks from d5 or g5",
        "Undefended pieces exploitation"
      ]
    },
    Black: {
      plans: [
        "Counter d4 with ...d5, ...d6, or central counterplay",
        "Activate pieces quickly",
        "Generate queenside or central counterplay",
        "Create defensive resources against kingside attack",
        "Seek piece activity and tactical opportunities"
      ],
      keyThemes: [
        "Central counterplay",
        "Piece activity",
        "Defensive resources",
        "Queenside expansion",
        "Dynamic piece play"
      ],
      pawnStructure: "Your center pawns control e5 and d6. Prepare central breaks or queenside counterplay. Defend d6 carefully.",
      pieceActivation: "Knights to active squares (e4, c5), bishops to active diagonals, rooks on central files. Keep pieces coordinated.",
      typicalManeuvres: [
        "...d5 challenging center",
        "...Nc6-e4 centralizing",
        "...a6 removing pin",
        "...c5 attacking d4",
        "...b5 gaining queenside space"
      ],
      commonTactics: [
        "Knight fork from e4",
        "Central break ...d5",
        "Rook and knight tactics",
        "Piece activity compensation",
        "Tactical breaks in center"
      ]
    }
  },

  "King's Indian Defense": {
    White: {
      plans: [
        "Control the d5 square firmly",
        "Prevent Black's thematic ...e5 break",
        "Exploit Black's fianchettoed bishop with c4",
        "Create queenside pressure with c4 and eventual queenside attack",
        "Keep Black's pieces passive while building your attack"
      ],
      keyThemes: [
        "d5 control",
        "Queenside pressure",
        "Preventing ...e5",
        "Space advantage",
        "c4 advance"
      ],
      pawnStructure: "Your d4 and c4 pawns control the center and queenside. Don't allow ...e5. Maintain space control.",
      pieceActivation: "Knights on f3 and d2/c3, bishops on f1 and e3/g5, rooks on c1 and d1. Create pressure on the queenside.",
      typicalManeuvres: [
        "c4 seizing queenside space",
        "Nd2-c4 heading to attacking squares",
        "Be3-f4 for piece activity",
        "Qe2 preparing queenside attack",
        "Rc1-c7 for queenside pressure"
      ],
      commonTactics: [
        "Exploiting undefended pieces",
        "Tactics on the queenside",
        "Rook and knight coordination",
        "Back rank issues",
        "Weak queenside squares"
      ]
    },
    Black: {
      plans: [
        "Achieve the central break ...e5 to free your position",
        "Create kingside counterplay with ...f6-f5 or piece activity",
        "Activate pieces on both flanks",
        "Generate tactical opportunities",
        "Maintain solid pawn structure while seeking breaks"
      ],
      keyThemes: [
        "Central break ...e5",
        "Kingside counterplay",
        "Fianchetto strength",
        "Piece activity",
        "Dynamic play"
      ],
      pawnStructure: "Your fianchettoed bishop on g7 controls the long diagonal. Prepare ...e5 to free your position. The kingside is solid.",
      pieceActivation: "Bishops on g7 and f5/e6, knights on f6 and e5/d7, rooks on f8 and a8 heading to activity. Generate threats.",
      typicalManeuvres: [
        "...e5 central break",
        "...f6 preparing kingside play",
        "...Ne4 centralizing",
        "...c6 supporting e5",
        "...b6-c5 queenside counterplay"
      ],
      commonTactics: [
        "Knight fork from e4",
        "Central break tactics",
        "Rook and piece coordination",
        "Fianchetto bishop strength",
        "Kingside pawn breaks"
      ]
    }
  },

  "Queen's Gambit Declined": {
    White: {
      plans: [
        "Maintain a strong pawn center",
        "Develop with purpose and control key squares",
        "Create pressure on the center and queenside",
        "Prepare f4 or e4 at the right moment",
        "Exploit weaknesses in Black's position methodically"
      ],
      keyThemes: [
        "Central control",
        "Queenside pressure",
        "Piece coordination",
        "Space advantage",
        "Development lead"
      ],
      pawnStructure: "Your d4 and c4 pawns control the center and queenside. Keep pressure on d5. Advance f4 at the right moment.",
      pieceActivation: "Bishops on f4 and c1, knights on f3 and c3/d2, queen on c2, rooks on d1 and c1. Create queenside and center threats.",
      typicalManeuvres: [
        "f4 gaining space",
        "Rc1 for queenside pressure",
        "Bf4 active piece placement",
        "Nbd2-c4 attacking e5",
        "Qb3 threatening d5"
      ],
      commonTactics: [
        "Tactics on the queenside",
        "Weak d6 square",
        "Undefended pieces in Black's position",
        "Center control tactics",
        "Back rank themes"
      ]
    },
    Black: {
      plans: [
        "Solidly defend d5 and prevent White's domination",
        "Generate queenside or central counterplay",
        "Activate pieces despite White's space advantage",
        "Look for tactical opportunities on the queenside",
        "Maintain pawn structure integrity"
      ],
      keyThemes: [
        "Solid defense",
        "Queenside counterplay",
        "Piece activity",
        "d5 defense",
        "Tactical resources"
      ],
      pawnStructure: "Your d5 pawn is the anchor. Defend it carefully. Prepare ...c5 or ...b6-c5 for counterplay.",
      pieceActivation: "Bishops on e6 and c8, knights on f6 and bd7, rooks on a8 and c8. Seek active squares despite space disadvantage.",
      typicalManeuvres: [
        "...c6 supporting d5",
        "...a6-b5 queenside expansion",
        "...Nc5 attacking c4",
        "...Be6-d6 piece activity",
        "...Rc8 queenside pressure"
      ],
      commonTactics: [
        "Knight fork from c5",
        "Central breaks",
        "Rook and piece coordination",
        "Queenside tactics",
        "Tactical defense creating counterplay"
      ]
    }
  }
};

export function findOpening(query) {
  const lower = query.toLowerCase();
  // Exact match first
  for (const [name, data] of Object.entries(openingDatabase)) {
    if (lower === name.toLowerCase()) {
      return { name, data };
    }
  }
  // Partial match
  for (const [name, data] of Object.entries(openingDatabase)) {
    if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase())) {
      return { name, data };
    }
  }
  return null;
}
