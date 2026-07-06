import { Chess } from 'chess.js';
import { openingDb, findOpeningByName, findOpeningByMoves } from './openingDb';
import type { Color } from './types';

interface MiddlegamePlan {
  opening: string;
  eco?: string;
  moves?: string;
  color: Color;
  plans: string[];
  keyThemes: string[];
  typicalManeuvres: string[];
  pieceActivation: string;
  pawnStructure: string;
  commonTactics: string[];
}

interface ExportData {
  opening: string;
  color: string;
  plan: MiddlegamePlan;
}

let currentPlan: MiddlegamePlan | null = null;
let exportData: ExportData | null = null;

const tabs = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabContents = document.querySelectorAll<HTMLDivElement>('.tab-content');

tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabs.forEach((b) => b.classList.remove('active'));
    tabContents.forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.dataset.tab;
    document.getElementById(tabId + '-tab')?.classList.add('active');
  });
});

function esc(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

document.getElementById('search-opening-btn')?.addEventListener('click', () => {
  const name = (document.getElementById('opening-name') as HTMLInputElement).value.trim();
  const color = (document.getElementById('player-color') as HTMLSelectElement).value as Color;

  if (!name) {
    alert('Please enter an opening name');
    return;
  }

  const results = findOpeningByName(name);
  if (results.length === 0) {
    (document.getElementById('opening-suggestions') as HTMLElement).innerHTML =
      '<p class="hint error">No openings found. Try variations like "Sicilian Dragon", "Ruy Lopez", "French Defense".</p>';
    return;
  }

  if (results.length === 1) {
    displayPlan(results[0], color);
  } else {
    const html = results
      .map(
        (r) => `
      <div class="suggestion-item">
        <div><strong>${esc(r.opening)}</strong> ${r.eco ? `(${r.eco})` : ''}</div>
        ${r.moves ? `<div class="hint">${esc(r.moves)}</div>` : ''}
        <button class="btn btn-ghost btn-sm" data-opening="${esc(r.opening)}">Select</button>
      </div>
    `
      )
      .join('');
    (document.getElementById('opening-suggestions') as HTMLElement).innerHTML = html;

    document.querySelectorAll<HTMLButtonElement>('[data-opening]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selected = results.find((r) => r.opening === btn.dataset.opening);
        if (selected) displayPlan(selected, color);
      });
    });
  }
});

