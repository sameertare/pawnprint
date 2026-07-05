import './style.css';
import {
  commitRound, createTournament, pairNextRound, parseRoster,
  recommendedRounds, setResult, standings,
} from './swissEngine';
import type { GameResult, Tournament } from './swissEngine';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const STORE_KEY = 'pawnprint-swiss';
let t: Tournament | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function save() { if (t) localStorage.setItem(STORE_KEY, JSON.stringify(t)); }
function nameOf(id: number | null): string {
  if (id == null || !t) return '—';
  return t.players.find((p) => p.id === id)?.name ?? '—';
}

// ---------- setup ----------
const SAMPLE = `1. Ava Thompson, 1580
2. Ben Carter 1490
3. Chloe Martinez, 1725
4. Diego Rossi 1310
5. Emma Nguyen 1655
6. Farid Hassan, 1205
7. Grace Kim 1802
8. Henry Walsh 1440
9. Isla Robinson 1360
10. Jack Owens`;

$('#sample-roster').addEventListener('click', () => {
  ($('#roster-text') as HTMLTextAreaElement).value = SAMPLE;
  if (!($('#tname') as HTMLInputElement).value) ($('#tname') as HTMLInputElement).value = 'Club Championship';
  previewRoster();
});
($('#roster-text') as HTMLTextAreaElement).addEventListener('input', previewRoster);
$('#roster-file').addEventListener('change', async () => {
  const f = ($('#roster-file') as HTMLInputElement).files?.[0];
  if (!f) return;
  ($('#roster-text') as HTMLTextAreaElement).value = await f.text();
  previewRoster();
});

function previewRoster() {
  const roster = parseRoster(($('#roster-text') as HTMLTextAreaElement).value);
  const prev = $('#roster-preview');
  if (!roster.length) { prev.innerHTML = ''; return; }
  const rr = recommendedRounds(roster.length);
  prev.innerHTML = `<p class="hint">${roster.length} players detected · recommended rounds: <b>${rr}</b></p>
    <div class="chip-list">${roster.map((p) => `<span class="chip">${esc(p.name)}${p.rating ? ` <b>${p.rating}</b>` : ''}</span>`).join('')}</div>`;
}

$('#parse-btn').addEventListener('click', () => {
  const roster = parseRoster(($('#roster-text') as HTMLTextAreaElement).value);
  if (roster.length < 2) { $('#roster-preview').innerHTML = `<p class="neg">Need at least 2 players.</p>`; return; }
  t = createTournament(($('#tname') as HTMLInputElement).value.trim(), roster);
  save();
  renderAll();
});

// ---------- rounds ----------
$('#pair-btn').addEventListener('click', () => {
  if (!t) return;
  const last = t.rounds[t.rounds.length - 1];
  if (last && !last.complete) {
    if (!confirm('The current round has unfinished games. Pair the next round anyway? Unentered games will be treated as not yet played.')) return;
  }
  const round = pairNextRound(t);
  commitRound(t, round);
  save();
  renderAll();
});

$('#reset-tourn').addEventListener('click', () => {
  if (confirm('Delete this tournament and start over?')) {
    t = null;
    localStorage.removeItem(STORE_KEY);
    renderAll();
  }
});

