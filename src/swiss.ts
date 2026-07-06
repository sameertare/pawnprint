import './style.css';
import {
  commitRound, createTournament, pairNextRound, parseRoster,
  recommendedRounds, setResult, standings,
} from './swissEngine';
import type { GameResult, RosterEntry, RosterFormat, Tournament } from './swissEngine';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const STORE_KEY = 'pawnprint-swiss';

/** An event holds one Swiss tournament per section; all sections advance round-by-round together. */
interface SwissEvent { name: string; sections: Tournament[]; active: number; }
let ev: SwissEvent | null = null;

function cur(): Tournament | null { return ev ? ev.sections[ev.active] : null; }
function save() { if (ev) localStorage.setItem(STORE_KEY, JSON.stringify(ev)); }

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function nameOf(t: Tournament, id: number | null): string {
  if (id == null) return '—';
  return t.players.find((p) => p.id === id)?.name ?? '—';
}

// ---------- setup ----------
function currentFormat(): RosterFormat {
  return (($('#format-select') as HTMLSelectElement).value as RosterFormat) || 'plain';
}

const FORMAT_HINT: Record<string, string> = {
  plain: 'One player per line: “Name”, “Name Rating”, or “Name, Rating” (optional leading “1.” numbering).',
  table: 'A delimited table whose header row labels the columns (tab- or comma-separated). The Name and Rating columns are used; #, ID and bye columns are ignored.',
  nwchess: 'An NWChess RosterTable.csv export. FIDE ignored; seeded by max(NWSRS, USCF); withdrawn players excluded; multiple sections supported.',
};
const FORMAT_LABEL: Record<string, string> = { plain: 'Plain list', table: 'US Chess table', nwchess: 'NWChess RosterTable.csv' };

/**
 * If parsing with the currently-selected format leaves numbers stuck in player names (a strong
 * sign the wrong format is selected — e.g. a tab/space table parsed as a plain list), check
 * whether one of the other two formats parses the same text into fully clean names with at least
 * as many players, and suggest switching to it. Returns null if the current format looks fine.
 */
function suggestBetterFormat(text: string, current: RosterFormat, currentRoster: RosterEntry[]) {
  const dirty = currentRoster.filter((p) => /\d/.test(p.name)).length;
  if (dirty === 0) return null;
  const others: RosterFormat[] = (['plain', 'table', 'nwchess'] as RosterFormat[]).filter((f) => f !== current);
  let best: { format: RosterFormat; roster: RosterEntry[] } | null = null;
  for (const f of others) {
    const roster = parseRoster(text, f);
    if (roster.length < currentRoster.length) continue;
    if (roster.some((p) => /\d/.test(p.name))) continue;
    if (!best || roster.length > best.roster.length) best = { format: f, roster };
  }
  return best;
}

const SAMPLES: Record<string, { text: string; tname: string }> = {
  plain: {
    tname: 'Club Championship',
    text: `1. Ava Thompson, 1580
2. Ben Carter 1490
3. Chloe Martinez, 1725
4. Diego Rossi 1310
5. Emma Nguyen 1655
6. Farid Hassan, 1205
7. Grace Kim 1802
8. Henry Walsh 1440
9. Isla Robinson 1360
10. Jack Owens`,
  },
  table: {
    tname: 'US Chess Open',
    text: `#\tName\tUS Chess ID\tRating\tBye Rds
1\tYogi Saputra\t13838368\t2057\t
2\tLucas Maokhampio\t31368597\t2015\t3
3\tEdwin Battistella\t12474865\t1932\t
4\tJeremy Campbell\t32332565\t1863\t
5\tDavid Murray\t12678095\t1853\t
6\tJason Richner\t12398033\t1802\t`,
  },
  nwchess: {
    tname: 'Scholastic Championship',
    text: `" ","Name","NWSRS","USCF","FIDE","NWChess","Byes","Fees"
"","","First","","","","ID","","ID","","","ID","Title","","Rounds","Status"
"Open","Smith","Alice","6","Sample ES","1600","SMP001A","1550","30000001","01/2027","0","0","","","","Paid"
"Open","Jones","Bob","7","Sample MS","1400","SMP002B","1480","30000002","01/2027","0","0","","","","Paid"
"Open","Chen","Cara","5","Sample ES","1520","SMP003C","1495","30000003","01/2027","0","0","","","","Paid"
"U1000","Lee","Dan","4","Sample ES","1000","SMP004D","950","30000004","01/2027","0","0","","","","Paid"
"U1000","Kim","Eve","3","Sample ES","900","SMP005E","0","","","0","0","","","","Paid"
"Withdrew","Park","Zoe","6","Sample ES","1100","SMP006Z","1080","30000006","01/2027","0","0","","","","----"`,
  },
};

