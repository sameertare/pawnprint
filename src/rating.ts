import './style.css';
import { estimateRating } from './ratingEngine';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const NUM_OPPONENTS = 15;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------- build the 15 opponent rating inputs ----------
const grid = $('#opponent-grid');
grid.innerHTML = Array.from({ length: NUM_OPPONENTS }, (_, i) => {
  const n = i + 1;
  return `<label class="stack opp-slot">Opp ${n}
    <input type="number" class="text-input opp-input" data-idx="${n}" min="100" max="3200" placeholder="—" />
  </label>`;
}).join('');

function readOpponentRatings(): number[] {
  return [...document.querySelectorAll<HTMLInputElement>('.opp-input')]
    .map((el) => el.value.trim())
    .filter((v) => v.length > 0)
    .map((v) => parseFloat(v));
}

function fmtSigned(n: number): string {
  return (n > 0 ? '+' : '') + n;
}

function renderResult() {
  const currentRating = parseFloat(($('#r-current') as HTMLInputElement).value);
  const totalScore = parseFloat(($('#r-score') as HTMLInputElement).value);
  const priorGames = parseFloat(($('#r-priorgames') as HTMLInputElement).value);
  const ageStr = ($('#r-age') as HTMLInputElement).value.trim();
  const age = ageStr ? parseFloat(ageStr) : undefined;
  const useDualRatedLowerK = ($('#r-duallowk') as HTMLInputElement).checked;
  const opponentRatings = readOpponentRatings();

  const errorEl = $('#r-error');
  const resultsCard = $('#r-results-card') as HTMLElement;

  if (!Number.isFinite(currentRating)) {
    errorEl.textContent = 'Enter a current rating.';
    resultsCard.hidden = true;
    return;
  }
  if (!Number.isFinite(totalScore)) {
    errorEl.textContent = 'Enter a total score.';
    resultsCard.hidden = true;
    return;
  }
  if (!Number.isFinite(priorGames)) {
    errorEl.textContent = 'Enter the number of prior rated games.';
    resultsCard.hidden = true;
    return;
  }

  const outcome = estimateRating({ currentRating, totalScore, priorGames, age, opponentRatings, useDualRatedLowerK });
  if (!outcome.ok) {
    errorEl.textContent = outcome.error;
    resultsCard.hidden = true;
    return;
  }
  errorEl.textContent = '';
  const r = outcome.result;

  $('#r-new-rating').textContent = String(r.newRating);
  $('#r-change').textContent = fmtSigned(r.ratingChange);
  ($('#r-change') as HTMLElement).className = 'big ' + (r.ratingChange > 0 ? 'pos' : r.ratingChange < 0 ? 'neg' : '');
  $('#r-performance').textContent = String(r.performanceRating);
  $('#r-kvalue').textContent = String(r.kFactor);

  $('#r-games').textContent = String(r.gamesCounted);
  $('#r-we').textContent = String(r.winExpectancy);
  $('#r-n').textContent = String(r.effectiveN);
  $('#r-status').textContent = r.established ? 'Established (≥ 26 games)' : 'Provisional (< 26 games)';
  $('#r-basechange').textContent = fmtSigned(r.baseRatingChange);
  $('#r-bonus').textContent = r.bonus > 0 ? '+' + r.bonus : '0';

  $('#r-notes').innerHTML = r.notes.length
    ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';

  resultsCard.hidden = false;
  resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#r-estimate-btn').addEventListener('click', renderResult);

$('#r-clear-btn').addEventListener('click', () => {
  (['#r-current', '#r-score', '#r-priorgames', '#r-age'] as const).forEach((sel) => (($(sel) as HTMLInputElement).value = ''));
  ($('#r-duallowk') as HTMLInputElement).checked = false;
  document.querySelectorAll<HTMLInputElement>('.opp-input').forEach((el) => (el.value = ''));
  $('#r-error').textContent = '';
  ($('#r-results-card') as HTMLElement).hidden = true;
});

// Enter key in any field triggers estimation.
document.querySelectorAll('input').forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      renderResult();
    }
  });
});
