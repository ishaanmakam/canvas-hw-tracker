import assert from 'node:assert';
import { mergeItem, isDone, isOpen, normalizeGrades } from '../src/model.js';

// done / override
let a = mergeItem(undefined, { id: 'a:1', title: 'HW', due: '2026-10-10T06:59:00Z', submitted: true }, 'sync');
assert.equal(isDone(a), true);
a.override = 'open';
assert.equal(isDone(a), false); assert.equal(isOpen(a), true);
a = mergeItem(a, { id: 'a:1', title: 'HW', due: '2026-10-10T06:59:00Z' }, 'ics');      // feed refresh keeps your choice
assert.equal(isDone(a), false);
let b = mergeItem(undefined, { id: 'a:2', title: 'X', due: '2026-10-10T06:59:00Z', submitted: false }, 'sync');
b.override = 'open';
b = mergeItem(b, { id: 'a:2', title: 'X', due: '2026-10-10T06:59:00Z', submitted: true }, 'sync'); // new submission
assert.equal(isDone(b), true); assert.equal(b.override, undefined);
// old stored items (v1.0) without override still work
assert.equal(isDone({ id: 'a:3', done: true }), true);
assert.equal(isOpen({ id: 'a:4', done: false, submitted: false, kind: 'assignment' }), true);

// grades
const g = normalizeGrades(
  [{ id: 1, name: 'CHEM 142 A&B Au 26: General Chemistry I', score: 91.25, grade: 'A-' }, { id: 2, name: 'Math Guided Self Placement 26-27', score: null, grade: null }],
  [{ aid: 11783855, courseId: 1, name: 'RQ L1.1', score: 9, possible: 10, grade: '9', gradedAt: '2026-10-05T10:00:00Z', url: '/courses/1/assignments/11783855' },
   { aid: 5, courseId: 1, name: 'Old', score: 4, possible: 5, gradedAt: '2026-10-01T10:00:00Z' },
   { aid: 6, courseId: 1, name: 'Missed', score: null, possible: 10, missing: true }],
  'https://canvas.uw.edu');
assert.equal(g.courses.length, 1);
assert.equal(g.courses[0].course, 'CHEM 142');
assert.equal(g.subs[0].id, 'a:11783855');
assert.equal(g.subs[0].url, 'https://canvas.uw.edu/courses/1/assignments/11783855');
assert.equal(g.subs[1].name, 'Old');
assert.equal(g.subs[2].missing, true);
console.log('v1.1 tests passed');
