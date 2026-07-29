// Behavioural tests for the offline sync queue and its circuit breaker.
//
// Written BEFORE moving this code out of js/platform.js. It is the most
// intricate logic in the app — a mutation queue with per-key dedup, a size cap,
// a per-op retry budget, and a circuit breaker that resets the Supabase SDK
// after repeated trips — and nothing in the suite exercised any of it. A subtle
// break here would pass the lint gate, the 30-page render sweep and every other
// check, and surface as a customer's work silently failing to reach the server.
//
// These run against the real functions in a real browser via the verify
// harness. Everything is driven through the public entry points; the only stub
// is vxIsAuthenticated, because vxSyncEnqueue returns early when signed out and
// the harness has no session.
//
// Each test resets the queue, the dropped list and the breaker's module state
// first, so order does not matter and a failure leaves nothing behind.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { openApp } from './verify.mjs';

let reason = false;
try { if (!fs.existsSync(chromium.executablePath())) reason = 'Chromium not installed'; }
catch { reason = 'Chromium not installed'; }
const opts = reason ? { skip: reason } : {};

// One browser for the whole file rather than one per test. Opening 13 was slow
// enough to make the suite flaky when node --test ran it alongside the harness
// suite in parallel — two failures in one run, none in the next. Every test
// resets the queue, dropped list and breaker below, so sharing is safe and the
// tests stay order-independent.
let app;
before(async () => { if (!reason) app = await openApp({ section: 'overview' }); });
after(async () => { if (app) await app.close(); });

// Run a function in the page with a clean queue, clean dropped list, a closed
// breaker and vxIsAuthenticated() forced true.
const inApp = (fn) => app.page.evaluate(`(async () => {
  localStorage.removeItem(VX_SYNC_QUEUE_KEY);
  localStorage.removeItem(VX_SYNC_DROPPED_KEY);
  _vxBreakerRecentFails = 0;
  _vxBreakerOpenUntil = 0;
  _vxBreakerTripCount = 0;
  window.vxIsAuthenticated = () => true;
  return (${fn.toString()})();
})()`);

// ── Circuit breaker ─────────────────────────────────────────────────────────

test('breaker stays closed below the failure threshold', opts, async () => {
  const r = await inApp(() => {
    const states = [];
    for (let i = 0; i < VX_BREAKER_FAIL_THRESHOLD - 1; i++) {
      _vxBreakerRecordResult(false);
      states.push(vxBreakerIsOpen());
    }
    return { threshold: VX_BREAKER_FAIL_THRESHOLD, states };
  });
  assert.equal(r.states.length, r.threshold - 1);
  assert.deepEqual(r.states, r.states.map(() => false), 'breaker opened early');
});

test('breaker opens on the threshold-th consecutive failure', opts, async () => {
  const r = await inApp(() => {
    for (let i = 0; i < VX_BREAKER_FAIL_THRESHOLD; i++) _vxBreakerRecordResult(false);
    return { open: vxBreakerIsOpen(), cooldown: VX_BREAKER_COOLDOWN_MS };
  });
  assert.equal(r.open, true, 'breaker did not open at the threshold');
  assert.ok(r.cooldown > 0);
});

test('a success closes the breaker and clears the failure count', opts, async () => {
  const r = await inApp(() => {
    for (let i = 0; i < VX_BREAKER_FAIL_THRESHOLD; i++) _vxBreakerRecordResult(false);
    const openedFirst = vxBreakerIsOpen();
    _vxBreakerRecordResult(true);
    return { openedFirst, openAfterSuccess: vxBreakerIsOpen(), fails: _vxBreakerRecentFails, trips: _vxBreakerTripCount };
  });
  assert.equal(r.openedFirst, true);
  assert.equal(r.openAfterSuccess, false, 'a success must close the breaker');
  assert.equal(r.fails, 0);
  assert.equal(r.trips, 0);
});

test('failures reset between trips, so each burst counts cleanly', opts, async () => {
  // On tripping, _vxBreakerRecentFails resets to 0 — otherwise one extra
  // failure after a trip would immediately re-open it.
  const r = await inApp(() => {
    for (let i = 0; i < VX_BREAKER_FAIL_THRESHOLD; i++) _vxBreakerRecordResult(false);
    return { failsAfterTrip: _vxBreakerRecentFails, trips: _vxBreakerTripCount };
  });
  assert.equal(r.failsAfterTrip, 0, 'failure count was not reset on trip');
  assert.equal(r.trips, 1);
});

test('repeated trips reset the Supabase client', opts, async () => {
  // After VX_BREAKER_TRIPS_BEFORE_SDK_RESET trips the cached SDK singleton is
  // dropped so the next call rebuilds it — the recovery path for a wedged
  // client. Asserted via the trip counter returning to 0, which only happens
  // on that reset branch.
  const r = await inApp(() => {
    const need = VX_BREAKER_TRIPS_BEFORE_SDK_RESET;
    for (let t = 0; t < need; t++) {
      for (let i = 0; i < VX_BREAKER_FAIL_THRESHOLD; i++) _vxBreakerRecordResult(false);
    }
    return { tripsBefore: need, tripsAfter: _vxBreakerTripCount, clientNull: _vxSupabaseClient === null };
  });
  assert.equal(r.tripsAfter, 0, 'trip counter was not reset — the SDK reset branch did not run');
  assert.equal(r.clientNull, true, 'the cached Supabase client was not dropped');
});

