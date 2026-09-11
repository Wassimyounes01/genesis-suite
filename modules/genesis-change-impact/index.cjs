'use strict';

// Original, portable impact analysis of an explicit graph. Never scans files.
const MAX_ENTRIES = 10000;
const MAX_EDGES = 50000;
const KINDS = ['file', 'consumer', 'test', 'doc', 'download'];
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

/** Case-sensitive exact repository paths, with slash and dot normalization only. */
function normalizeRepoPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value !== value.trim() ||
      /[\u0000-\u001f\u007f:*?]/.test(value)) {
    throw new TypeError('path must be a bounded, trimmed relative file path without controls, colon or wildcards');
  }
  const slashed = value.replace(/\\/g, '/');
  if (slashed.startsWith('/') || slashed.endsWith('/')) throw new TypeError('absolute paths and directory paths are forbidden');
  const parts = slashed.split('/');
  if (parts.includes('..')) throw new TypeError('path traversal is forbidden');
  const normalized = parts.filter(part => part && part !== '.').join('/');
  if (!normalized) throw new TypeError('path must identify a file');
  return normalized;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError(`${label} must be an ISO UTC timestamp`);
  }
  const time = Date.parse(value);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical) {
    throw new TypeError(`${label} must be a valid calendar timestamp`);
  }
  return time;
}

function hash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
  return value.toLowerCase();
}

function normalizeManifest(manifest) {
  record(manifest, 'manifest');
  if (manifest.schemaVersion !== 1) throw new TypeError('manifest.schemaVersion must be 1');
  if (!Array.isArray(manifest.entries) || manifest.entries.length > MAX_ENTRIES) {
    throw new TypeError(`manifest.entries must contain at most ${MAX_ENTRIES} entries`);
  }
  const entries = new Map();
  let edgeCount = 0;
  for (const input of manifest.entries) {
    record(input, 'entry');
    const path = normalizeRepoPath(input.path);
    if (entries.has(path)) throw new TypeError(`duplicate normalized entry: ${path}`);
    if (!KINDS.includes(input.kind)) throw new TypeError(`entry.kind must be one of ${KINDS.join(', ')}`);
    if (!Array.isArray(input.dependsOn)) throw new TypeError('entry.dependsOn must be an explicit array');
    edgeCount += input.dependsOn.length;
    if (edgeCount > MAX_EDGES) throw new RangeError(`manifest exceeds ${MAX_EDGES} edges`);
    const dependsOn = input.dependsOn.map(normalizeRepoPath).sort(compareText);
    if (new Set(dependsOn).size !== dependsOn.length) throw new TypeError(`duplicate normalized dependency: ${path}`);
    let evidence = null;
    if (input.evidence !== undefined && input.evidence !== null) {
      record(input.evidence, 'entry.evidence');
      evidence = {};
      if (input.evidence.expiresAt !== undefined) {
        evidence.expiresAt = input.evidence.expiresAt;
        evidence.expiresAtMs = timestamp(input.evidence.expiresAt, 'evidence.expiresAt');
      }
      if (input.evidence.artifactSha256 !== undefined) evidence.artifactSha256 = hash(input.evidence.artifactSha256, 'evidence.artifactSha256');
      if (!Object.keys(evidence).length) throw new TypeError('evidence requires expiresAt or artifactSha256');
    }
    entries.set(path, {
      path, kind: input.kind, dependsOn, evidence,
      sha256: input.sha256 === undefined ? null : hash(input.sha256, 'entry.sha256')
    });
  }
  const reverse = new Map([...entries.keys()].sort(compareText).map(path => [path, []]));
  for (const entry of entries.values()) {
    for (const dependency of entry.dependsOn) {
      if (!entries.has(dependency)) throw new TypeError(`undeclared dependency ${dependency} in ${entry.path}`);
      reverse.get(dependency).push(entry.path);
    }
  }
  for (const consumers of reverse.values()) consumers.sort(compareText);
  return { entries, reverse, edgeCount };
}

/**
 * manifest: {schemaVersion:1, entries:[{path, kind, dependsOn:[], sha256?,
 *   evidence?:{artifactSha256?, expiresAt?}}]}. Every dependency needs an entry.
 * changedPaths are exact file paths; no globs, filesystem lookup or inference.
 * options.now is an explicit ISO UTC timestamp used only for evidence expiry.
 * Returns a deterministic reverse closure, distance/parent explanations and gaps.
 * Evidence checks are limited to impacted entries and supplied hashes/timestamps.
 */
function analyzeChangeImpact(manifest, changedPaths, options = {}) {
  record(options, 'options');
  if (!Array.isArray(changedPaths) || changedPaths.length > MAX_ENTRIES) {
    throw new TypeError(`changedPaths must be an array of at most ${MAX_ENTRIES} paths`);
  }
  const now = options.now === undefined ? null : timestamp(options.now, 'options.now');
  const graph = normalizeManifest(manifest);
  const changes = [...new Set(changedPaths.map(normalizeRepoPath))].sort(compareText);
  const gaps = [];
  const visited = new Map();
  const queue = [];
  for (const path of changes) {
    if (!graph.entries.has(path)) gaps.push({ type: 'unmatched-change', path });
    else {
      visited.set(path, { distance: 0, via: null });
      queue.push(path);
    }
  }
  // Iterative traversal stays bounded even for cycles and long dependency chains.
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    for (const consumer of graph.reverse.get(path)) {
      if (visited.has(consumer)) continue;
      visited.set(consumer, { distance: visited.get(path).distance + 1, via: path });
      queue.push(consumer);
    }
  }
  const affected = Object.fromEntries(KINDS.map(kind => [kind, []]));
  const impacted = [...visited.keys()].sort(compareText).map(path => {
    const entry = graph.entries.get(path);
    affected[entry.kind].push(path);
    if (entry.evidence) {
      if (entry.evidence.expiresAt !== undefined) {
        if (now === null) gaps.push({ type: 'evidence-expiry-unchecked', path, expiresAt: entry.evidence.expiresAt });
        else if (now >= entry.evidence.expiresAtMs) gaps.push({ type: 'evidence-expired', path, expiresAt: entry.evidence.expiresAt });
      }
      if (entry.evidence.artifactSha256 !== undefined) {
        if (entry.sha256 === null) gaps.push({ type: 'evidence-hash-unchecked', path });
        else if (entry.sha256 !== entry.evidence.artifactSha256) gaps.push({ type: 'evidence-hash-mismatch', path });
      }
    }
    return { path, kind: entry.kind, ...visited.get(path) };
  });
  gaps.sort((a, b) => compareText(a.path, b.path) || compareText(a.type, b.type));
  return {
    schemaVersion: 1,
    manifestEntryCount: graph.entries.size,
    manifestEdgeCount: graph.edgeCount,
    changedPaths: changes,
    impacted, affected, gaps,
    coverageComplete: gaps.length === 0,
    scope: 'explicit-manifest-only'
  };
}

module.exports = { analyzeChangeImpact, normalizeRepoPath, MAX_ENTRIES, MAX_EDGES };
