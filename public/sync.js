// HW Tracker sync. Runs on your Canvas page (from the Sync HW bookmark) using
// your own Canvas login, and sends what's due, what's submitted, module
// readings and grades to your tracker. Nothing else leaves the page.
(async () => {
  const me = document.currentScript;
  const cfg = window.__HWT || {};
  const W = cfg.w || (me && me.src ? new URL(me.src).origin : '');
  const K = cfg.k || (me && me.dataset.k) || '';

  const T = (m, done) => {
    let d = document.getElementById('hwt');
    if (!d) {
      d = document.createElement('div');
      d.id = 'hwt';
      d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#17181b;color:#fff;padding:12px 16px;border-radius:12px;font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,.3)';
      document.body.appendChild(d);
    }
    d.textContent = m;
    clearTimeout(T.t);
    if (done) T.t = setTimeout(() => d.remove(), 7000);
  };

  if (!W || !K) { T('This bookmark is incomplete. Copy it again from HW Tracker → Settings.', true); return; }
  if (typeof ENV === 'undefined' || location.origin === W) { T('Open your Canvas site first, then tap this bookmark.', true); return; }

  // Every Canvas list endpoint is paginated; follow the Link headers.
  const get = async url => {
    let out = [], next = url;
    while (next) {
      const r = await fetch(next, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('Canvas ' + r.status);
      out = out.concat(await r.json());
      const m = (r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
      next = m ? m[1] : null;
    }
    return out;
  };

  T('Syncing with HW Tracker…');
  try {
    const start = new Date(Date.now() - 14 * 864e5).toISOString();
    const end = new Date(Date.now() + 42 * 864e5).toISOString();
    const [planner, rawCourses] = await Promise.all([
      get('/api/v1/planner/items?per_page=100&start_date=' + start + '&end_date=' + end),
      get('/api/v1/courses?enrollment_state=active&include[]=total_scores&per_page=50'),
    ]);

    const courses = rawCourses.filter(c => c && c.id && c.name).map(c => {
      const e = (c.enrollments || []).find(x => /student/i.test(x.type || x.role || '')) || {};
      return { id: c.id, name: c.name, score: e.computed_current_score ?? null, grade: e.computed_current_grade ?? null };
    });

    T('Syncing with HW Tracker… (grades and readings)');
    const modules = [], subs = [];
    await Promise.all(courses.map(async c => {
      try {
        const ms = await get('/api/v1/courses/' + c.id + '/modules?include[]=items&per_page=50');
        modules.push({
          courseId: c.id,
          mods: ms.filter(m => m.state !== 'completed' && m.state !== 'locked').map(m => ({
            name: m.name, state: m.state,
            items: (m.items || []).filter(i => ['Page', 'File', 'ExternalUrl', 'ExternalTool'].includes(i.type)).map(i => ({
              id: i.id, title: i.title, type: i.type, url: i.html_url,
              req: !!i.completion_requirement, done: !!(i.completion_requirement && i.completion_requirement.completed),
            })),
          })),
        });
      } catch (x) { /* some courses hide Modules */ }
      try {
        const ss = await get('/api/v1/courses/' + c.id + '/students/submissions?student_ids[]=self&include[]=assignment&per_page=100');
        for (const x of ss) {
          if (x.score == null && !x.missing && !x.excused) continue;
          const a = x.assignment || {};
          subs.push({
            aid: x.assignment_id, courseId: c.id, name: a.name, score: x.score, possible: a.points_possible,
            grade: x.grade, gradedAt: x.graded_at || x.posted_at || null,
            missing: x.missing, late: x.late, excused: x.excused, url: a.html_url,
          });
        }
      } catch (x) { /* grades hidden for this course */ }
    }));

    const r = await fetch(W + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + K },
      body: JSON.stringify({ origin: location.origin, planner, courses, modules, subs }),
    });
    const j = await r.json().catch(() => ({}));
    T(r.ok ? 'Synced. ' + j.summary : 'Sync failed: ' + (j.error || r.status), true);
  } catch (x) {
    T('Sync failed: ' + x.message, true);
  }
})();