$('#export-json').addEventListener('click', () => {
  if (!t) return;
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `swiss-${(t.name || 'tournament').replace(/[^\w.-]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$('#import-json').addEventListener('change', async () => {
  const f = ($('#import-json') as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    t = JSON.parse(await f.text());
    save();
    renderAll();
  } catch { alert('Could not read that tournament file.'); }
});
$('#print-btn').addEventListener('click', () => window.print());

// ---------- rendering ----------
function renderAll() {
  const hasT = !!t;
  ($('#control-card') as HTMLElement).hidden = !hasT;
  ($('#standings-card') as HTMLElement).hidden = !hasT || !t!.rounds.length;
  ($('#setup-card') as HTMLElement).hidden = hasT;
  if (!t) return;

  const rr = recommendedRounds(t.players.length);
  $('#round-info').innerHTML = `<b>${esc(t.name)}</b> · ${t.players.length} players · ${t.rounds.length}/${rr} rounds played`;

  renderRounds();
  renderStandings();
}

function renderRounds() {
  if (!t) return;
  const el = $('#rounds');
  if (!t.rounds.length) { el.innerHTML = `<p class="hint">No rounds yet — click “Pair next round”.</p>`; return; }
  el.innerHTML = t.rounds
    .map((round) => {
      const rows = round.pairings
        .map((pr) => {
          if (pr.byeId != null) {
            return `<tr><td class="num">${pr.board}</td><td colspan="2"><b>${esc(nameOf(pr.byeId))}</b></td><td colspan="2" class="mid">BYE (+1)</td></tr>`;
          }
          const sel = (val: string, cur: GameResult) =>
            `<option value="${val}"${cur === val ? ' selected' : ''}>`;
          return `<tr>
            <td class="num">${pr.board}</td>
            <td>♔ ${esc(nameOf(pr.whiteId))}</td>
            <td>♚ ${esc(nameOf(pr.blackId))}</td>
            <td colspan="2">
              <select class="result-sel" data-round="${round.number}" data-board="${pr.board}">
                <option value=""${pr.result == null ? ' selected' : ''}>— result —</option>
                ${sel('1-0', pr.result)}White wins (1-0)</option>
                ${sel('1/2-1/2', pr.result)}Draw (½-½)</option>
                ${sel('0-1', pr.result)}Black wins (0-1)</option>
              </select>
            </td>
          </tr>`;
        })
        .join('');
      return `<div class="round-block">
        <h3>Round ${round.number} ${round.complete ? '<span class="pos">✓ complete</span>' : '<span class="hint">in progress</span>'}</h3>
        <table><thead><tr><th class="num">Bd</th><th>White</th><th>Black</th><th colspan="2">Result</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`;
    })
    .reverse()
    .join('');

  el.querySelectorAll<HTMLSelectElement>('.result-sel').forEach((s) => {
    s.addEventListener('change', () => {
      if (!t) return;
      setResult(t, parseInt(s.dataset.round!, 10), parseInt(s.dataset.board!, 10), (s.value || null) as GameResult);
      save();
      renderStandings();
      $('#round-info').innerHTML = $('#round-info').innerHTML; // keep
      // update the round's complete badge
      renderRounds();
    });
  });
}

function renderStandings() {
  if (!t || !t.rounds.length) { ($('#standings-card') as HTMLElement).hidden = true; return; }
  ($('#standings-card') as HTMLElement).hidden = false;
  const rows = standings(t);
  $('#standings').innerHTML = `<table><thead><tr>
      <th class="num">#</th><th>Player</th><th class="num">Rating</th><th class="num">Score</th>
      <th class="num">W</th><th class="num">D</th><th class="num">L</th>
      <th class="num">Buchholz</th><th class="num">S-B</th><th class="num">Colors</th>
    </tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr>
        <td class="num">${r.rank}</td>
        <td>${esc(r.player.name)}${r.player.withdrawn ? ' <span class="hint">(wd)</span>' : ''}</td>
        <td class="num">${r.player.rating ?? '—'}</td>
        <td class="num"><b>${r.score}</b></td>
        <td class="num pos">${r.wins}</td><td class="num mid">${r.draws}</td><td class="num neg">${r.losses}</td>
        <td class="num">${r.buchholz}</td><td class="num">${r.sonnebornBerger}</td>
        <td class="num">${r.colorBalance > 0 ? '+' : ''}${r.colorBalance}</td>
      </tr>`
      )
      .join('')}
    </tbody></table>`;
}

// ---------- boot ----------
const saved = localStorage.getItem(STORE_KEY);
if (saved) {
  try { t = JSON.parse(saved); } catch { t = null; }
}
renderAll();
previewRoster();
