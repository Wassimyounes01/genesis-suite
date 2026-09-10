'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BOUND = 1_000_000;

const policy = Object.freeze({ timezone: 'America/New_York', windowStartHour: 21, windowEndHour: 8, maxPassesPerNight: 6, maxSourcesPerPass: 3, maxWorkerMs: 120000 });
const THEMES = Object.freeze([
  { id: 'bounded-routing', question: 'Which small offline check could make provider routing more bounded or observable?' },
  { id: 'metadata-atlas', question: 'Which metadata-only repository census check could catch provenance drift?' },
  { id: 'review-evidence', question: 'Which artifact-bound review evidence would make a workflow result easier to verify?' },
]);

function parts(at, timezone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second), date: `${values.year}-${values.month}-${values.day}` };
}

function localDateOffset(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function findBoundary(at, timezone, hour, direction) {
  const step = direction < 0 ? -60000 : 60000;
  let cursor = Math.floor(at / 60000) * 60000;
  for (let i = 0; i < 60 * 49; i++) {
    if (direction < 0) {
      const current = parts(cursor, timezone);
      if (current.hour === hour && current.minute === 0) return cursor;
    }
    cursor += step;
    const local = parts(cursor, timezone);
    if (local.hour === hour && local.minute === 0) return cursor;
  }
  return null;
}

function nightWindow(at = Date.now(), timezone = policy.timezone) {
  const local = parts(at, timezone);
  const eligible = local.hour >= policy.windowStartHour || local.hour < policy.windowEndHour;
  const nightDate = local.hour < policy.windowEndHour ? localDateOffset(local.date, -1) : local.date;
  const startsAt = eligible ? findBoundary(at, timezone, policy.windowStartHour, -1) : findBoundary(at, timezone, policy.windowStartHour, 1);
  const endsAt = eligible ? findBoundary(at, timezone, policy.windowEndHour, 1) : null;
  return { timezone, eligible, nightDate, local, startsAt, endsAt, remainingMs: eligible && endsAt ? Math.max(0, endsAt - at) : 0 };
}

function evaluateGate(fn) {
  try {
    const value = typeof fn === 'function' ? fn() : fn;
    if (value === false) return 'clear';
    if (value === true) return 'active';
    return 'unknown';
  } catch (_) { return 'unknown'; }
}

function status(options = {}) {
  const at = typeof options.now === 'function' ? options.now() : Number(options.now ?? Date.now());
  const timezone = options.timezone || policy.timezone;
  const window = nightWindow(at, timezone);
  const reasons = [];
  if (!window.eligible) reasons.push('outside-night-window');
  if (window.eligible && options.isPaused != null) { const pauseState = evaluateGate(options.isPaused); if (pauseState === 'active') reasons.push('paused'); else if (pauseState === 'unknown') reasons.push('pause-state-unknown'); }
  if (window.eligible) { const gamingState = evaluateGate(options.isGaming); if (gamingState === 'active') reasons.push('gaming-active'); else if (gamingState === 'unknown') reasons.push('gaming-state-unknown'); }
  const state = options.state == null ? { nights: {} } : options.state;
  let stateValid = Boolean(state && typeof state === 'object' && !Array.isArray(state) && state.nights && typeof state.nights === 'object' && !Array.isArray(state.nights));
  const entry = stateValid ? state.nights[window.nightDate] : null;
  if (entry != null && (!entry || typeof entry !== 'object' || Array.isArray(entry))) stateValid = false;
  const rawAttempts = stateValid ? entry?.attempts : null;
  const attempts = rawAttempts == null ? 0 : rawAttempts;
  const maxPasses = Number(options.maxPassesPerNight ?? policy.maxPassesPerNight);
  const sourceBudget = Number(options.maxSourcesPerPass ?? policy.maxSourcesPerPass);
  const workerBudgetMs = Number(options.maxWorkerMs ?? policy.maxWorkerMs);
  if (!Number.isFinite(maxPasses) || !Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > MAX_BOUND) reasons.push('invalid-pass-budget');
  if (!Number.isFinite(sourceBudget) || !Number.isInteger(sourceBudget) || sourceBudget < 1 || sourceBudget > MAX_BOUND) reasons.push('invalid-source-budget');
  if (!Number.isFinite(workerBudgetMs) || !Number.isInteger(workerBudgetMs) || workerBudgetMs < 1000 || workerBudgetMs > MAX_BOUND) reasons.push('invalid-worker-budget');
  if (!stateValid || typeof attempts !== 'number' || !Number.isFinite(attempts) || !Number.isInteger(attempts) || attempts < 0 || attempts > MAX_BOUND) reasons.push('invalid-state');
  if (attempts >= maxPasses) reasons.push('night-pass-budget-exhausted');
  return { ok: reasons.length === 0, eligible: reasons.length === 0, reasons, window, attempts: reasons.includes('invalid-state') ? maxPasses : attempts, maxPasses, maxSourcesPerPass: sourceBudget, timeoutMs: workerBudgetMs, workerBudget: 1, sourceBudget };
}

function locations(options) {
  if (!options.stateDir || typeof options.stateDir !== 'string') throw new TypeError('stateDir is required and must be caller-owned');
  const root = path.resolve(options.stateDir);
  return { root, lock: path.join(root, 'pass.lock'), state: path.join(root, 'state.json'), reports: path.join(root, 'reports') };
}

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}

