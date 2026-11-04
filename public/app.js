const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

let key = localStorage.getItem('hw_key') || '';
let data = { items: [], state: {}, subscribers: 0 };
let tab = 'upcoming';
let lastHidden = null;
let query = '';
let courseFilter = '';
let upcomingView = (() => { try { return localStorage.getItem('hw_view') || 'list'; } catch { return 'list'; } })();
let sheetId = null;
// Items checked or un-checked this session stay where they are (so a mis-tap is
// easy to see and undo) until the list reloads.
const justChanged = new Set();

// If anything throws before the first render, show it rather than a blank page.
function fatal(msg) {
  const el = document.getElementById('view') || document.body;
  el.innerHTML = `<div class="empty"><strong>Something went wrong</strong>${esc(String(msg || ''))}
    <div class="row" style="justify-content:center;margin-top:14px">
      <button class="primary" onclick="location.reload(true)">Reload</button>
      <button class="ghost" id="hardReset">Clear cache and reload</button>
    </div></div>`;
  const hr = document.getElementById('hardReset');
  if (hr) hr.onclick = async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch {}
    try { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); } catch {}
    location.reload(true);
  };
}
window.addEventListener('error', e => {
  if (document.querySelector('.item, .today, .card, .login')) return;   // already rendered something
  fatal(e.message);
});

// ---------------- themes ----------------

const THEMES = [
  { id: 'default',  name: 'Default',  sw: ['#f6f5f1', '#3b5bdb'] },
  { id: 'husky',    name: 'Husky',    sw: ['#4b2e83', '#b7a57a'] },
  { id: 'midnight', name: 'Midnight', sw: ['#101722', '#4da3ff'] },
  { id: 'forest',   name: 'Forest',   sw: ['#2f7a4f', '#5fd08a'] },
  { id: 'sunrise',  name: 'Sunrise',  sw: ['#c2410c', '#ff9f45'] },
  { id: 'mono',     name: 'Mono',     sw: ['#111113', '#9b9ba1'] },
];
const MODES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];

function applyTheme(theme, mode) {
  const r = document.documentElement;
  r.dataset.theme = THEMES.some(t => t.id === theme) ? theme : 'default';
  r.dataset.mode = MODES.some(([m]) => m === mode) ? mode : 'auto';
  try { localStorage.setItem('hw_theme', JSON.stringify({ theme: r.dataset.theme, mode: r.dataset.mode })); } catch {}
  // Keep the iOS status bar and Android chrome in step with the palette.
  const bg = getComputedStyle(r).getPropertyValue('--bg').trim();
  if (bg) {
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
    const m = document.createElement('meta');
    m.name = 'theme-color'; m.content = bg;
    document.head.appendChild(m);
  }
}
// Applied before the first paint so the app never flashes the wrong palette.
(function bootTheme() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('hw_theme') || '{}'); } catch {}
  applyTheme(saved.theme, saved.mode);
})();

const WHATS_NEW = {
  '1.3.0': 'New: themes, a Today card, a two-week workload chart, week view, search, stars, time estimates, notes and snooze. Swipe a row right to check it off.',
  '1.2.0': "New: work due early in the morning now shows up the night before, and its reminder comes that evening instead of while you're asleep. Change it under Settings → How days are grouped.",
  '1.1.0': 'New: a Done tab, grades in Courses, uncheck anything, reminder settings, and alerts for new assignments.',
};

// ---------------- api ----------------

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (key) headers.Authorization = 'Bearer ' + key;
  const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { forget(); showLogin('Your saved key stopped working. Sign in again.'); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(body.error || 'Request failed (' + res.status + ')');
  return body;
}

async function load() {
  data = await api('/api/items');
  const pf = data.config?.prefs || {};
  applyTheme(pf.theme, pf.mode);
  justChanged.clear();
  render();
  setBadge(data.badge || 0);
}

function setBadge(n) {
  try { if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch {}
}

// ---------------- helpers ----------------

function hue(str) {
  let h = 0;
  for (const c of str || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
const courseColor = c => c ? `hsl(${hue(c)} 62% 55%)` : 'var(--muted)';

function pDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
// The day something lands on your list. Work due before this hour shows up the
// evening before, so an 8am deadline is on tonight's list, not tomorrow morning's.
const DEFAULT_PREV_HOUR = 23;
function prevHour() {
  const v = data.config?.prefs?.showPrevHour;
  return Number.isInteger(v) ? v : DEFAULT_PREV_HOUR;
}
function hourIn(date) {
  return +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date);
}
function prevDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  const p = n => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}
function workDay(iso) {
  const d = new Date(iso);
  const cutoff = prevHour();
  const key = pDay(d);
  return cutoff > 0 && hourIn(d) < cutoff ? prevDayKey(key) : key;
}
const shifted = iso => workDay(iso) !== pDay(new Date(iso));

function dayLabel(dayKey) {
  const today = pDay(new Date());
  const tomorrow = pDay(new Date(Date.now() + 864e5));
  if (dayKey === today) return 'Today';
  if (dayKey === tomorrow) return 'Tomorrow';
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const days = (dt - new Date()) / 864e5;
  return dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: days < 6 ? 'long' : 'short', month: days < 6 ? undefined : 'short', day: days < 6 ? undefined : 'numeric' });
}
// Snoozing moves something down your list without touching its real deadline.
function effDay(it) {
  const base = it.due ? workDay(it.due) : null;
  if (!it.snooze) return base;
  const sn = pDay(new Date(it.snooze));
  return !base || sn > base ? sn : base;
}
const isSnoozed = it => !!(it.snooze && pDay(new Date(it.snooze)) > pDay(new Date()));

const KIND_MINUTES = { exam: 90, assignment: 45, prep: 25, reading: 25, custom: 30 };
const estOf = it => (Number.isFinite(it.est) && it.est > 0 ? it.est : null);
function fmtMins(m) {
  if (!m) return '';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

// Starred work floats to the top of its day, then earliest deadline first.
function byPriority(a, b) {
  if (!!a.star !== !!b.star) return a.star ? -1 : 1;
  return (a.due ? Date.parse(a.due) : 9e15) - (b.due ? Date.parse(b.due) : 9e15);
}

function matchesFilter(it) {
  if (courseFilter && (it.course || 'Other') !== courseFilter) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return (it.title || '').toLowerCase().includes(q) ||
    (it.course || '').toLowerCase().includes(q) ||
    (it.note || '').toLowerCase().includes(q);
}

function timeStr(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}
function relTime(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Done if you checked it or Canvas has a submission, unless you un-checked it.
const isDone = it => it.override === 'open' ? false : !!(it.done || it.submitted);

function gradeFor(it) {
  if (!data.grades || !it.id.startsWith('a:')) return null;
  if (!gradeFor.map || gradeFor.src !== data.grades) {
    gradeFor.map = new Map(data.grades.subs.map(g => [g.id, g]));
    gradeFor.src = data.grades;
  }
  return gradeFor.map.get(it.id) || null;
}

const fmtNum = n => Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString();
function scoreText(g) {
  if (g.excused) return 'Excused';
  if (g.score == null) return '';
  if (g.possible) return `${fmtNum(g.score)}/${fmtNum(g.possible)}`;
  return g.grade ? String(g.grade) : fmtNum(g.score);
}

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? ` <button class="link-btn" style="color:inherit;text-decoration:underline">${esc(action.label)}</button>` : '');
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.fn(); };
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, action ? 5000 : 2600);
}

