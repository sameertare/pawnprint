import './style.css';
import { Chess } from 'chess.js';
import type { Color } from './types';

interface MiddlegamePlan {
  opening: string;
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

async function fetchMiddlegamePlans(opening: string, color: Color): Promise<MiddlegamePlan | null> {
  try {
    const response = await fetch('/api/middlegame-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opening, color: color === 'w' ? 'White' : 'Black' }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    console.error('Failed to fetch middlegame plans:', e);
    return null;
  }
}

document.getElementById('search-opening-btn')?.addEventListener('click', async () => {
  const name = (document.getElementById('opening-name') as HTMLInputElement).value.trim();
  const color = (document.getElementById('player-color') as HTMLSelectElement).value as Color;

  if (!name) {
    alert('Please enter an opening name');
    return;
  }

  const suggestionsEl = document.getElementById('opening-suggestions') as HTMLElement;
  suggestionsEl.innerHTML = '<p class="hint">Loading middlegame plans...</p>';

  const plan = await fetchMiddlegamePlans(name, color);

  if (!plan) {
    suggestionsEl.innerHTML = '<p class="hint error">Could not generate plans for this opening. Please try another opening name.</p>';
    return;
  }

  displayPlan(plan, name);
});

document.getElementById('parse-moves-btn')?.addEventListener('click', async () => {
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
        statusEl.textContent = `Error: Invalid move "${move}"`;
        return;
      }
    }
  } catch (e) {
    statusEl.textContent = `Error parsing moves: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }

  statusEl.innerHTML = '<p class="hint">Identifying opening and loading plans...</p>';

  // Create a descriptive opening name from the moves
  const openingDesc = `Opening after: ${moves.slice(0, 8).join(' ')}${moves.length > 8 ? '...' : ''}`;
  const plan = await fetchMiddlegamePlans(openingDesc, color);

  if (!plan) {
    statusEl.innerHTML = '<p class="hint error">Could not generate plans for this position. Try a different move sequence.</p>';
    return;
  }

  displayPlan(plan, openingDesc);
  statusEl.innerHTML = '';
});

function displayPlan(plan: MiddlegamePlan, openingName: string): void {
  currentPlan = plan;

  exportData = {
    opening: openingName,
    color: plan.color === 'w' ? 'White' : 'Black',
    plan: plan,
  };

  const headerEl = document.getElementById('opening-header') as HTMLElement;
  headerEl.innerHTML = `
    <div class="opening-info">
      <div><strong>${esc(openingName)}</strong></div>
      <div class="hint">Playing as <strong>${plan.color === 'w' ? 'White' : 'Black'}</strong></div>
    </div>
  `;

  const contentEl = document.getElementById('plans-content') as HTMLElement;
  contentEl.innerHTML = `
    <section class="plan-section">
      <h3>📌 Key Strategic Themes</h3>
      <ul>
        ${plan.keyThemes.map((t) => `<li>${esc(t)}</li>`).join('')}
      </ul>
    </section>

    <section class="plan-section">
      <h3>♟ Pawn Structure & Placement</h3>
      <p>${esc(plan.pawnStructure)}</p>
    </section>

    <section class="plan-section">
      <h3>♞ Piece Activation</h3>
      <p>${esc(plan.pieceActivation)}</p>
    </section>

    <section class="plan-section">
      <h3>🎯 Typical Middlegame Plans</h3>
      <ol>
        ${plan.plans.map((p) => `<li>${esc(p)}</li>`).join('')}
      </ol>
    </section>

    <section class="plan-section">
      <h3>🐴 Typical Maneuvers & Ideas</h3>
      <ul>
        ${plan.typicalManeuvres.map((m) => `<li>${esc(m)}</li>`).join('')}
      </ul>
    </section>

    <section class="plan-section">
      <h3>⚡ Common Tactical Themes</h3>
      <ul>
        ${plan.commonTactics.map((t) => `<li>${esc(t)}</li>`).join('')}
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