function parseCandidate(value, maxSources = policy.maxSourcesPerPass) {
  const sourceLimit = Number(maxSources);
  if (!Number.isFinite(sourceLimit) || !Number.isInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > MAX_BOUND) return { status: 'invalid-source-budget', sources: [], error: `maxSources must be a finite positive integer <= ${MAX_BOUND}` };
  let parsed = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch (_) { return { status: 'invalid-worker-output', sources: [], error: 'worker output was not JSON' }; } }
  if (!parsed || typeof parsed !== 'object') return { status: 'invalid-worker-output', sources: [], error: 'worker output must be an object' };
  const sourceList = Array.isArray(parsed.sources) ? parsed.sources : [];
  const sourceBudgetExceeded = sourceList.length > sourceLimit;
  const sources = [];
  for (const source of sourceList.slice(0, sourceLimit)) {
    if (!source || typeof source !== 'object' || !/^https?:\/\//i.test(String(source.url || ''))) continue;
    sources.push({ url: String(source.url).slice(0, 500), title: String(source.title || '').slice(0, 500), claim: String(source.claim || '').slice(0, 1200), validation: 'unverified' });
  }
  const fields = {};
  for (const key of ['question', 'summary', 'hypothesis', 'candidateImprovement', 'experimentProposal', 'limitations']) fields[key] = String(parsed[key] || '').slice(0, 3000);
  return { status: sourceBudgetExceeded ? 'source-budget-exceeded' : sources.length ? 'candidate-awaiting-source-validation' : 'no-new-source-candidates', sourceBudgetExceeded, ...fields, sources };
}