// ---------------- rendering ----------------

const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

function itemRow(it, { showDay = false } = {}) {
  if (it.kind === 'event') {
    return `<div class="item event"><div class="dot">•</div><div class="body"><div class="title">${esc(timeStr(it.due))} · ${esc(it.course || it.title)} class</div></div></div>`;
  }
  const done = isDone(it);
  const left = it.due ? Date.parse(it.due) - Date.now() : null;
  let dueCls = '';
  if (left !== null && !done) dueCls = left < 0 ? 'late' : left < 6 * 3600e3 ? 'soon' : '';
  const offDay = it.due && (shifted(it.due) || effDay(it) !== workDay(it.due));
  const dueTxt = it.due ? ((showDay || offDay) ? `${dayLabel(pDay(new Date(it.due)))} ${timeStr(it.due)}` : timeStr(it.due)) : '';
  const tags = [];
  if (it.kind === 'exam') tags.push('<span class="tag exam">Exam</span>');
  if (it.kind === 'prep') tags.push('<span class="tag prep">Prep</span>');
  if (it.kind === 'reading') tags.push('<span class="tag reading">Reading</span>');
  const est = estOf(it);
  if (est) tags.push(`<span class="tag est">${esc(fmtMins(est))}</span>`);
  if (it.note) tags.push('<span class="tag note">Note</span>');
  if (isSnoozed(it)) tags.push(`<span class="tag">Snoozed to ${esc(dayLabel(pDay(new Date(it.snooze))))}</span>`);
  const g = gradeFor(it);
  if (g && g.missing && !done) tags.push('<span class="tag exam">Missing</span>');
  if (g && scoreText(g)) tags.push(`<span class="tag score">${esc(scoreText(g))}</span>`);
  else if (it.submitted && it.override !== 'open') tags.push('<span class="tag sub">Submitted</span>');
  const title = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title);
  return `<div class="item swipe ${done ? 'done' : ''} ${it.star ? 'star-on' : ''} ${isSnoozed(it) ? 'snoozed' : ''}" data-id="${esc(it.id)}">
    <button class="check" data-act="toggle" aria-label="${done ? 'Mark not done' : 'Mark done'}">${CHECK}</button>
    <div class="body" data-act="open">
      <div class="title">${title}</div>
      <div class="meta">
        ${it.course ? `<span class="chip" style="--c:${courseColor(it.course)}">${esc(it.course)}</span>` : ''}
        ${dueTxt ? `<span class="due ${dueCls}">${esc(dueTxt)}</span>` : ''}
        ${it.module ? `<span>${esc(it.module)}</span>` : ''}
        ${tags.join('')}
      </div>
    </div>
    <button class="more" data-act="hide" aria-label="Remove">×</button>
  </div>`;
}

function section(label, items, opts = {}) {
  if (!items.length) return '';
  return `<div class="section"${opts.day ? ` id="day-${esc(opts.day)}"` : ''}><h2 class="${opts.cls || ''}">${esc(label)}</h2><span class="count">${opts.count ?? ''}</span></div>
    <div class="list">${items.map(i => itemRow(i, opts)).join('')}</div>`;
}

function visible() {
  return data.items.filter(it => !it.hidden && (!isDone(it) || it.kind === 'event' || justChanged.has(it.id)));
}

