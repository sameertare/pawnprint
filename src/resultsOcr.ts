/**
 * Reads a photo of a round's results sheet (or a wall-chart-style crosstable, for its most recent
 * column) and matches detected results back onto the pairings Swiss Pairings already generated
 * for that round — never invents pairings, only fills in results for boards the app already knows
 * about. Runs entirely client-side via Tesseract.js (OCR assets are fetched at runtime; the photo
 * itself is never uploaded anywhere). Pure matching logic here has no DOM/Tesseract dependency of
 * its own, so it's testable independent of the OCR step — src/swiss.ts wires the two together.
 */
import type { GameResult } from './swissEngine';

export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Runs OCR on an image file and returns every detected line of text with its bounding box.
 *  Lazily imports tesseract.js so pages that never use this feature don't pay for it. */
export async function ocrLines(file: File, onProgress?: (pct: number) => void): Promise<OcrLine[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100));
    },
  });
  try {
    // `blocks` (which nests down to paragraphs/lines/words) is opt-in — recognize() only returns
    // flat text by default, which would leave every line's bounding box unavailable for matching.
    const { data } = await worker.recognize(file, {}, { blocks: true });
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          if (line.text.trim()) lines.push({ text: line.text, x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1 });
        }
      }
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}

// ---------------- fuzzy name matching (pure, no OCR dependency) ----------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein edit distance. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** 0..1 token similarity — 1 for an exact match, tolerant of a few OCR-typo characters, harsher on
 *  short tokens (where a couple of wrong characters change the word entirely). */
function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = editDistance(a, b);
  return Math.max(0, 1 - dist / Math.max(a.length, b.length));
}

/** How well `name`'s tokens are represented in `lineText` — the fraction of the name's tokens that
 *  have a good fuzzy match somewhere in the line, weighted toward longer tokens (surnames) since
 *  those are the most distinctive and least likely to coincidentally match another player. */
function nameLineScore(name: string, lineText: string): number {
  const nameTokens = normalize(name).split(' ').filter((t) => t.length > 1);
  const lineTokens = normalize(lineText).split(' ').filter((t) => t.length > 1);
  if (!nameTokens.length || !lineTokens.length) return 0;
  let weightedScore = 0;
  let totalWeight = 0;
  for (const nt of nameTokens) {
    const weight = nt.length; // longer tokens count more — surnames over initials/short words
    totalWeight += weight;
    let best = 0;
    for (const lt of lineTokens) best = Math.max(best, tokenSimilarity(nt, lt));
    if (best >= 0.8) weightedScore += weight * best; // require a fairly close match per token
  }
  return totalWeight ? weightedScore / totalWeight : 0;
}

const MIN_LINE_SCORE = 0.55; // both names must clear this bar for the line to count as a match

/** Extracts a single unambiguous result token from a line of text, if present. Deliberately only
 *  recognizes combined, self-contained tokens (1-0, 0-1, ½-½, 1/2-1/2, =) rather than isolated
 *  letters like "W"/"L"/"D", which would need extra positional logic to know which side they
 *  belong to and are easy for OCR to confuse with stray characters elsewhere on the line. */
function extractResultToken(lineText: string): GameResult {
  const t = lineText.replace(/\s+/g, '');
  if (/1-?0/.test(t) && !/0-?1/.test(t)) return '1-0';
  if (/0-?1/.test(t) && !/1-?0/.test(t)) return '0-1';
  if (/1\/?2-?1\/?2|½-?½|=(?!\d)/.test(t)) return '1/2-1/2';
  return null;
}

export interface OcrResultMatch {
  board: number;
  result: GameResult;
  matchedLine: string | null;
  confidence: 'matched' | 'unmatched';
}

/** For each pairing the app already generated for the round being scored, looks for the OCR line
 *  that best names both players, then pulls a result out of that line. Pairings the photo doesn't
 *  clearly cover come back unmatched — left for the TD to fill in by hand, same as always. */
export function matchResultsToPairings(
  lines: OcrLine[],
  pairings: { board: number; whiteName: string; blackName: string }[]
): OcrResultMatch[] {
  return pairings.map(({ board, whiteName, blackName }) => {
    let bestLine: OcrLine | null = null;
    let bestScore = 0;
    for (const line of lines) {
      const wScore = nameLineScore(whiteName, line.text);
      const bScore = nameLineScore(blackName, line.text);
      if (wScore < MIN_LINE_SCORE || bScore < MIN_LINE_SCORE) continue;
      const combined = wScore + bScore;
      if (combined > bestScore) { bestScore = combined; bestLine = line; }
    }
    if (!bestLine) return { board, result: null, matchedLine: null, confidence: 'unmatched' };
    const result = extractResultToken(bestLine.text);
    if (!result) return { board, result: null, matchedLine: bestLine.text, confidence: 'unmatched' };
    return { board, result, matchedLine: bestLine.text, confidence: 'matched' };
  });
}
