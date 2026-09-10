'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nightWindow, status, runPass, parseCandidate, setPaused } = require('../index.cjs');

test('night window uses local timezone and handles a daylight-saving season', () => {
  const at = Date.parse('2026-01-15T03:00:00Z'); // 22:00 EST
  const window = nightWindow(at, 'America/New_York');
  assert.equal(window.eligible, true);
  assert.equal(window.local.hour, 22);
  assert.equal(window.nightDate, '2026-01-14');
  assert.ok(window.endsAt > at);
});

test('status stops outside the window, when paused, gaming, or over pass budget', () => {
  const at = Date.parse('2026-01-15T16:00:00Z'); // 11:00 EST
  assert.deepEqual(status({ now: at }).reasons, ['outside-night-window']);
  const gated = status({ now: Date.parse('2026-01-15T03:00:00Z'), isPaused: true, isGaming: true, state: { nights: { '2026-01-14': { attempts: 6 } } } });
  assert.deepEqual(gated.reasons, ['paused', 'gaming-active', 'night-pass-budget-exhausted']);
});

test('one pass is bounded, writes only caller-owned state, and leaves candidates unverified', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-night-test-'));
  const at = Date.parse('2026-01-15T03:00:00Z');
  const result = await runPass({ stateDir: root, now: at, maxWorkerMs: 2000, isPaused: false, isGaming: false, worker: async ({ maxSources }) => ({ ok: true, text: JSON.stringify({ summary: 'small finding', sources: [{ url: 'https://example.com/source', title: 'Example', claim: 'testable claim' }, { url: 'ftp://example.com/ignored', claim: 'ignored' }].slice(0, maxSources) }) }) });
  assert.equal(result.ok, true);
  const report = JSON.parse(fs.readFileSync(result.report, 'utf8'));
  assert.equal(report.sources.length, 1);
  assert.equal(report.sources[0].validation, 'unverified');
  assert.equal(report.reward, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('pause flag is caller-owned and parseCandidate rejects unsafe or malformed sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-night-pause-'));
  assert.equal(setPaused(true, { stateDir: root }).paused, true);
  assert.equal(status({ now: Date.parse('2026-01-15T03:00:00Z'), stateDir: root, isPaused: fs.existsSync(path.join(root, 'paused.flag')) }).eligible, false);
  assert.equal(parseCandidate({ sources: [{ url: 'javascript:bad' }, { url: 'https://example.com/a', claim: 'ok' }] }).sources.length, 1);
  assert.equal(parseCandidate({ sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }] }, 1).status, 'source-budget-exceeded');
  setPaused(false, { stateDir: root });
  fs.rmSync(root, { recursive: true, force: true });
});

test('thrown worker becomes a bounded report instead of false success or an uncaught error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-night-worker-error-'));
  const result = await runPass({ stateDir: root, now: Date.parse('2026-01-15T03:00:00Z'), isPaused: false, isGaming: false, worker: async () => { throw new Error('offline fixture failure'); } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'worker-error');
  assert.equal(JSON.parse(fs.readFileSync(result.report, 'utf8')).reward, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('unknown gaming state and malformed counters fail closed', () => {
  const at = Date.parse('2026-01-15T03:00:00Z');
  assert.equal(status({ now: at }).eligible, false);
  assert.ok(status({ now: at, isGaming: false, state: { nights: { '2026-01-14': { attempts: '0' } } } }).reasons.includes('invalid-state'));
});

test('partial worker output is rejected and a timed-out worker keeps the pass lock', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-night-lock-'));
  const partial = await runPass({ stateDir: root, now: Date.parse('2026-01-15T03:00:00Z'), isPaused: false, isGaming: false, worker: async () => ({ ok: true, partial: true, value: { summary: 'partial' } }) });
  assert.equal(partial.status, 'worker-partial');
  let resolveWorker;
  const pending = new Promise(resolve => { resolveWorker = resolve; });
  const timedOut = await runPass({ stateDir: root, now: Date.parse('2026-01-15T03:00:00Z'), isPaused: false, isGaming: false, maxWorkerMs: 1000, worker: async () => pending });
  assert.equal(timedOut.status, 'worker-timeout');
  assert.equal(fs.existsSync(path.join(root, 'pass.lock')), true);
  const blocked = await runPass({ stateDir: root, now: Date.parse('2026-01-15T03:00:00Z'), isPaused: false, isGaming: false, worker: async () => ({ ok: true, value: {} }) });
  assert.deepEqual(blocked.reasons, ['research-pass-active']);
  resolveWorker({ ok: false, status: 'worker-canceled' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(path.join(root, 'pass.lock')), false);
  fs.rmSync(root, { recursive: true, force: true });
});