// What today actually asks of you: how much is left and roughly how long it takes.
function todayCard(todayItems) {
  const real = todayItems.filter(i => i.kind !== 'event');
  if (!real.length) return '';
  const done = real.filter(isDone).length;
  const left = real.length - done;
  const mins = real.filter(i => !isDone(i)).reduce((t, i) => t + (estOf(i) || KIND_MINUTES[i.kind] || 30), 0);
  const exact = real.filter(i => !isDone(i) && estOf(i)).length;
  const pct = real.length ? done / real.length : 0;
  const C = 2 * Math.PI * 24;
  const hot = mins >= 240;
  return `<div class="today">
    <div class="ring">
      <svg viewBox="0 0 58 58"><circle class="track" cx="29" cy="29" r="24" fill="none" stroke-width="6"/>
        ${pct > 0 ? `<circle class="fill" cx="29" cy="29" r="24" fill="none" stroke-width="6" stroke-linecap="round"
          stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"/>` : ''}</svg>
      <b>${done}/${real.length}</b>
    </div>
    <div class="today-body">
      <h3>${left ? `${left} left today` : 'Today is clear'}</h3>
      <p>${left ? `<span class="${hot ? 'hot' : ''}">about ${esc(fmtMins(mins))}</span> of work${exact ? '' : ', estimated from the type of work'}` : 'Everything on today\'s list is checked off.'}</p>
    </div>
  </div>`;
}

// Two weeks at a glance, so a pile-up is visible before it arrives.
function forecast(items) {
  const today = pDay(new Date());
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() + i * 864e5);
    const key = pDay(d);
    const list = items.filter(it => it.kind !== 'event' && !isDone(it) && effDay(it) === (i === 0 ? today : key));
    const mins = list.reduce((t, it) => t + (estOf(it) || KIND_MINUTES[it.kind] || 30), 0);
    days.push({ key, d, n: list.length, mins });
  }
  const peak = Math.max(60, ...days.map(x => x.mins));
  if (!days.some(x => x.n)) return '';
  const bars = days.map((x, i) => {
    const h = Math.round((x.mins / peak) * 52);
    const cls = [x.n ? '' : 'none', x.mins >= 240 ? 'heavy' : '', i === 0 ? 'is-today' : ''].filter(Boolean).join(' ');
    const label = x.d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'narrow' });
    return `<button class="bar ${cls}" data-act="jump" data-day="${x.key}" title="${esc(x.n + ' due, about ' + (fmtMins(x.mins) || '0m'))}">
      <b>${x.n || ''}</b><i style="height:${Math.max(h, 3)}px"></i><span>${esc(label)}</span></button>`;
  }).join('');
  return `<div class="forecast"><h3>Next two weeks</h3><div class="bars">${bars}</div></div>`;
}

function filterBar(withView) {
  const courses = [...new Set(data.items.filter(i => i.kind !== 'event' && !i.hidden).map(i => i.course || 'Other'))].sort();
  const chips = [`<button class="fchip all ${courseFilter ? '' : 'on'}" data-act="course" data-course="">All</button>`]
    .concat(courses.map(c => `<button class="fchip ${courseFilter === c ? 'on' : ''}" data-act="course" data-course="${esc(c)}" style="--c:${courseColor(c)}">${esc(c)}</button>`));
  const seg = withView ? `<div class="segbtns">
      <button data-act="view" data-view="list" class="${upcomingView === 'list' ? 'on' : ''}">List</button>
      <button data-act="view" data-view="week" class="${upcomingView === 'week' ? 'on' : ''}">Week</button>
    </div>` : '';
  return `<div class="filters">
      <input type="search" id="q" placeholder="Search your work" value="${esc(query)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      ${seg}
    </div>
    ${courses.length > 1 ? `<div class="chiprow">${chips.join('')}</div>` : ''}`;
}

function weekGrid(items) {
  const today = pDay(new Date());
  let html = '<div class="week">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 864e5);
    const key = pDay(d);
    const list = items.filter(it => effDay(it) === key).sort(byPriority);
    const pills = list.slice(0, 4).map(it => `<button class="wpill ${isDone(it) ? 'done' : ''}" data-act="open" data-id="${esc(it.id)}"
      style="--c:${it.kind === 'event' ? 'var(--muted)' : courseColor(it.course)}" title="${esc((it.course ? it.course + ' · ' : '') + it.title)}">${esc(it.title)}</button>`).join('');
    const more = list.length > 4 ? `<span class="wmore">+${list.length - 4}</span>` : '';
    html += `<div class="wday ${key === today ? 'is-today' : ''}">
      <h4>${esc(d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }))}<b>${esc(d.toLocaleDateString('en-US', { timeZone: TZ, day: 'numeric' }))}</b></h4>
      ${pills}${more}</div>`;
  }
  return html + '</div>';
}

function renderUpcoming() {
  const now = Date.now();
  const all = visible().filter(it => it.due);
  const items = all.filter(matchesFilter);
  const overdue = items.filter(it => it.kind !== 'event' && Date.parse(it.due) < now && (!isDone(it) || justChanged.has(it.id)) && Date.parse(it.due) > now - 7 * 864e5 && !isSnoozed(it))
    .sort(byPriority);
  const future = items.filter(it => Date.parse(it.due) >= now || (isSnoozed(it) && Date.parse(it.due) > now - 7 * 864e5))
    .filter(it => it.kind !== 'event' || pDay(new Date(it.due)) === pDay(new Date()) || pDay(new Date(it.due)) === pDay(new Date(now + 864e5)))
    .sort(byPriority);

  const todayKey = pDay(new Date());
  const groups = new Map();
  for (const it of future) {
    // Still-open work due later today keeps today's heading rather than sliding
    // onto a day that has already gone.
    const w = it.kind === 'event' ? pDay(new Date(it.due)) : effDay(it);
    const k = w < todayKey ? todayKey : w;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const undated = visible().filter(it => !it.due && it.kind !== 'event').filter(matchesFilter).sort(byPriority);

  const head = todayCard([...(groups.get(todayKey) || []), ...overdue]) + forecast(all) + filterBar(true);
  if (upcomingView === 'week') {
    const wk = weekGrid(items.filter(it => Date.parse(it.due) > now - 864e5));
    view.innerHTML = head + wk + section('Overdue', overdue, { cls: 'overdue', showDay: true, count: overdue.length });
    return;
  }

  let html = section('Overdue', overdue, { cls: 'overdue', showDay: true, count: overdue.length });
  let shown = 0;
  for (const [k, list] of [...groups].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (shown > 14 && !['Today', 'Tomorrow'].includes(dayLabel(k))) break;
    const open = list.filter(i => i.kind !== 'event' && !isDone(i)).length;
    html += section(dayLabel(k), list, { count: open ? `${open} open` : '', day: k });
    shown++;
  }
  html += section('No due date', undated, { count: undated.length });
  if (!html) html = query || courseFilter ? `<div class="empty"><strong>Nothing matches</strong>Try a different search or course.</div>` : emptyState();
  view.innerHTML = head + html;
}

function renderPrep() {
  const items = visible().filter(it => ['prep', 'reading'].includes(it.kind) && it.kind !== 'event')
    .filter(it => !it.due || Date.parse(it.due) > Date.now() - 864e5)
    .filter(matchesFilter);
  const dated = items.filter(it => it.due).sort(byPriority);
  const undated = items.filter(it => !it.due).sort(byPriority);
  let body = section('Before class', dated.slice(0, 30), { showDay: true, count: dated.length });
  body += section('Readings from Modules', undated, { count: undated.length });
  if (!body) body = `<div class="empty"><strong>No prep work open</strong>PREP lessons, reading quizzes, prelabs and module readings show up here. Run the Sync bookmark on Canvas to pull module readings.</div>`;
  view.innerHTML = filterBar(false) + body;
}

function seenGradesAt() { try { return localStorage.getItem('hw_grades_seen') || ''; } catch { return ''; } }
function newGradeCount() {
  const seen = Date.parse(seenGradesAt() || 0) || 0;
  return (data.grades?.subs || []).filter(g => g.score != null && Date.parse(g.gradedAt || 0) > seen).length;
}

function gradeLine(g, seen) {
  const isNew = g.score != null && Date.parse(g.gradedAt || 0) > seen;
  const pct = g.score != null && g.possible ? Math.round((g.score / g.possible) * 100) : null;
  const name = g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.name)}</a>` : esc(g.name);
  return `<div class="gline ${isNew ? 'new' : ''}">
    <div class="gname">${isNew ? '<span class="newdot" aria-label="New"></span>' : ''}${name}</div>
    <div class="gscore">${g.missing && g.score == null ? '<span class="tag exam">Missing</span>' : esc(scoreText(g))}${pct != null ? `<span class="pct">${pct}%</span>` : ''}</div>
  </div>`;
}