function applyFormatHint() {
  $('#format-hint').textContent = FORMAT_HINT[currentFormat()] ?? '';
}

$('#sample-roster').addEventListener('click', () => {
  const s = SAMPLES[currentFormat()] ?? SAMPLES.plain;
  ($('#roster-text') as HTMLTextAreaElement).value = s.text;
  if (!($('#tname') as HTMLInputElement).value) ($('#tname') as HTMLInputElement).value = s.tname;
  previewRoster();
});
($('#format-select') as HTMLSelectElement).addEventListener('change', () => { applyFormatHint(); previewRoster(); });
($('#roster-text') as HTMLTextAreaElement).addEventListener('input', previewRoster);
$('#roster-file').addEventListener('change', async () => {
  const f = ($('#roster-file') as HTMLInputElement).files?.[0];
  if (!f) return;
  ($('#roster-text') as HTMLTextAreaElement).value = await f.text();
  previewRoster();
});

function distinctSections(roster: RosterEntry[]): string[] {
  return [...new Set(roster.filter((p) => p.section).map((p) => p.section as string))];
}

/** Section <select> in setup is preview-only — creating always sets up every section. */
function syncSectionUI(roster: RosterEntry[]): string[] {
  const secs = distinctSections(roster);
  const row = $('#section-row') as HTMLElement;
  const sel = $('#section-filter') as HTMLSelectElement;
  if (secs.length > 1) {
    const keep = sel.value;
    sel.innerHTML =
      `<option value="__ALL__">All sections (${roster.length})</option>` +
      secs.map((s) => `<option value="${esc(s)}">${esc(s)} (${roster.filter((p) => p.section === s).length})</option>`).join('');
    if (keep && (secs.includes(keep) || keep === '__ALL__')) sel.value = keep;
    row.hidden = false;
  } else {
    row.hidden = true;
    sel.innerHTML = '';
  }
  return secs;
}
function previewSelection(roster: RosterEntry[]): RosterEntry[] {
  const secs = distinctSections(roster);
  if (secs.length <= 1) return roster;
  const sel = ($('#section-filter') as HTMLSelectElement).value;
  return !sel || sel === '__ALL__' ? roster : roster.filter((p) => p.section === sel);
}