document.getElementById('parse-moves-btn')?.addEventListener('click', () => {
  const movesText = (document.getElementById('moves-input') as HTMLTextAreaElement).value.trim();
  const color = (document.getElementById('moves-player-color') as HTMLSelectElement).value as Color;

  if (!movesText) {
    alert('Please enter moves');
    return;
  }

  const statusEl = document.getElementById('move-parse-status') as HTMLElement;

  const moves = movesText.split(/\s+/).filter(Boolean);
  const chess = new Chess();

  try {
    for (const move of moves) {
      const result = chess.move(move, { sloppy: true });
      if (!result) {
        statusEl.textContent = `Error: Invalid move "${move}" at position ${chess.fen()}`;
        return;
      }
    }
  } catch (e) {
    statusEl.textContent = `Error parsing moves: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }

  const fen = chess.fen();
  const results = findOpeningByMoves(moves);

  if (results.length === 0) {
    statusEl.innerHTML = '<p class="hint">Opening not found in database, but moves are valid.</p>';
    const plan = createCustomPlan(moves.join(' '), fen, color);
    displayPlan(plan, color);
  } else if (results.length === 1) {
    statusEl.innerHTML = `<p class="hint">Opening identified: <strong>${esc(results[0].opening)}</strong></p>`;
    displayPlan(results[0], color);
  } else {
    statusEl.innerHTML = '<p class="hint">Multiple possible openings:</p>';
    const html = results
      .map(
        (r) => `
      <div class="suggestion-item">
        <div><strong>${esc(r.opening)}</strong> ${r.eco ? `(${r.eco})` : ''}</div>
        <button class="btn btn-ghost btn-sm" data-opening="${esc(r.opening)}">Select</button>
      </div>
    `
      )
      .join('');
    const container = document.createElement('div');
    container.innerHTML = html;
    statusEl.appendChild(container);

    container.querySelectorAll<HTMLButtonElement>('[data-opening]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selected = results.find((r) => r.opening === btn.dataset.opening);
        if (selected) displayPlan(selected, color);
      });
    });
  }
});

function createCustomPlan(moves: string, fen: string, color: Color): MiddlegamePlan {
  return {
    opening: `Custom Position (${moves})`,
    color,
    plans: [
      'Centralize your pieces to control key squares',
      'Maintain pawn structure flexibility',
      'Look for tactical opportunities',
    ],
    keyThemes: ['Center control', 'Piece activity', 'King safety'],
    typicalManeuvres: [
      'Rearrange pieces for better coordination',
      'Push passed pawns',
      'Create weaknesses in opponent position',
    ],
    pieceActivation: 'Activate all pieces toward the center or weak squares.',
    pawnStructure: 'Analyze the pawn structure and identify fixed weaknesses.',
    commonTactics: ['Forks', 'Pins', 'Skewers', 'Double attacks'],
  };
}

function displayPlan(opening: typeof openingDb[0], color: Color): void {
  currentPlan = opening.plans[color === 'w' ? 'white' : 'black'];
  currentPlan.color = color;

  exportData = {
    opening: opening.opening,
    color: color === 'w' ? 'White' : 'Black',
    plan: currentPlan,
  };

  const headerEl = document.getElementById('opening-header') as HTMLElement;
  headerEl.innerHTML = `
    <div class="opening-info">
      <div><strong>${esc(opening.opening)}</strong> ${opening.eco ? `(${opening.eco})` : ''}</div>
      <div class="hint">Playing as <strong>${color === 'w' ? 'White' : 'Black'}</strong></div>
      ${opening.moves ? `<div class="hint">Typical moves: ${esc(opening.moves)}</div>` : ''}
    </div>
  `;

  const contentEl = document.getElementById('plans-content') as HTMLElement;
  contentEl.innerHTML = `
    <section class="plan-section">
      <h3>📌 Key Strategic Themes</h3>
      <ul>
        ${currentPlan.keyThemes.map((t) => `<li>${esc(t)}</li>`).join('')}
      </ul>
    </section>

    <section class="plan-section">
      <h3>♟ Pawn Structure & Placement</h3>
      <p>${esc(currentPlan.pawnStructure)}</p>
    </section>

    <section class="plan-section">
      <h3>♞ Piece Activation</h3>
      <p>${esc(currentPlan.pieceActivation)}</p>
    </section>

    <section class="plan-section">
      <h3>🎯 Typical Middlegame Plans</h3>
      <ol>
        ${currentPlan.plans.map((p) => `<li>${esc(p)}</li>`).join('')}
      </ol>
    </section>

    <section class="plan-section">
      <h3>🐴 Typical Maneuvers & Ideas</h3>
      <ul>
        ${currentPlan.typicalManeuvres.map((m) => `<li>${esc(m)}</li>`).join('')}
      </ul>
    </section>

    <section class="plan-section">
      <h3>⚡ Common Tactical Themes</h3>
      <ul>
        ${currentPlan.commonTactics.map((t) => `<li>${esc(t)}</li>`).join('')}
      </ul>
    </section>
  `;

  (document.getElementById('input-card') as HTMLElement).hidden = true;
  (document.getElementById('plans-card') as HTMLElement).hidden = false;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('export-md-btn')?.addEventListener('click', () => {
  if (!exportData) return;
  const md = generateMarkdown(exportData);
  downloadFile(`${exportData.opening.replace(/\s+/g, '_')}.md`, md, 'text/markdown');
});

document.getElementById('export-pdf-btn')?.addEventListener('click', async () => {
  if (!exportData) return;
  try {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.onload = () => {
      const element = document.getElementById('plans-card');
      if (!element) return;
      (window as any).html2pdf().set({ margin: 10, filename: `${exportData!.opening}.pdf` }).save(element);
    };
    document.head.appendChild(script);
  } catch (e) {
    alert('PDF export requires internet connection. Try Markdown export instead.');
  }
});

document.getElementById('print-btn')?.addEventListener('click', () => {
  window.print();
});

document.getElementById('back-btn')?.addEventListener('click', () => {
  (document.getElementById('input-card') as HTMLElement).hidden = false;
  (document.getElementById('plans-card') as HTMLElement).hidden = true;
  (document.getElementById('opening-name') as HTMLInputElement).value = '';
  (document.getElementById('moves-input') as HTMLTextAreaElement).value = '';
  (document.getElementById('opening-suggestions') as HTMLElement).innerHTML = '';
  (document.getElementById('move-parse-status') as HTMLElement).textContent = '';
});

function generateMarkdown(data: ExportData): string {
  const { opening, color, plan } = data;
  return `# ${opening}

**Color:** ${color}

## Key Strategic Themes

${plan.keyThemes.map((t) => `- ${t}`).join('\n')}

## Pawn Structure & Placement

${plan.pawnStructure}

## Piece Activation

${plan.pieceActivation}

## Typical Middlegame Plans

${plan.plans.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Typical Maneuvers & Ideas

${plan.typicalManeuvres.map((m) => `- ${m}`).join('\n')}

## Common Tactical Themes

${plan.commonTactics.map((t) => `- ${t}`).join('\n')}

---
Generated by PawnPrint · ${new Date().toLocaleDateString()}
`;
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