function renderCourses() {
  const g = data.grades || { courses: [], subs: [] };
  const seen = Date.parse(seenGradesAt() || 0) || 0;
  const open = data.items.filter(it => it.kind !== 'event' && !it.hidden && (!isDone(it) || justChanged.has(it.id)) && (!it.due || Date.parse(it.due) > Date.now() - 7 * 864e5));
  // Only real, current classes: ones with work in the tracker or grades in the last 30 days.
  // (Canvas also lists things like placement tests and trainings.)
  const recent = Date.now() - 30 * 864e5;
  const active = new Set([
    ...data.items.filter(i => i.kind !== 'event' && i.course).map(i => i.course),
    ...g.subs.filter(x => x.score != null && Date.parse(x.gradedAt || 0) > recent).map(x => x.course),
  ]);
  const names = new Set([...open.map(i => i.course || 'Other'), ...g.courses.map(c => c.course).filter(c => active.has(c))]);
  const cards = [...names].filter(Boolean).sort().map(c => {
    const total = g.courses.find(x => x.course === c);
    const mine = open.filter(i => (i.course || 'Other') === c).sort((a, b) => (a.due ? Date.parse(a.due) : 9e15) - (b.due ? Date.parse(b.due) : 9e15));
    const graded = g.subs.filter(x => x.course === c && (x.score != null || x.missing)).slice(0, 5);
    const score = total && total.score != null ? `${fmtNum(Math.round(total.score * 10) / 10)}%` : '';
    return `<div class="ccard">
      <div class="chead">
        <span class="chip big" style="--c:${courseColor(c)}">${esc(c)}</span>
        <span class="ctotal">${score ? `<b>${esc(score)}</b>` : ''}${total && total.grade ? `<span class="letter">${esc(total.grade)}</span>` : ''}</span>
      </div>
      ${mine.length ? `<div class="csub">Open · ${mine.length}</div><div class="list flat">${mine.slice(0, 4).map(i => itemRow(i, { showDay: true })).join('')}</div>` : ''}
      ${graded.length ? `<div class="csub">Recent grades</div><div class="glist">${graded.map(x => gradeLine(x, seen)).join('')}</div>` : ''}
      ${!mine.length && !graded.length ? '<p class="cempty">Nothing open.</p>' : ''}
    </div>`;
  }).join('');
  const note = data.grades
    ? `<p class="fine">Grades from your last Canvas sync, ${esc(relTime(data.grades.updated))}. Tap Sync HW on Canvas to update them.</p>`
    : `<div class="card"><h3>See your grades here</h3><p>Grades come from the Sync HW bookmark, since the calendar feed doesn't include them. Set it up in Settings, then tap it on Canvas.</p></div>`;
  view.innerHTML = note + (cards || emptyState());
  // Mark grades as seen once they've been on screen for a moment.
  if (data.grades) setTimeout(() => {
    if (tab !== 'courses') return;
    try { localStorage.setItem('hw_grades_seen', new Date().toISOString()); } catch {}
    updateTabDots();
  }, 2500);
}

// How the last two weeks actually went: a streak, how much landed before the
// deadline, and where the work came from.
function doneStats(done) {
  const withTime = done.filter(it => it.doneAt);
  const onTime = withTime.filter(it => it.due && Date.parse(it.doneAt) <= Date.parse(it.due)).length;
  const rated = withTime.filter(it => it.due).length;
  const days = new Set(withTime.map(it => pDay(new Date(it.doneAt))));
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const k = pDay(new Date(Date.now() - i * 864e5));
    if (days.has(k)) streak++;
    else if (i > 0) break;           // today still counts as unfinished, not a broken streak
  }
  const week = done.filter(it => it.doneAt && Date.parse(it.doneAt) > Date.now() - 7 * 864e5).length;
  return `<div class="stats">
    <div class="stat"><b>${streak}</b><span>day streak</span></div>
    <div class="stat"><b>${week}</b><span>done this week</span></div>
    <div class="stat"><b>${rated ? Math.round((onTime / rated) * 100) + '%' : '—'}</b><span>on time</span></div>
  </div>`;
}

function renderDone() {
  const now = Date.now();
  const done = data.items.filter(it => it.kind !== 'event' && !it.hidden && (isDone(it) || justChanged.has(it.id)))
    .filter(it => !it.due || Date.parse(it.due) > now - 14 * 864e5);
  const shown = done.filter(matchesFilter);
  const early = shown.filter(it => it.due && Date.parse(it.due) >= now).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const past = shown.filter(it => it.due && Date.parse(it.due) < now).sort((a, b) => Date.parse(b.due) - Date.parse(a.due));
  const undated = shown.filter(it => !it.due);
  const groups = new Map();
  for (const it of past) {
    const k = workDay(it.due);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  let html = doneStats(done) + filterBar(false);
  html += section('Done ahead of time', early, { showDay: true, count: early.length });
  for (const [k, list] of groups) html += section('Due ' + dayLabel(k).replace(/^(Today|Tomorrow)$/, m => m.toLowerCase()), list, { count: list.length });
  html += section('No due date', undated, { count: undated.length });
  if (!done.length) html = `<div class="empty"><strong>Nothing checked off yet</strong>Things you check off, and work Canvas shows as submitted, collect here for two weeks.</div>`;
  view.innerHTML = html;
}

function updateTabDots() {
  const b = document.querySelector('.tabs [data-tab=courses]');
  if (b) b.classList.toggle('dot', newGradeCount() > 0);
}

function emptyState() {
  if (!data.state.lastFeed && !data.state.lastSync) {
    return `<div class="empty"><strong>Nothing loaded yet</strong>Tap refresh to pull your Canvas calendar feed, or run the Sync bookmark from Canvas (Settings has it).</div>`;
  }
  return `<div class="empty"><strong>All clear</strong>Nothing open right now.</div>`;
}

// The bookmark loads /sync.js from your tracker each time, so it picks up app
// updates without being copied again.
function bookmarklet() {
  const code = `(function(){var s=document.createElement('script');s.src=${JSON.stringify(location.origin + '/sync.js')}+'?t='+Date.now();s.dataset.k=${JSON.stringify(key)};s.onerror=function(){var d=document.createElement('div');d.textContent='HW Tracker: this Canvas site blocked the sync script. Use the "all-in-one" bookmark from Settings instead.';d.style.cssText='position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#c92a2a;color:#fff;padding:12px 16px;border-radius:12px;font:600 14px sans-serif;max-width:90vw';document.body.appendChild(d);setTimeout(function(){d.remove()},9000)};document.body.appendChild(s)})()`;
  return 'javascript:' + encodeURIComponent(code).replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%2F/g, '/');
}

// Fallback for Canvas sites whose security policy blocks outside scripts: the
// whole sync script inside the bookmark. It has to be copied again after updates.
async function bookmarkletInline() {
  const src = await fetch('/sync.js', { cache: 'no-store' }).then(r => r.text());
  const code = `window.__HWT={w:${JSON.stringify(location.origin)},k:${JSON.stringify(key)}};` + src;
  return 'javascript:' + encodeURIComponent(code);
}

const phoneLink = () => location.origin + '/login?k=' + encodeURIComponent(key);

function qrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function timezones() {
  try { return Intl.supportedValuesOf('timeZone'); }
  catch { return ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Asia/Kolkata']; }
}
const tzOptions = sel => timezones().map(z => `<option value="${esc(z)}" ${z === sel ? 'selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('');

function renderSettings() {
  const st = data.state || {};
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';

  let notif;
  if (isIOS && !standalone) {
    notif = `<p>On iPhone, notifications only work from the home screen app.</p>
      <ol><li>Tap the Share button in Safari.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Open HW from your home screen and come back here.</li></ol>`;
  } else if (!pushSupported) {
    notif = `<p>This browser doesn't support push notifications.</p>`;
  } else {
    notif = `<p>${perm === 'granted' ? `On. ${data.subscribers} device${data.subscribers === 1 ? '' : 's'} subscribed.` : perm === 'denied' ? 'Blocked. Turn them on in iOS Settings → Notifications → HW.' : 'Off.'}</p>
      <div class="row">
        <button class="primary" data-act="enablepush">${perm === 'granted' ? 'Re-subscribe this device' : 'Turn on notifications'}</button>
        <button class="ghost" data-act="testpush">Send test</button>
      </div>`;
  }

  const cfg = data.config || {};
  const prefs = cfg.prefs || { remindHours: 3, digestHour: 20, notifyNew: true };
  const curTheme = document.documentElement.dataset.theme || 'default';
  const curMode = document.documentElement.dataset.mode || 'auto';
  const themeCard = `<div class="card">
      <h3>Theme</h3>
      <p>Pick a palette. It follows you to every device you sign in on.</p>
      <div class="themes">${THEMES.map(t => `<button type="button" class="swatch ${t.id === curTheme ? 'on' : ''}" data-act="theme" data-theme="${t.id}">
        <i style="background:linear-gradient(135deg, ${t.sw[0]} 50%, ${t.sw[1]} 50%)"></i><span>${esc(t.name)}</span></button>`).join('')}</div>
      <label>Light or dark</label>
      <div class="segbtns" style="margin-top:6px">${MODES.map(([m, l]) => `<button type="button" data-act="mode" data-mode="${m}" class="${m === curMode ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>`;
  view.innerHTML = themeCard + `
    ${standalone || isIOS ? '' : `<div class="card">
      <h3>Open it on your phone</h3>
      <p>Scan this with your iPhone camera to open your tracker already signed in. Then tap Share, then <b>Add to Home Screen</b>.</p>
      <div class="qr">${qrSvg(phoneLink())}</div>
      <p>This code and link sign anyone in to your tracker, so don't share them.</p>
      <div class="row"><button class="ghost" data-act="copylink">Copy sign-in link</button></div>
    </div>`}
    <div class="card"><h3>Notifications</h3>${notif}
      <label>Remind me before something's due
        <select id="prefRemind">${[[0, 'Off'], [1, '1 hour before'], [2, '2 hours before'], [3, '3 hours before'], [6, '6 hours before'], [12, '12 hours before'], [24, '1 day before']].map(([v, l]) => `<option value="${v}" ${v === prefs.remindHours ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Nightly "due by end of tomorrow" summary
        <select id="prefDigest"><option value="-1" ${prefs.digestHour < 0 ? 'selected' : ''}>Off</option>${[17, 18, 19, 20, 21, 22].map(h => `<option value="${h}" ${h === prefs.digestHour ? 'selected' : ''}>${h - 12} PM</option>`).join('')}</select></label>
      <label class="check-row"><input type="checkbox" id="prefNew" ${prefs.notifyNew ? 'checked' : ''}> Tell me when a new assignment is posted</label>
    </div>
    <div class="card"><h3>How days are grouped</h3>
      <p>Something due at 8am is really work for the night before. This moves early deadlines onto the previous day's list, and the row still shows the real due day and time.</p>
      <label>List work on the day before it's due when it's due
        <select id="prefPrev">${[[0, "Never (group by the due date)"], [12, 'Before noon'], [23, "Any time before 11pm"]].map(([v, l]) => `<option value="${v}" ${v === (Number.isInteger(prefs.showPrevHour) ? prefs.showPrevHour : 23) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="card">
      <h3>Sync bookmark</h3>
      <p>The calendar feed updates on its own every 30 minutes, but it doesn't include what you've submitted or your grades. Tap this bookmark while you're on Canvas to pull those in, plus readings from Modules.</p>
      <ol>
        <li>Tap <b>Copy bookmark</b> below.</li>
        <li>In Safari, bookmark any page (Share → Add Bookmark) and name it <b>Sync HW</b>.</li>
        <li>Open Bookmarks, tap Edit, open <b>Sync HW</b>, and replace its address with what you copied.</li>
        <li>On your school's Canvas site, open Bookmarks and tap <b>Sync HW</b>.</li>
      </ol>
      <p>You only set this up once. It stays current as the app updates.</p>
      <div class="row"><button class="primary" data-act="copybm">Copy bookmark</button></div>
      <details class="fine"><summary>Bookmark doesn't work on your school's Canvas?</summary>
        <p>Some schools block outside scripts. This all-in-one version works anyway, but you'll need to copy it again after big updates.</p>
        <div class="row"><button class="ghost" data-act="copybminline">Copy all-in-one bookmark</button></div>
      </details>
    </div>
    <div class="card">
      <h3>Canvas feed</h3>
      <p>${cfg.feedHost ? `Connected to <b>${esc(cfg.feedHost)}</b>.` : 'No feed connected.'} To switch accounts or fix a broken feed, paste a new Calendar Feed link.</p>
      <input id="newFeed" type="url" inputmode="url" placeholder="https://…/feeds/calendars/user_….ics" autocapitalize="off" autocorrect="off" spellcheck="false">
      <label>Time zone for due dates and the 8pm digest
        <select id="tzSel">${tzOptions(cfg.tz || TZ)}</select></label>
      <div class="row"><button class="primary" data-act="savecfg">Save</button></div>
    </div>
    <div class="card">
      <h3>Status</h3>
      ${st.feedError ? `<p style="color:var(--danger)">Last feed refresh failed: ${esc(st.feedError)}</p>` : ''}
      <dl class="kv">
        <dt>Calendar feed</dt><dd>${esc(relTime(st.lastFeed))}</dd>
        <dt>Last Canvas sync</dt><dd>${esc(relTime(st.lastSync))}</dd>
        <dt>Items tracked</dt><dd>${data.items.filter(i => i.kind !== 'event').length}</dd>
        <dt>Grades updated</dt><dd>${esc(relTime(data.grades?.updated))}</dd>
        <dt>Version</dt><dd>${esc(data.version || '')}</dd>
      </dl>
      <div class="row">
        <button class="ghost" data-act="refreshfeed">Refresh feed now</button>
        <button class="ghost" data-act="logout">Sign out</button>
      </div>
    </div>
    <div class="card">
      <h3>Getting around faster</h3>
      <p>Swipe a row right to check it off, left to open it. Tap any row to set how long it will take, leave a note, star it, or push it to another day.</p>
      <p>On a keyboard: <kbd>1</kbd>–<kbd>5</kbd> switch tabs, <kbd>/</kbd> searches, <kbd>w</kbd> toggles week view, <kbd>n</kbd> adds a task, <kbd>r</kbd> refreshes.</p>
    </div>`;
}

function render() {
  $('#title').textContent = { upcoming: 'Upcoming', prep: 'Prep & readings', courses: 'Courses', done: 'Done', settings: 'Settings' }[tab];
  const st = data.state || {};
  const open = data.items.filter(i => !isDone(i) && !i.hidden && i.kind !== 'event' && (!i.due || Date.parse(i.due) > Date.now())).length;
  $('#status').textContent = `${open} open · synced ${relTime(st.lastSync || st.lastFeed)}`;
  $('#addBtn').hidden = tab === 'settings';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ({ upcoming: renderUpcoming, prep: renderPrep, courses: renderCourses, done: renderDone, settings: renderSettings })[tab]();
  updateTabDots();
  $('#courseList').innerHTML = [...new Set(data.items.map(i => i.course).filter(Boolean))].sort().map(c => `<option value="${esc(c)}">`).join('');
}

// ---------------- item sheet ----------------

const EST_CHOICES = [15, 30, 45, 60, 90, 120, 180];
let sheetDraft = { est: null, note: '', star: false, snooze: null };

function snoozeChoices() {
  const mk = (label, d) => ({ label, iso: d ? d.toISOString() : null });
  const t = new Date(); t.setHours(9, 0, 0, 0);
  const day = n => { const x = new Date(t); x.setDate(x.getDate() + n); return x; };
  return [mk('Keep here', null), mk('Tomorrow', day(1)), mk('In 2 days', day(2)), mk('Next week', day(7))];
}

function paintSheet(it) {
  if (!it || !$('#sheetTitle')) return;
  $('#sheetTitle').textContent = it.title;
  const bits = [it.course, it.due ? `${dayLabel(pDay(new Date(it.due)))} ${timeStr(it.due)}` : 'No due date'].filter(Boolean);
  $('#sheetSub').textContent = bits.join(' · ');
  $('#estRow').innerHTML = [['None', null], ...EST_CHOICES.map(m => [fmtMins(m), m])]
    .map(([l, v]) => `<button type="button" data-est="${v ?? ''}" class="${sheetDraft.est === v ? 'on' : ''}">${esc(l)}</button>`).join('');
  $('#snoozeRow').innerHTML = snoozeChoices()
    .map(c => `<button type="button" data-snooze="${esc(c.iso || '')}" class="${(sheetDraft.snooze || '') === (c.iso || '') ? 'on' : ''}">${esc(c.label)}</button>`).join('');
  $('#sheetStar').textContent = sheetDraft.star ? '★ Starred' : '☆ Star it';
  $('#sheetDone').textContent = isDone(it) ? 'Put back on the list' : 'Mark done';
}

function openSheet(id) {
  const it = data.items.find(i => i.id === id);
  const dlg = $('#sheet');
  if (!it || !dlg || typeof dlg.showModal !== 'function') return;
  sheetId = id;
  sheetDraft = {
    est: estOf(it),
    note: it.note || '',
    star: !!it.star,
    // Only keep a snooze the picker can show; anything else reads as "No".
    snooze: snoozeChoices().some(c => c.iso === it.snooze) ? it.snooze : (it.snooze ? it.snooze : null),
  };
  $('#sheetNote').value = sheetDraft.note;
  paintSheet(it);
  dlg.showModal();
}

function wireSheet() {
  const dlg = $('#sheet');
  if (!dlg || !$('#estRow') || !$('#snoozeRow') || !$('#sheetForm')) return;   // older shell still cached
  const cur = () => data.items.find(i => i.id === sheetId);
  $('#estRow').addEventListener('click', e => {
    const b = e.target.closest('[data-est]'); if (!b) return;
    sheetDraft.est = b.dataset.est ? Number(b.dataset.est) : null;
    paintSheet(cur());
  });
  $('#snoozeRow').addEventListener('click', e => {
    const b = e.target.closest('[data-snooze]'); if (!b) return;
    sheetDraft.snooze = b.dataset.snooze || null;
    paintSheet(cur());
  });
  $('#sheetStar').addEventListener('click', () => { sheetDraft.star = !sheetDraft.star; paintSheet(cur()); });
  $('#sheetDone').addEventListener('click', async () => {
    const it = cur(); if (!it) return;
    dlg.close();
    await setDone(it, !isDone(it)).catch(err => toast(err.message));
  });
  $('#sheetClose').addEventListener('click', () => dlg.close());
  $('#sheetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const it = cur(); if (!it) return;
    const body = { est: sheetDraft.est, note: $('#sheetNote').value, star: sheetDraft.star, snooze: sheetDraft.snooze };
    dlg.close();
    Object.assign(it, { est: body.est, note: body.note || null, star: body.star, snooze: body.snooze });
    render();
    try {
      await api('/api/items/' + encodeURIComponent(it.id), { method: 'PATCH', body: JSON.stringify(body) });
      toast('Saved');
    } catch (err) { toast(err.message); load().catch(() => {}); }
  });
}
wireSheet();

// ---------------- actions ----------------

view.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.item');
  const id = row?.dataset.id;
  const it = id && data.items.find(i => i.id === id);
  const act = btn.dataset.act;
  try {
    if (act === 'open') {
      if (e.target.closest('a')) return;            // let a Canvas link open normally
      openSheet(btn.dataset.id || id);
    } else if (act === 'course') {
      courseFilter = btn.dataset.course || '';
      render();
    } else if (act === 'view') {
      upcomingView = btn.dataset.view;
      try { localStorage.setItem('hw_view', upcomingView); } catch {}
      render();
    } else if (act === 'jump') {
      if (upcomingView !== 'list') { upcomingView = 'list'; render(); }
      const el = document.getElementById('day-' + btn.dataset.day);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else toast('Nothing due that day');
    } else if (act === 'toggle' && it) {
      await setDone(it, !isDone(it));
    } else if (act === 'hide' && it) {
      const manual = (it.src || []).includes('manual');
      data.items = data.items.filter(i => i.id !== id);
      lastHidden = it;
      render();
      await api('/api/items/' + encodeURIComponent(id), { method: 'DELETE' });
      toast(manual ? 'Deleted' : 'Hidden', manual ? null : { label: 'Undo', fn: async () => {
        await api('/api/items/' + encodeURIComponent(lastHidden.id), { method: 'PATCH', body: JSON.stringify({ hidden: false }) });
        await load();
      } });
    } else if (act === 'enablepush') {
      await enablePush();
    } else if (act === 'testpush') {
      const r = await api('/api/test-push', { method: 'POST' });
      toast(r.ok ? 'Test sent' : 'Push service rejected it');
    } else if (act === 'copybm') {
      await navigator.clipboard.writeText(bookmarklet());
      toast('Copied');
    } else if (act === 'copybminline') {
      await navigator.clipboard.writeText(await bookmarkletInline());
      toast('Copied');
    } else if (act === 'copylink') {
      await navigator.clipboard.writeText(phoneLink());
      toast('Copied. Only send it to yourself.');
    } else if (act === 'savecfg') {
      const body = { tz: $('#tzSel').value };
      const feed = $('#newFeed').value.trim();
      if (feed) body.icsUrl = feed;
      btn.disabled = true;
      try {
        const r = await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
        await load();
        toast(`Saved. ${r.count} items in your feed.`);
      } finally { btn.disabled = false; }
    } else if (act === 'theme' || act === 'mode') {
      const theme = act === 'theme' ? btn.dataset.theme : (document.documentElement.dataset.theme || 'default');
      const mode = act === 'mode' ? btn.dataset.mode : (document.documentElement.dataset.mode || 'auto');
      applyTheme(theme, mode);
      render();
      savePrefs({ theme, mode }).catch(() => {});
    } else if (act === 'refreshfeed') {
      await refresh();
    } else if (act === 'logout') {
      logout();
    }
  } catch (err) {
    toast(err.message);
    load().catch(() => {});
  }
});