// ── Queue: dedup, filtering, shape ──────────────────────────────────────────

test('a second put for the same key replaces the first instead of appending', opts, async () => {
  // The reason this exists: without it, a 30-second editing session leaves ~50
  // pending ops for one record.
  const r = await inApp(() => {
    vxSyncEnqueue({ kind: 'put', key: 'vx-defects-v1', value: 'first' });
    vxSyncEnqueue({ kind: 'put', key: 'vx-defects-v1', value: 'second' });
    const q = vxSyncList();
    return { length: q.length, value: q[0] && q[0].value, op: q[0] && q[0].op };
  });
  assert.equal(r.length, 1, 'dedup failed — the queue grew');
  assert.equal(r.value, 'second', 'dedup kept the stale value');
  assert.equal(r.op, 'put');
});

test('puts for different keys are kept separately', opts, async () => {
  const r = await inApp(() => {
    vxSyncEnqueue({ kind: 'put', key: 'vx-defects-v1', value: 'a' });
    vxSyncEnqueue({ kind: 'put', key: 'vx-jobs-v1', value: 'b' });
    return vxSyncList().map((o) => o.key).sort();
  });
  assert.deepEqual(r, ['vx-defects-v1', 'vx-jobs-v1']);
});

test('deletes are never deduped', opts, async () => {
  // Deliberate: a delete is not idempotent with a preceding delete of the same
  // key once the server has replayed the first.
  const r = await inApp(() => {
    vxSyncEnqueue({ kind: 'delete', key: 'vx-defects-v1', value: null });
    vxSyncEnqueue({ kind: 'delete', key: 'vx-defects-v1', value: null });
    return vxSyncList().length;
  });
  assert.equal(r, 2, 'deletes were collapsed');
});

test('keys outside the entity set are not queued', opts, async () => {
  const r = await inApp(() => {
    vxSyncEnqueue({ kind: 'put', key: 'vx-not-an-entity-key', value: 'x' });
    vxSyncEnqueue({ kind: 'put', key: 'vx-rptdraft-v1', value: 'x' });  // local-only
    return vxSyncList().length;
  });
  assert.equal(r, 0, 'a non-entity key reached the sync queue');
});

test('enqueued ops start pending and carry an id and timestamp', opts, async () => {
  const r = await inApp(() => {
    vxSyncEnqueue({ kind: 'put', key: 'vx-customers-v1', value: 'c' });
    const [op] = vxSyncList();
    return { status: op.status, hasId: typeof op.id === 'string' && op.id.startsWith('op-'), hasAt: !!op.at };
  });
  assert.equal(r.status, 'pending');
  assert.equal(r.hasId, true, 'op has no id — dedup and eviction rely on it');
  assert.equal(r.hasAt, true);
});

test('nothing is queued while signed out', opts, async () => {
  // The guard that protects a trial user's browser from accumulating ops that
  // can never be delivered. Overrides the shared stub to return false, then
  // restores it so later tests are unaffected.
  const n = await app.page.evaluate(() => {
    localStorage.removeItem(VX_SYNC_QUEUE_KEY);
    window.vxIsAuthenticated = () => false;
    vxSyncEnqueue({ kind: 'put', key: 'vx-defects-v1', value: 'x' });
    const queued = vxSyncList().length;
    window.vxIsAuthenticated = () => true;
    return queued;
  });
  assert.equal(n, 0, 'ops were queued for a signed-out user');
});

// ── Reporting surface ───────────────────────────────────────────────────────

test('vxSyncStats reflects the queue and the breaker', opts, async () => {
  const r = await inApp(() => {
    vxSyncEnqueue({ kind: 'put', key: 'vx-defects-v1', value: 'a' });
    vxSyncEnqueue({ kind: 'put', key: 'vx-jobs-v1', value: 'b' });
    const before = vxSyncStats();
    for (let i = 0; i < VX_BREAKER_FAIL_THRESHOLD; i++) _vxBreakerRecordResult(false);
    return { before, breakerOpenAfter: vxSyncStats().breakerOpen };
  });
  assert.equal(r.before.total, 2);
  assert.equal(r.before.pending, 2);
  assert.equal(r.before.failed, 0);
  assert.equal(r.before.delivered, 0);
  assert.equal(r.before.breakerOpen, false);
  assert.equal(r.breakerOpenAfter, true, 'stats did not surface the open breaker');
});

test('the dropped list can be read and cleared', opts, async () => {
  // Ops that exhaust VX_SYNC_OP_MAX_RETRIES land here — the user is in a bad
  // state and it must be visible rather than silently discarded.
  const r = await inApp(() => {
    localStorage.setItem(VX_SYNC_DROPPED_KEY, JSON.stringify([{ id: 'op-x', key: 'vx-defects-v1' }]));
    const listed = vxSyncDroppedList().length;
    vxSyncDroppedClear();
    return { listed, afterClear: vxSyncDroppedList().length, retryBudget: VX_SYNC_OP_MAX_RETRIES };
  });
  assert.equal(r.listed, 1);
  assert.equal(r.afterClear, 0, 'dropped list was not cleared');
  assert.ok(r.retryBudget > 0);
});
