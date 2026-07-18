/**
 * Reads a photo of a round's results sheet (or a wall-chart-style crosstable, for its most recent
 * column) and matches detected results back onto the pairings Swiss Pairings already generated
 * for that round — never invents pairings, only fills in results for boards the app already knows
 * about. Runs entirely client-side via Tesseract.js (OCR assets are fetched at runtime; the photo
 * itself is never uploaded anywhere). Pure matching logic here has no DOM/Tesseract dependency of
 * its own, so it's testable independent of the OCR step — src/swiss.ts wires the two together.
 */
import type { GameResult } from './swissEngine';
import type Tesseract from 'tesseract.js';

export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Caps OCR time/memory on an extreme-resolution photo while otherwise leaving full-res phone
// photos (typically 3000-4000px) untouched — a dense multi-column pairing sheet with 40+ rows of
// small print needs most of that resolution to stay legible; the previous, much lower cap here was
// throwing away exactly the detail OCR needed for that case.
const MAX_DIMENSION = 3600;

/** iPhones default to HEIC/HEIF for photos, which — unlike JPEG/PNG — has no built-in decode
 *  support in any browser except Safari (no <img>, canvas, or createImageBitmap support). Since
 *  this feature's whole point is "photograph a paper sheet with your phone," this is the single
 *  most likely real-world failure and deserves its own fast, specific, actionable message instead
 *  of a generic one after however long a doomed decode attempt takes to fail. */
function isLikelyHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === 'image/heic' || file.type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
}

/** Decodes `file` with whatever the browser supports, corrects EXIF orientation (photos taken in
 *  portrait otherwise often decode sideways), downscales anything larger than MAX_DIMENSION on its
 *  longest side, and re-encodes as a plain PNG blob — normalizing away format/orientation/size
 *  quirks before Tesseract ever sees the image, rather than depending on its own image loading to
 *  handle all of that. */
async function preprocessImage(file: File): Promise<Blob> {
  if (isLikelyHeic(file)) {
    throw new Error(
      "That looks like a HEIC/HEIF photo (the default format on iPhones), which browsers other than Safari can't open. " +
      'In your phone\'s Camera settings, switch Formats to "Most Compatible" and retake the photo, or use "Edit → Duplicate as JPEG" ' +
      'on the photo before uploading it here.'
    );
  }

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fall back to a plain <img> decode for browsers/formats createImageBitmap won't touch.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      bitmap = img;
    } catch {
      throw new Error("Your browser couldn't open that image file — try a JPEG or PNG (a screenshot of the photo also works).");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const w = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ('close' in bitmap) bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))), 'image/png');
  });
}

/** Runs OCR on an image file and returns every detected line of text with its bounding box.
 *  Lazily imports tesseract.js so pages that never use this feature don't pay for it. */
export async function ocrLines(file: File, onProgress?: (pct: number) => void): Promise<OcrLine[]> {
  const image = await preprocessImage(file);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100));
    },
  });
  try {
    // Tesseract's default page-segmentation mode tries to infer paragraph/column layout, which on
    // a dense multi-column table (gridlines, two side-by-side board blocks) tends to stitch text
    // from unrelated cells onto the same "line" and read gridlines as characters — exactly the kind
    // of garbled output a results-sheet photo produces. SPARSE_TEXT ('11') skips layout inference
    // and just finds text wherever it is, one line per text run, with no assumed reading order —
    // reading order doesn't matter here since matchResultsToPairings re-clusters lines into rows by
    // bounding-box position anyway.
    await worker.setParameters({ tessedit_pageseg_mode: '11' as Tesseract.PSM });
    // `blocks` (which nests down to paragraphs/lines/words) is opt-in — recognize() only returns
    // flat text by default, which would leave every line's bounding box unavailable for matching.
    const { data } = await worker.recognize(image, {}, { blocks: true });
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

/** Many results sheets are tables — board/white/black/result each their own cell — and Tesseract's
 *  line detection follows visual layout, so each cell comes back as its own separate OcrLine rather
 *  than one line containing a full row. Matching against raw lines would then never see both names
 *  and a result together. This clusters lines whose vertical centers land close together (i.e. sit
 *  in the same table row) and joins them left-to-right into one row of text, so a row split across
 *  cells reads the same as a results sheet that already put a whole pairing on one line. */
function groupLinesIntoRows(lines: OcrLine[]): OcrLine[] {
  if (!lines.length) return [];
  const heights = lines.map((l) => l.y1 - l.y0).sort((a, b) => a - b);
  const tolerance = (heights[Math.floor(heights.length / 2)] || 20) * 0.6;

  const sorted = [...lines].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: OcrLine[][] = [];
  for (const line of sorted) {
    const centerY = (line.y0 + line.y1) / 2;
    const row = rows.find((r) => {
      const rowCenterY = r.reduce((sum, l) => sum + (l.y0 + l.y1) / 2, 0) / r.length;
      return Math.abs(rowCenterY - centerY) <= tolerance;
    });
    if (row) row.push(line);
    else rows.push([line]);
  }
  return rows.map((row) => {
    const sortedRow = [...row].sort((a, b) => a.x0 - b.x0);
    return {
      text: sortedRow.map((l) => l.text).join('  '),
      x0: Math.min(...row.map((l) => l.x0)),
      y0: Math.min(...row.map((l) => l.y0)),
      x1: Math.max(...row.map((l) => l.x1)),
      y1: Math.max(...row.map((l) => l.y1)),
    };
  });
}

export interface OcrResultMatch {
  board: number;
  result: GameResult;
  matchedLine: string | null;
  confidence: 'matched' | 'unmatched';
}

/** For each pairing the app already generated for the round being scored, looks for the OCR row
 *  that best names both players, then pulls a result out of that row. Pairings the photo doesn't
 *  clearly cover come back unmatched — left for the TD to fill in by hand, same as always. */
export function matchResultsToPairings(
  lines: OcrLine[],
  pairings: { board: number; whiteName: string; blackName: string }[]
): OcrResultMatch[] {
  const rows = groupLinesIntoRows(lines);
  return pairings.map(({ board, whiteName, blackName }) => {
    let bestRow: OcrLine | null = null;
    let bestScore = 0;
    for (const row of rows) {
      const wScore = nameLineScore(whiteName, row.text);
      const bScore = nameLineScore(blackName, row.text);
      if (wScore < MIN_LINE_SCORE || bScore < MIN_LINE_SCORE) continue;
      const combined = wScore + bScore;
      if (combined > bestScore) { bestScore = combined; bestRow = row; }
    }
    if (!bestRow) return { board, result: null, matchedLine: null, confidence: 'unmatched' };
    const result = extractResultToken(bestRow.text);
    if (!result) return { board, result: null, matchedLine: bestRow.text, confidence: 'unmatched' };
    return { board, result, matchedLine: bestRow.text, confidence: 'matched' };
  });
}