async function setDone(it, done, quiet) {
  const prev = { done: it.done, override: it.override, doneAt: it.doneAt };
  it.done = done;
  it.doneAt = done ? new Date().toISOString() : null;
  if (done) { try { navigator.vibrate?.(8); } catch {} }
  if (done) delete it.override; else if (it.submitted) it.override = 'open';
  justChanged.add(it.id);
  render();
  setBadge(countBadge());
  try {
    await api('/api/items/' + encodeURIComponent(it.id), { method: 'PATCH', body: JSON.stringify({ done }) });
  } catch (e) {
    Object.assign(it, prev); if (!prev.override) delete it.override;
    render();
    throw e;
  }
  if (!quiet) toast(done ? 'Marked done' : 'Back on your list', { label: 'Undo', fn: () => setDone(it, !done, true).catch(err => toast(err.message)) });
}

function countBadge() {
  const now = Date.now();
  const today = pDay(new Date());
  return data.items.filter(i => i.kind !== 'event' && !i.hidden && !isDone(i) && i.due &&
    workDay(i.due) <= today && Date.parse(i.due) > now - 7 * 864e5).length;
}

// Typing filters as you go; the box keeps focus across the re-render.
let qTimer;
view.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  query = e.target.value;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    render();
    const el = $('#q');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 110);
});

