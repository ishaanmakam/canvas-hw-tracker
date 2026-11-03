import assert from 'node:assert';
import { workDayKey, prevDayKey, zonedToUtc, zonedParts, DEFAULT_PREV_HOUR } from '../src/model.js';
// src/index.js imports package.json the way Wrangler bundles it, so the badge rule
// is checked here through the same helper the worker uses.

const TZ = 'America/Los_Angeles';
const at = (y, mo, d, h, mi) => zonedToUtc(y, mo, d, h, mi, TZ).toISOString();

// 11:59pm stays on its own day; anything earlier moves to the night before
assert.equal(workDayKey(at(2026, 11, 10, 23, 59), TZ), '2026-11-10');
assert.equal(workDayKey(at(2026, 11, 10, 8, 0), TZ), '2026-11-09');
assert.equal(workDayKey(at(2026, 11, 10, 17, 0), TZ), '2026-11-09');
assert.equal(workDayKey(at(2026, 11, 10, 0, 30), TZ), '2026-11-09');

// cutoff choices
assert.equal(workDayKey(at(2026, 11, 10, 17, 0), TZ, 12), '2026-11-10'); // afternoon stays
assert.equal(workDayKey(at(2026, 11, 10, 8, 0), TZ, 12), '2026-11-09');  // morning moves
assert.equal(workDayKey(at(2026, 11, 10, 8, 0), TZ, 0), '2026-11-10');   // off

// month and year boundaries
assert.equal(prevDayKey('2026-11-01'), '2026-10-31');
assert.equal(prevDayKey('2027-01-01'), '2026-12-31');
assert.equal(prevDayKey('2028-03-01'), '2028-02-29');

// across the fall DST change (Nov 1 2026, 2am): still the calendar day before
assert.equal(workDayKey(at(2026, 11, 2, 8, 0), TZ), '2026-11-01');

// badge rule: an 8am-tomorrow deadline belongs to today's list, an 11:59pm one does not
const today = zonedParts(new Date(), TZ);
const t = zonedParts(new Date(Date.now() + 864e5), TZ);
const due8 = zonedToUtc(t.y, t.mo, t.d, 8, 0, TZ).toISOString();
const due2359 = zonedToUtc(t.y, t.mo, t.d, 23, 59, TZ).toISOString();
assert.ok(workDayKey(due8, TZ, DEFAULT_PREV_HOUR) <= today.key);
assert.ok(!(workDayKey(due2359, TZ, DEFAULT_PREV_HOUR) <= today.key));
assert.ok(!(workDayKey(due8, TZ, 0) <= today.key)); // with the shift off, neither counts

console.log('v1.2 tests passed');
