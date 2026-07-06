import './style.css';
import { estimateFideRating } from './fideRatingEngine';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const NUM_OPPONENTS = 15;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const grid = $('#opponent-grid');
grid.innerHTML = Array.from({ length: NUM_OPPONENTS }, (_, i) => {
  const n = i + 1;
  return `<label class="stack opp-slot">Opp ${n}
    <input type="number" class="text-input opp-input" data-idx="${n}" min="100" max="3000" placeholder="—" />
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
  const currentRating = parseFloat(($('#f-current') as HTMLInputElement).value);
  const totalScore = parseFloat(($('#f-score') as HTMLInputElement).value);
  const priorGames = parseFloat(($('#f-priorgames') as HTMLInputElement).value);
  const ageStr = ($('#f-age') as HTMLInputElement).value.trim();
  const age = ageStr ? parseFloat(ageStr) : undefined;
  const opponentRatings = readOpponentRatings();

  const errorEl = $('#f-error');
  const resultsCard = $('#f-results-card') as HTMLElement;

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

  const outcome = estimateFideRating({ currentRating, totalScore, priorGames, age, opponentRatings });
  if (!outcome.ok) {
    errorEl.textContent = outcome.error;
    resultsCard.hidden = true;
    return;
  }
  errorEl.textContent = '';
  const r = outcome.result;

  $('#f-new-rating').textContent = String(r.newRating);
  $('#f-change').textContent = fmtSigned(r.ratingChange);
  ($('#f-change') as HTMLElement).className = 'big ' + (r.ratingChange > 0 ? 'pos' : r.ratingChange < 0 ? 'neg' : '');
  $('#f-performance').textContent = String(r.performanceRating);
  $('#f-kvalue').textContent = String(r.kFactor);

  $('#f-games').textContent = String(r.gamesCounted);
  $('#f-we').textContent = String(r.winExpectancy);
  $('#f-ktier').textContent = r.kTierLabel;

  $('#f-notes').innerHTML = r.notes.length
    ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';

  resultsCard.hidden = false;
  resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#f-estimate-btn').addEventListener('click', renderResult);

$('#f-clear-btn').addEventListener('click', () => {
  (['#f-current', '#f-score', '#f-priorgames', '#f-age'] as const).forEach((sel) => (($(sel) as HTMLInputElement).value = ''));
  document.querySelectorAll<HTMLInputElement>('.opp-input').forEach((el) => (el.value = ''));
  $('#f-error').textContent = '';
  ($('#f-results-card') as HTMLElement).hidden = true;
});

document.querySelectorAll('input').forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      renderResult();
    }
  });
});