async function savePrefs(patch) {
  const prefs = { ...(data.config?.prefs || {}), ...patch };
  const r = await api('/api/config', { method: 'POST', body: JSON.stringify({ prefs }) });
  data.config = { ...(data.config || {}), prefs: r.config.prefs };
  return r.config.prefs;
}

// Reminder settings save as soon as they change.
view.addEventListener('change', async e => {
  if (!['prefRemind', 'prefDigest', 'prefNew', 'prefPrev'].includes(e.target.id)) return;
  try {
    await savePrefs({
      remindHours: Number($('#prefRemind').value),
      digestHour: Number($('#prefDigest').value),
      notifyNew: $('#prefNew').checked,
      showPrevHour: Number($('#prefPrev').value),
    });
    render();
    toast('Saved');
  } catch (err) { toast(err.message); }
});

async function refresh() {
  const b = $('#refreshBtn');
  b.classList.add('spin');
  try {
    const r = await api('/api/refresh', { method: 'POST' });
    await load();
    toast(r.skipped ? 'No calendar feed set on the server' : `Feed refreshed (${r.count} items)`);
  } catch (e) { toast(e.message); }
  finally { b.classList.remove('spin'); }
}

function urlB64ToUint8(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications not allowed'); render(); return; }
  const reg = await navigator.serviceWorker.ready;
  const { key: vapid } = await fetch('/api/vapid').then(r => r.json());
  if (!vapid) { toast('Server has no push keys set'); return; }
  let sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(vapid) });
  const r = await api('/api/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
  data.subscribers = r.subscribers;
  toast('Notifications on');
  render();
}

// ---------------- swipe ----------------
// Right across a row checks it off, left opens it. Only after the drag is clearly
// sideways, so the list still scrolls normally.
(function swipes() {
  let el = null, x0 = 0, y0 = 0, dx = 0, locked = null;
  const THRESHOLD = 72;
  view.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const row = e.target.closest('.item.swipe');
    if (!row || e.target.closest('button, a')) return;
    el = row; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; locked = null;
  }, { passive: true });
  view.addEventListener('touchmove', e => {
    if (!el) return;
    const t = e.touches[0];
    const ax = t.clientX - x0, ay = t.clientY - y0;
    if (locked === null) {
      if (Math.abs(ax) < 10 && Math.abs(ay) < 10) return;
      locked = Math.abs(ax) > Math.abs(ay) * 1.4 ? 'x' : 'y';
      if (locked === 'x') el.classList.add('sliding');
    }
    if (locked !== 'x') return;
    dx = Math.max(-120, Math.min(120, ax));
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(1 - Math.min(Math.abs(dx) / 260, 0.45));
  }, { passive: true });
  const end = () => {
    if (!el) return;
    const row = el, moved = dx;
    row.classList.remove('sliding');
    row.style.transform = '';
    row.style.opacity = '';
    el = null; dx = 0; locked = null;
    if (Math.abs(moved) < THRESHOLD) return;
    const it = data.items.find(i => i.id === row.dataset.id);
    if (!it) return;
    if (moved > 0) setDone(it, !isDone(it)).catch(err => toast(err.message));
    else openSheet(it.id);
  };
  view.addEventListener('touchend', end, { passive: true });
  view.addEventListener('touchcancel', end, { passive: true });
})();

// ---------------- keyboard ----------------
const TAB_KEYS = { 1: 'upcoming', 2: 'prep', 3: 'courses', 4: 'done', 5: 'settings' };
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (e.key === 'Escape' && typing && t.id === 'q') { query = ''; render(); return; }
  if (typing) return;
  if (document.querySelector('dialog[open]')) return;
  if (TAB_KEYS[e.key]) { tab = TAB_KEYS[e.key]; render(); window.scrollTo({ top: 0 }); return; }
  if (e.key === '/') { e.preventDefault(); const q = $('#q'); if (q) q.focus(); return; }
  if (e.key === 'r') { refresh(); return; }
  if (e.key === 'n') { e.preventDefault(); $('#addForm').reset(); $('#addDialog').showModal(); return; }
  if (e.key === 'w' && tab === 'upcoming') {
    upcomingView = upcomingView === 'week' ? 'list' : 'week';
    try { localStorage.setItem('hw_view', upcomingView); } catch {}
    render();
  }
});

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  render();
  window.scrollTo({ top: 0 });
}));
$('#refreshBtn').addEventListener('click', refresh);