async function runPass(options = {}) {
  const loc = locations(options);
  fs.mkdirSync(loc.root, { recursive: true });
  let fd;
  try { fd = fs.openSync(loc.lock, 'wx'); } catch (error) { if (error.code === 'EEXIST') return { ok: true, dispatched: false, reasons: ['research-pass-active'] }; throw error; }
  let deferUnlock = false;
  let lockReleased = false;
  const releaseLock = () => { if (lockReleased) return; lockReleased = true; try { fs.closeSync(fd); } finally { try { fs.unlinkSync(loc.lock); } catch (_) {} } };
  try {
    const state = readJson(loc.state, { version: 1, nights: {} });
    const gate = status({ ...options, isPaused: options.isPaused ?? fs.existsSync(path.join(loc.root, 'paused.flag')), state });
    if (!gate.eligible) return { ...gate, dispatched: false };
    const nightDate = gate.window.nightDate;
    const prior = state.nights[nightDate] || { attempts: 0 };
    const passId = `${nightDate}-${prior.attempts + 1}-${crypto.randomUUID().slice(0, 8)}`;
    state.nights[nightDate] = { attempts: prior.attempts + 1, passId, startedAt: new Date(Date.now()).toISOString() };
    writeJson(loc.state, state);
    const controller = new AbortController();
    const deadlineMs = Math.min(gate.timeoutMs, gate.window.remainingMs);
    const theme = options.theme || THEMES[prior.attempts % THEMES.length];
    let result;
    if (typeof options.worker !== 'function') result = { ok: false, status: 'worker-unavailable', error: 'an explicit worker callback is required' };
    else if (deadlineMs < 1000) result = { ok: false, status: 'window-too-short', error: 'less than one second remains in the bounded window' };
    else {
      let workerSettled = false;
      const workerPromise = Promise.resolve().then(() => options.worker({ passId, question: theme.question, maxSources: gate.sourceBudget, signal: controller.signal, deadlineMs }));
      workerPromise.then(() => { workerSettled = true; }, () => { workerSettled = true; });
      let timeout;
      const timeoutPromise = new Promise(resolve => { timeout = setTimeout(() => { controller.abort(); resolve({ ok: false, status: 'worker-timeout', error: 'worker exceeded bounded pass time' }); }, deadlineMs); });
      try { result = await Promise.race([workerPromise, timeoutPromise]); } catch (error) { result = { ok: false, status: 'worker-error', error: error.message }; } finally { clearTimeout(timeout); workerPromise.catch(() => {}); }
      if (result?.status === 'worker-timeout' && !workerSettled) { deferUnlock = true; workerPromise.finally(releaseLock).catch(() => {}); }
    }
    const hasPayload = result && (typeof result.value === 'string' || (result.value && typeof result.value === 'object') || typeof result.text === 'string');
    const candidate = result?.ok === true && result.partial !== true && hasPayload ? parseCandidate(result.value ?? result.text, gate.sourceBudget) : { status: result?.partial === true ? 'worker-partial' : result?.status || 'worker-error', sources: [], error: String(result?.partial === true ? 'worker returned partial output' : result?.error || 'worker did not complete').slice(0, 1000) };
    const finishedAt = new Date(Date.now()).toISOString();
    const report = { version: 1, passId, nightDate, theme: theme.id || 'custom', question: theme.question, startedAt: state.nights[nightDate].startedAt, finishedAt, ...candidate, dispatched: typeof options.worker === 'function', reward: 0, promotion: 'none', independentlyValidated: false, actualModel: result?.actualModel ?? null, monetaryCost: result?.monetaryCost ?? null, usage: result?.usage ?? null, limitation: 'Source candidates are unverified; no promotion or production change occurs.' };
    const jsonPath = path.join(loc.reports, `${passId}.json`);
    writeJson(jsonPath, report);
    const markdown = [`# Night research candidate`, ``, `Pass: ${passId}`, `Status: ${report.status}`, ``, `No source was independently validated and no promotion occurred.`, ``, report.question, ``];
    for (const field of ['summary', 'hypothesis', 'candidateImprovement', 'experimentProposal', 'limitations', 'error']) if (report[field]) markdown.push(`## ${field}`, ``, report[field], ``);
    markdown.push('## Source candidates', '');
    if (!report.sources.length) markdown.push('No source candidates recorded.');
    else for (const source of report.sources) markdown.push(`- ${source.url} — unverified: ${source.claim}`);
    fs.writeFileSync(path.join(loc.reports, `${passId}.md`), markdown.join('\n') + '\n', 'utf8');
    state.nights[nightDate].status = report.status;
    writeJson(loc.state, state);
    return { ok: report.status === 'candidate-awaiting-source-validation' || report.status === 'no-new-source-candidates', dispatched: report.dispatched, status: report.status, passId, nightDate, report: jsonPath, sourceCandidates: report.sources.length, reward: 0 };
  } finally { if (!deferUnlock) releaseLock(); }
}

function setPaused(paused, options = {}) {
  const loc = locations(options);
  fs.mkdirSync(loc.root, { recursive: true });
  const file = path.join(loc.root, 'paused.flag');
  if (paused) fs.writeFileSync(file, 'paused\n'); else try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ok: true, paused: Boolean(paused) };
}

module.exports = { policy, THEMES, nightWindow, status, runPass, parseCandidate, setPaused };