function previewRoster() {
  const text = ($('#roster-text') as HTMLTextAreaElement).value;
  const fmt = currentFormat();
  const all = parseRoster(text, fmt);
  const prev = $('#roster-preview');
  if (!all.length) {
    ($('#section-row') as HTMLElement).hidden = true;
    prev.innerHTML = text.trim()
      ? `<p class="neg">No players parsed as <b>${esc(($('#format-select') as HTMLSelectElement).selectedOptions[0].text)}</b>. Check that the roster matches the selected format.</p>`
      : '';
    return;
  }
  const secs = syncSectionUI(all);
  const roster = previewSelection(all);
  const rr = recommendedRounds(roster.length);
  const note = fmt === 'nwchess'
    ? `<p class="hint">📋 NWChess format — FIDE ratings ignored, seeding by <b>max(NWSRS, USCF)</b>; withdrawn players excluded.` +
      (secs.length > 1 ? ` Creating sets up all <b>${secs.length}</b> sections; “Pair next round” pairs them together.` : '') + `</p>`
    : '';
  const unrated = roster.filter((p) => p.rating == null).length;
  const withByes = roster.filter((p) => p.byeRounds && p.byeRounds.length).length;

  const suggestion = suggestBetterFormat(text, fmt, all);
  const warning = suggestion
    ? `<div class="format-warning">⚠ These names still contain numbers — this usually means the wrong roster format is selected. This looks like <b>${FORMAT_LABEL[suggestion.format]}</b> instead.
        <button id="switch-format-btn" class="btn btn-primary" data-fmt="${suggestion.format}">Switch to ${FORMAT_LABEL[suggestion.format]} →</button></div>`
    : '';

  const showSection = secs.length > 1;
  const rows = roster
    .map(
      (p, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(p.name)}</td>
        <td class="num">${p.rating ?? '<span class="hint">unrated</span>'}</td>
        <td class="num">${p.byeRounds && p.byeRounds.length ? `R${p.byeRounds.join(', R')}` : '—'}</td>
        ${showSection ? `<td>${esc(p.section ?? '—')}</td>` : ''}
      </tr>`
    )
    .join('');

  prev.innerHTML =
    warning +
    note +
    `<p class="hint">Previewing ${roster.length} players${secs.length > 1 ? '' : ` · recommended rounds: <b>${rr}</b>`}${unrated ? ` · ${unrated} unrated` : ''}${withByes ? ` · ${withByes} with a requested bye` : ''}</p>` +
    `<div class="roster-table-wrap"><table class="roster-table"><thead><tr>
        <th class="num">#</th><th>Name</th><th class="num">Rating</th><th class="num">Bye</th>${showSection ? '<th>Section</th>' : ''}
      </tr></thead><tbody>${rows}</tbody></table></div>`;

  $('#switch-format-btn')?.addEventListener('click', () => {
    const btn = $('#switch-format-btn') as HTMLButtonElement;
    ($('#format-select') as HTMLSelectElement).value = btn.dataset.fmt!;
    applyFormatHint();
    previewRoster();
  });
}

($('#section-filter') as HTMLSelectElement).addEventListener('change', previewRoster);

/** Group the roster into one {name, roster} per section (or a single section for a plain list). */
function buildSectionGroups(all: RosterEntry[], eventName: string): { name: string; roster: RosterEntry[] }[] {
  const secs = distinctSections(all);
  if (secs.length <= 1) return [{ name: eventName, roster: all }];
  return secs.map((s) => ({ name: s, roster: all.filter((p) => p.section === s) }));
}

$('#parse-btn').addEventListener('click', () => {
  const all = parseRoster(($('#roster-text') as HTMLTextAreaElement).value, currentFormat());
  if (all.length < 2) { $('#roster-preview').innerHTML = `<p class="neg">Need at least 2 players (parsed as the selected format).</p>`; return; }
  const eventName = ($('#tname') as HTMLInputElement).value.trim() || 'Swiss Tournament';
  const groups = buildSectionGroups(all, eventName);
  const usable = groups.filter((g) => g.roster.length >= 2);
  const skipped = groups.filter((g) => g.roster.length < 2);
  if (!usable.length) { $('#roster-preview').innerHTML = `<p class="neg">Each section needs at least 2 players.</p>`; return; }
  ev = { name: eventName, sections: usable.map((g) => createTournament(g.name, g.roster)), active: 0 };
  save();
  renderAll();
  if (skipped.length) {
    $('#round-info').innerHTML += ` <span class="hint">(skipped ${skipped.map((g) => esc(g.name)).join(', ')} — fewer than 2 players)</span>`;
  }
});

// ---------- rounds ----------
$('#pair-btn').addEventListener('click', () => {
  if (!ev) return;
  const anyIncomplete = ev.sections.some((s) => {
    const last = s.rounds[s.rounds.length - 1];
    return last && !last.complete;
  });
  if (anyIncomplete &&
      !confirm('Some sections have unfinished games in the current round. Pair the next round for ALL sections anyway? Unentered games count as not yet played.')) {
    return;
  }
  for (const s of ev.sections) {
    const round = pairNextRound(s);
    commitRound(s, round);
  }
  save();
  renderAll();
});

$('#reset-tourn').addEventListener('click', () => {
  if (confirm('Delete this event (all sections) and start over?')) {
    ev = null;
    localStorage.removeItem(STORE_KEY);
    renderAll();
  }
});

// Non-destructive: reveal the roster screen again (same roster text/format still in the
// textarea) so a wrong-format or otherwise broken tournament can be fixed and re-created,
// without deleting anything unless "Create tournament" is actually clicked again.
$('#edit-roster-btn').addEventListener('click', () => {
  ($('#setup-card') as HTMLElement).hidden = false;
  ($('#control-card') as HTMLElement).hidden = true;
  ($('#standings-card') as HTMLElement).hidden = true;
  previewRoster();
  ($('#setup-card') as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#export-json').addEventListener('click', () => {
  if (!ev) return;
  const blob = new Blob([JSON.stringify(ev, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `swiss-${(ev.name || 'event').replace(/[^\w.-]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$('#import-json').addEventListener('change', async () => {
  const f = ($('#import-json') as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data && Array.isArray(data.sections)) ev = data;
    else if (data && Array.isArray(data.players)) ev = { name: data.name || 'Swiss', sections: [data], active: 0 };
    else throw new Error('bad');
    ev!.active = 0;
    save();
    renderAll();
  } catch { alert('Could not read that tournament file.'); }
});
$('#print-btn').addEventListener('click', () => window.print());

// ---------- rendering ----------
function renderAll() {
  const hasE = !!ev;
  ($('#control-card') as HTMLElement).hidden = !hasE;
  ($('#setup-card') as HTMLElement).hidden = hasE;
  const t = cur();
  ($('#standings-card') as HTMLElement).hidden = !t || !t.rounds.length;
  renderPrintArea();
  if (!ev || !t) return;

  renderSectionTabs();
  const rr = recommendedRounds(t.players.length);
  const roundsPlayed = t.rounds.length;
  const evLabel = ev.sections.length > 1
    ? `<b>${esc(ev.name)}</b> · ${ev.sections.length} sections · round ${roundsPlayed} · viewing <b>${esc(t.name)}</b> (${t.players.length} players, ${roundsPlayed}/${rr} rounds)`
    : `<b>${esc(t.name)}</b> · ${t.players.length} players · ${roundsPlayed}/${rr} rounds played`;
  $('#round-info').innerHTML = evLabel;

  renderRounds(t);
  renderStandings(t);
}

function renderSectionTabs() {
  const el = $('#section-tabs');
  if (!ev || ev.sections.length <= 1) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = ev.sections
    .map((s, i) => {
      const done = s.rounds.length && s.rounds[s.rounds.length - 1].complete;
      return `<button class="sec-tab ${i === ev!.active ? 'active' : ''}" data-i="${i}">${esc(s.name)} <span class="hint">${s.players.length}p · R${s.rounds.length}${done ? ' ✓' : ''}</span></button>`;
    })
    .join('');
  el.querySelectorAll<HTMLElement>('.sec-tab').forEach((b) =>
    b.addEventListener('click', () => { if (ev) { ev.active = parseInt(b.dataset.i!, 10); save(); renderAll(); } })
  );
}

function renderRounds(t: Tournament) {
  const el = $('#rounds');
  if (!t.rounds.length) { el.innerHTML = `<p class="hint">No rounds yet — click “Pair next round”.</p>`; return; }
  el.innerHTML = t.rounds
    .map((round) => {
      const rows = round.pairings
        .map((pr) => {
          if (pr.byeId != null) {
            const pts = pr.byePoints ?? 1;
            const label = pts === 0.5 ? 'REQUESTED BYE (+½)' : 'BYE (+1)';
            return `<tr><td class="num">${pr.board}</td><td colspan="2"><b>${esc(nameOf(t, pr.byeId))}</b></td><td colspan="2" class="mid">${label}</td></tr>`;
          }
          const sel = (val: string, cur: GameResult) => `<option value="${val}"${cur === val ? ' selected' : ''}>`;
          return `<tr>
            <td class="num">${pr.board}</td>
            <td>♔ ${esc(nameOf(t, pr.whiteId))}</td>
            <td>♚ ${esc(nameOf(t, pr.blackId))}</td>
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
      const t2 = cur();
      if (!t2) return;
      setResult(t2, parseInt(s.dataset.round!, 10), parseInt(s.dataset.board!, 10), (s.value || null) as GameResult);
      save();
      renderStandings(t2);
      renderSectionTabs();
      renderRounds(t2);
      renderPrintArea();
    });
  });
}

function standingsTableHtml(t: Tournament): string {
  const rows = standings(t);
  return `<table><thead><tr>
      <th class="num">#</th><th>Player</th><th class="num">Rating</th><th class="num">Score</th>
      <th class="num">W</th><th class="num">D</th><th class="num">L</th>
      <th class="num">Buchholz</th><th class="num">S-B</th><th class="num">Colors</th>
    </tr></thead><tbody>
    ${rows.map((r) => `<tr>
        <td class="num">${r.rank}</td>
        <td>${esc(r.player.name)}${r.player.withdrawn ? ' <span class="hint">(wd)</span>' : ''}</td>
        <td class="num">${r.player.rating ?? '—'}</td>
        <td class="num"><b>${r.score}</b></td>
        <td class="num pos">${r.wins}</td><td class="num mid">${r.draws}</td><td class="num neg">${r.losses}</td>
        <td class="num">${r.buchholz}</td><td class="num">${r.sonnebornBerger}</td>
        <td class="num">${r.colorBalance > 0 ? '+' : ''}${r.colorBalance}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

function renderStandings(t: Tournament) {
  if (!t.rounds.length) { ($('#standings-card') as HTMLElement).hidden = true; return; }
  ($('#standings-card') as HTMLElement).hidden = false;
  $('#standings').innerHTML = standingsTableHtml(t);
}

/** Print view: standings for every section (a wall chart for posting). */
function renderPrintArea() {
  const el = $('#print-area');
  if (!ev) { el.innerHTML = ''; return; }
  el.innerHTML =
    `<h1>${esc(ev.name)} — Standings</h1>` +
    ev.sections.map((s) =>
      `<h2>${esc(s.name)} <span style="font-weight:400">· ${s.players.length} players · ${s.rounds.length} rounds</span></h2>` +
      (s.rounds.length ? standingsTableHtml(s) : '<p>No rounds played.</p>')
    ).join('');
}

// ---------- boot ----------
const saved = localStorage.getItem(STORE_KEY);
if (saved) {
  try {
    const data = JSON.parse(saved);
    if (data && Array.isArray(data.sections)) ev = data;
    else if (data && Array.isArray(data.players)) ev = { name: data.name || 'Swiss', sections: [data], active: 0 }; // migrate old single-tournament save
  } catch { ev = null; }
}
applyFormatHint();
renderAll();
previewRoster();
