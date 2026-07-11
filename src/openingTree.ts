/**
 * Builds a branching move tree from a batch of games (own SAN sequences), aggregating how often
 * each move was played from each position and the practical score from there — the core data
 * structure behind the Opening Explorer. Pure logic, no DOM; src/openingExplorer.ts renders it.
 */
import { Chess } from 'chess.js';
import type { Result } from './types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Cap tree depth to the opening phase — deeper transpositions rarely matter for repertoire prep,
 *  and letting every game's full move list branch out would make the tree unusably wide. */
export const MAX_TREE_PLY = 24; // 12 full moves

export interface TreeNode {
  fen: string; // position after the move that led here (root = start position)
  ply: number; // 0 at root
  games: number;
  wins: number;
  draws: number;
  losses: number;
  children: Map<string, TreeNode>; // keyed by SAN
}

export interface TreeGame {
  sans: string[];
  result: Result; // already from the color being explored's perspective
}

export interface ChildSummary {
  san: string;
  fen: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number; // (wins + draws*0.5) / games * 100
}

function newNode(fen: string, ply: number): TreeNode {
  return { fen, ply, games: 0, wins: 0, draws: 0, losses: 0, children: new Map() };
}

function tally(node: TreeNode, result: Result) {
  node.games++;
  if (result === 'win') node.wins++;
  else if (result === 'loss') node.losses++;
  else if (result === 'draw') node.draws++;
  // 'unknown' games are excluded from the input list entirely (see buildTree), so never reach here.
}

/** Builds the tree from games already filtered to one color and one player. Games with an
 *  unresolved result are skipped — there's no practical outcome to attribute to any branch. */
export function buildTree(games: TreeGame[], maxPly = MAX_TREE_PLY): TreeNode {
  const root = newNode(START_FEN, 0);
  for (const g of games) {
    if (g.result === 'unknown') continue;
    tally(root, g.result);
    const chess = new Chess();
    let node = root;
    const limit = Math.min(g.sans.length, maxPly);
    for (let i = 0; i < limit; i++) {
      let moveResult;
      try {
        moveResult = chess.move(g.sans[i]);
      } catch {
        break; // malformed SAN somewhere downstream — stop walking this game, keep what we have
      }
      if (!moveResult) break;
      const san = moveResult.san; // normalized (chess.js's own SAN, matches what we'll look up by)
      let child = node.children.get(san);
      if (!child) {
        child = newNode(chess.fen(), i + 1);
        node.children.set(san, child);
      }
      tally(child, g.result);
      node = child;
    }
  }
  return root;
}

/** Children sorted by how often they were played, most-common first — the natural reading order
 *  for "what do I actually play here." */
export function childSummaries(node: TreeNode): ChildSummary[] {
  return [...node.children.entries()]
    .map(([san, child]) => ({
      san,
      fen: child.fen,
      games: child.games,
      wins: child.wins,
      draws: child.draws,
      losses: child.losses,
      scorePct: child.games ? Math.round(((child.wins + child.draws * 0.5) / child.games) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.games - a.games);
}

/** Walks a path of SANs from the root, returning the node reached or null if the path doesn't
 *  exist in this tree (e.g. after switching color/filters out from under an open path). */
export function nodeAtPath(root: TreeNode, path: string[]): TreeNode | null {
  let node = root;
  for (const san of path) {
    const next = node.children.get(san);
    if (!next) return null;
    node = next;
  }
  return node;
}

export function scorePct(node: TreeNode): number {
  return node.games ? Math.round(((node.wins + node.draws * 0.5) / node.games) * 1000) / 10 : 0;
}