const dlg = $('#addDialog');
$('#addBtn').addEventListener('click', () => { $('#addForm').reset(); dlg.showModal(); });
$('#addCancel').addEventListener('click', () => dlg.close());
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const due = f.get('due') ? new Date(f.get('due')).toISOString() : null;
  dlg.close();
  try {
    await api('/api/items', { method: 'POST', body: JSON.stringify({ title: f.get('title'), course: f.get('course'), due, kind: f.get('kind') }) });
    await load();
    toast('Added');
  } catch (err) { toast(err.message); }
});

// ---------------- login ----------------

function forget() {
  try { localStorage.removeItem('hw_key'); } catch {}
  key = '';
}

async function logout() {
  forget();
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  showLogin();
}

function showLogin(error = '') {
  document.body.innerHTML = `<div id="app"><form class="login" id="login" action="/" method="post">
    <h1>HW Tracker</h1>
    <p style="color:var(--muted)">Enter your app key once. This device stays signed in after that.</p>
    <input type="text" name="username" value="HW Tracker" autocomplete="username" style="position:absolute;opacity:0;height:0;width:0;pointer-events:none" tabindex="-1" aria-hidden="true">
    <label>App key<input name="k" autocomplete="current-password" type="password" autocapitalize="off" autocorrect="off" spellcheck="false" required></label>
    <p id="loginErr" style="color:var(--danger);font-size:14px;min-height:1em;margin:8px 0 0">${esc(error)}</p>
    <div style="margin-top:10px;display:grid;gap:8px">
      <button class="primary" style="width:100%">Sign in</button>
      <button type="button" class="ghost" id="pasteKey" style="width:100%">Paste key</button>
    </div>
  </form></div>`;
  const form = document.getElementById('login');
  const submit = async k => {
    const res = await fetch('/api/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { document.getElementById('loginErr').textContent = body.error || 'Sign in failed'; return; }
    try { localStorage.setItem('hw_key', body.key); } catch {}
    location.replace('/');
  };
  form.addEventListener('submit', e => { e.preventDefault(); submit(new FormData(form).get('k').trim()); });
  document.getElementById('pasteKey').addEventListener('click', async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      form.k.value = t;
      submit(t);
    } catch { document.getElementById('loginErr').textContent = 'Could not read the clipboard. Long-press the box and tap Paste.'; }
  });
}

// ---------------- first-run setup ----------------

function showSetup(error = '') {
  document.body.innerHTML = `<div id="app"><form class="login setup" id="setup">
    <h1>Set up HW Tracker</h1>
    <p style="color:var(--muted)">Connect your Canvas calendar. This takes about a minute.</p>
    <div class="card" style="margin-top:16px">
      <h3>1. Copy your Canvas feed link</h3>
      <ol>
        <li>On a computer, open your school's Canvas and click <b>Calendar</b> in the left menu.</li>
        <li>At the bottom right, click <b>Calendar Feed</b>.</li>
        <li>Copy the link that appears. It ends in <code>.ics</code>.</li>
      </ol>
    </div>
    <div class="card">
      <h3>2. Paste it here</h3>
      <input name="icsUrl" type="url" inputmode="url" required placeholder="https://…/feeds/calendars/user_….ics" autocapitalize="off" autocorrect="off" spellcheck="false">
      <label>Your time zone<select name="tz">${tzOptions(TZ)}</select></label>
      <p id="setupErr" style="color:var(--danger);font-size:14px;min-height:1em;margin:10px 0 0">${esc(error)}</p>
      <button class="primary" style="width:100%;margin-top:8px">Connect Canvas</button>
    </div>
    <p style="color:var(--muted);font-size:13px">Your feed link stays in your own Cloudflare account. Whoever finishes this step owns this tracker, so finish it right after deploying.</p>
  </form></div>`;
  const form = $('#setup');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Checking your feed…';
    try {
      const res = await fetch('/api/setup', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icsUrl: form.icsUrl.value, tz: form.tz.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Setup failed');
      key = body.key;
      try { localStorage.setItem('hw_key', key); } catch {}
      showSetupDone(body.count);
    } catch (err) {
      $('#setupErr').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Connect Canvas';
    }
  });
}

function showSetupDone(count) {
  document.body.innerHTML = `<div id="app"><div class="login setup">
    <h1>You're connected</h1>
    <p style="color:var(--muted)">Found ${count} items in your Canvas calendar.</p>
    <div class="card" style="margin-top:16px">
      <h3>Put it on your phone</h3>
      <p>Scan this with your iPhone camera. It opens your tracker already signed in. Then tap Share, then <b>Add to Home Screen</b>, open it from your home screen, and turn on notifications in Settings.</p>
      <div class="qr">${qrSvg(phoneLink())}</div>
      <div class="row"><button class="ghost" id="copyLink">Copy sign-in link</button></div>
    </div>
    <div class="card">
      <h3>Save your app key</h3>
      <p>You'll only need it if a device ever signs out. Keep it in your password manager.</p>
      <code class="block">${esc(key)}</code>
      <div class="row"><button class="ghost" id="copyKey">Copy key</button></div>
    </div>
    <button class="primary" style="width:100%;margin-top:14px" id="go">Open my tracker</button>
  </div></div>`;
  $('#copyLink').onclick = async () => { await navigator.clipboard.writeText(phoneLink()); $('#copyLink').textContent = 'Copied'; };
  $('#copyKey').onclick = async () => { await navigator.clipboard.writeText(key); $('#copyKey').textContent = 'Copied'; };
  $('#go').onclick = () => location.replace('/');
}

// ---------------- boot ----------------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

(async () => {
  if (location.hash === '#badkey') {
    history.replaceState(null, '', '/');
    showLogin('That sign-in link has the wrong key.');
    return;
  }
  try {
    const st = await fetch('/api/status').then(r => r.json());
    if (!st.configured) { showSetup(); return; }
  } catch {}
  if (!key) {
    // No saved key: the login cookie may still be there (or come from the sign-in link).
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin' });
      if (r.ok) { key = (await r.json()).key || ''; try { localStorage.setItem('hw_key', key); } catch {} }
    } catch {}
  }
  if (!key) { showLogin(); return; }
  load().catch(e => { fatal(e.message); throw e; }).then(() => {
    // After an automatic update, say what changed (once).
    let last = null;
    try { last = localStorage.getItem('hw_version'); localStorage.setItem('hw_version', data.version || ''); } catch {}
    if (last && data.version && last !== data.version && WHATS_NEW[data.version]) toast(WHATS_NEW[data.version]);
  }).catch(e => toast(e.message));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && key) load().catch(() => {}); });
})();
