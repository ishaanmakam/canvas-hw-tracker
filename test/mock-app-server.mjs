// A stand-in for the worker so the page can be driven in a real browser.
// Serves public/ and answers the handful of API calls the app makes at boot.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const DAY = 864e5;
const iso = (dayOffset, h, mi = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, mi, 0, 0);
  return d.toISOString();
};

const items = [
  { id: 'a:1', title: 'Lesson 8 [PREP] — numerical integration', course: 'AMATH 301', kind: 'prep', due: iso(1, 8, 0), url: 'https://canvas.uw.edu/1', src: ['ics'], est: 30 },
  { id: 'a:2', title: 'Problem Set 4', course: 'AMATH 301', kind: 'assignment', due: iso(0, 23, 59), src: ['ics'], star: true, est: 120, note: 'start with Q3' },
  { id: 'a:3', title: 'Post-lab writeup', course: 'CHEM 142 Lab', kind: 'assignment', due: iso(2, 17, 0), src: ['ics'] },
  { id: 'a:4', title: 'Midterm 1', course: 'CHEM 142', kind: 'exam', due: iso(5, 13, 30), src: ['ics'] },
  { id: 'a:5', title: 'Reading quiz 6', course: 'PHIL 120', kind: 'prep', due: iso(3, 23, 59), src: ['ics'] },
  { id: 'a:6', title: 'Overdue discussion post', course: 'GEN ST 199', kind: 'assignment', due: iso(-2, 23, 59), src: ['ics'] },
  { id: 'a:7', title: 'Submitted already', course: 'CHEM 142', kind: 'assignment', due: iso(-1, 23, 59), src: ['sync'], submitted: true, doneAt: iso(-1, 20, 0) },
  { id: 'a:8', title: 'Checked off yesterday', course: 'AMATH 301', kind: 'assignment', due: iso(-1, 23, 59), src: ['ics'], done: true, doneAt: iso(-1, 21, 0) },
  { id: 'a:9', title: 'Snoozed thing', course: 'PHIL 120', kind: 'assignment', due: iso(1, 23, 59), src: ['ics'], snooze: iso(4, 9, 0) },
  { id: 'm:1', title: 'Read Ch. 7 before lecture', course: 'CHEM 142', kind: 'reading', due: null, src: ['sync'], module: 'Week 6' },
  { id: 'e:1', title: 'AMATH 301 class', course: 'AMATH 301', kind: 'event', due: iso(0, 10, 30), src: ['ics'] },
  { id: 'a:10', title: 'Big project milestone', course: 'ENGR 101', kind: 'assignment', due: iso(8, 23, 59), src: ['ics'], est: 180 },
  { id: 'a:11', title: 'Second thing next week', course: 'ENGR 101', kind: 'assignment', due: iso(8, 12, 0), src: ['ics'], est: 90 },
  { id: 'a:12', title: 'Item with a broken due date', course: 'ENGR 101', kind: 'assignment', due: 'not-a-date', src: ['ics'] },
].map(i => ({ done: false, hidden: false, notified: {}, ...i }));

const grades = {
  updated: iso(0, 9),
  courses: [{ id: 1, name: 'CHEM 142', course: 'CHEM 142', score: 91.25, grade: 'A-' }],
  subs: [{ id: 'a:7', course: 'CHEM 142', name: 'Lab 3', score: 18, possible: 20, gradedAt: iso(-1, 12), url: null, missing: false }],
};

let prefs = { remindHours: 3, digestHour: 20, notifyNew: true, showPrevHour: 23, theme: 'default', mode: 'auto' };

const body = req => new Promise(res => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); });
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

export function start(port = 8787) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/api/status') return send(res, 200, { configured: true, version: '1.3.0' });
    if (p === '/api/session') return send(res, 200, { ok: true, key: 'test-key' });
    if (p === '/api/vapid') return send(res, 200, { key: null });
    if (p === '/api/items' && req.method === 'GET') {
      return send(res, 200, {
        items, state: { lastFeed: iso(0, 8), lastSync: iso(0, 8) }, subscribers: 0, version: '1.3.0',
        grades, badge: 2, config: { tz: 'America/Los_Angeles', feedHost: 'canvas.uw.edu', prefs },
      });
    }
    if (p === '/api/config' && req.method === 'POST') {
      const b = await body(req);
      if (b.prefs) prefs = { ...prefs, ...b.prefs };
      return send(res, 200, { ok: true, config: { tz: 'America/Los_Angeles', prefs } });
    }
    if (p.startsWith('/api/items/')) {
      const id = decodeURIComponent(p.slice('/api/items/'.length));
      const it = items.find(x => x.id === id);
      if (!it) return send(res, 404, { error: 'not found' });
      if (req.method === 'PATCH') {
        const b = await body(req);
        Object.assign(it, b);
        if (typeof b.done === 'boolean') it.doneAt = b.done ? new Date().toISOString() : null;
        return send(res, 200, { item: it });
      }
      if (req.method === 'DELETE') { it.hidden = true; return send(res, 200, { ok: true }); }
    }
    if (p.startsWith('/api/')) return send(res, 200, { ok: true });

    const file = path.join(PUBLIC, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) start().then(() => console.log('mock app on http://localhost:8787'));
