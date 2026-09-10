'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_CHECK_BYTES = 64 * 1024;

function contained(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function containedPath(candidate, root, allowMissingLeaf = true) {
  if (!contained(candidate, root)) return false;
  const relative = path.relative(root, candidate);
  if (!relative) return true;
  let current = root;
  const parts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { return allowMissingLeaf && index === parts.length - 1 && error.code === 'ENOENT'; }
    if (stat.isSymbolicLink() || stat.st_reparse_tag) return false;
  }
  return true;
}

function boundedInt(value, name, fallback, minimum = 1) {
  const result = value == null ? fallback : Number(value);
  if (!Number.isFinite(result) || !Number.isInteger(result) || result < minimum) throw new TypeError(`${name} must be a finite integer >= ${minimum}`);
  return result;
}

function resolveRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('each root must be an explicit path');
  const root = path.resolve(value);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.st_reparse_tag) throw new Error('root must be a real directory, not a symlink or reparse point');
  return root;
}

function readBounded(file, maxBytes = MAX_CHECK_BYTES) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { return { ok: false, error: error.code === 'ENOENT' ? 'file is missing' : error.message }; }
  if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, error: 'file is not a regular non-link file' };
  if (stat.size > maxBytes) return { ok: false, error: `file exceeds ${maxBytes} byte check limit` };
  try { return { ok: true, text: fs.readFileSync(file, 'utf8') }; } catch (error) { return { ok: false, error: error.message }; }
}

function parseJsonBounded(file) {
  const value = readBounded(file);
  if (!value.ok) return value;
  try { return { ok: true, value: JSON.parse(value.text) }; } catch (error) { return { ok: false, error: `invalid JSON: ${error.message}` }; }
}

function extractPointer(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  for (const key of ['target', 'path', 'repository', 'pointer']) if (typeof value[key] === 'string') return value[key];
  return '';
}

function extractRegistryEntries(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.packages)) return value.packages;
  if (value && Array.isArray(value.entries)) return value.entries;
  return [];
}

function checkProvenance(options = {}) {
  const root = resolveRoot(options.root);
  const result = { rootId: options.rootId || 'root-1', registry: { checked: false, valid: true, errors: [] }, pointer: { checked: false, valid: true, errors: [] }, licenses: { checked: false, valid: true, errors: [] } };
  const resolveContained = value => {
    if (typeof value !== 'string' || path.isAbsolute(value) || path.win32.isAbsolute(value) || value.split(/[\\/]/).includes('..')) return null;
    const target = path.resolve(root, value.replace(/\\/g, path.sep));
    return containedPath(target, root) ? target : null;
  };
  const existingContained = value => {
    const target = resolveContained(value);
    if (!target) return null;
    try { const stat = fs.lstatSync(target); return stat.isSymbolicLink() || stat.st_reparse_tag ? null : target; } catch (_) { return null; }
  };
  if (options.registryPath) {
    result.registry.checked = true;
    const file = resolveContained(options.registryPath);
    if (!file) result.registry.errors.push('registry path must be relative and contained by the root');
    else {
      const parsed = parseJsonBounded(file);
      if (!parsed.ok) result.registry.errors.push(parsed.error);
      else {
        const registryEntries = extractRegistryEntries(parsed.value);
        if ((!Array.isArray(parsed.value) && (!parsed.value || !Array.isArray(parsed.value.packages) && !Array.isArray(parsed.value.entries))) || registryEntries.length === 0) result.registry.errors.push('registry must be a supported non-empty array, packages array, or entries array');
        result.registry.entries = registryEntries.length;
        for (const entry of registryEntries) {
          const relative = entry && (entry.path || entry.root || entry.directory);
          if (typeof relative !== 'string' || !existingContained(relative)) result.registry.errors.push('registry entry must name an existing contained non-link path');
        }
      }
    }
    result.registry.valid = result.registry.errors.length === 0;
  }
  if (options.pointerPath) {
    result.pointer.checked = true;
    const file = resolveContained(options.pointerPath);
    if (!file) result.pointer.errors.push('pointer path must be relative and contained by the root');
    else {
      const parsed = parseJsonBounded(file);
      const pointerValue = parsed.ok ? extractPointer(parsed.value) : '';
      if (!parsed.ok) result.pointer.errors.push(parsed.error);
      else if (!pointerValue || !existingContained(pointerValue)) result.pointer.errors.push('pointer target must be an existing contained relative path');
      else result.pointer.target = pointerValue.replaceAll('\\', '/');
    }
    result.pointer.valid = result.pointer.errors.length === 0;
  }
  if (Array.isArray(options.licenseFiles) && options.licenseFiles.length) {
    result.licenses.checked = true;
    result.licenses.files = [];
    for (const value of options.licenseFiles) {
      const file = resolveContained(value);
      if (!file) result.licenses.errors.push('license path must be relative and contained by the root');
      else {
        let stat;
        try { stat = fs.lstatSync(file); } catch (_) { stat = null; }
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) result.licenses.errors.push(`missing regular license file: ${value}`);
        else { result.licenses.files.push(String(value).replaceAll('\\', '/')); const text = readBounded(file); if (!text.ok) result.licenses.errors.push(`${value}: ${text.error}`); }
      }
    }
    result.licenses.valid = result.licenses.errors.length === 0;
  }
  result.valid = result.registry.valid && result.pointer.valid && result.licenses.valid;
  return result;
}

function scan(options = {}) {
  if (!Array.isArray(options.roots) || options.roots.length === 0) throw new TypeError('roots must be a non-empty explicit array');
  const roots = options.roots.map(resolveRoot);
  const maxEntries = boundedInt(options.maxEntries, 'maxEntries', DEFAULT_MAX_ENTRIES);
  const maxMetadataBytes = boundedInt(options.maxMetadataBytes, 'maxMetadataBytes', DEFAULT_MAX_METADATA_BYTES, 1024);
  const outputPath = options.outputPath ? path.resolve(options.outputPath) : null;
  if (outputPath && !roots.some(root => containedPath(outputPath, root))) throw new Error('outputPath must be contained inside one explicit root with non-link parents');
  const stream = outputPath ? fs.openSync(outputPath, 'w') : null;
  const entries = [];
  const skippedSymlinks = [];
  const errors = [];
  const recordError = value => { if (errors.length < maxEntries) errors.push(value); else truncated = true; };
  const recordSkipped = value => { if (skippedSymlinks.length < maxEntries) skippedSymlinks.push(value); else truncated = true; };
  let metadataBytes = 0;
  let truncated = false;
  const writeRecord = record => {
    const line = JSON.stringify(record) + '\n';
    if (entries.length >= maxEntries) { truncated = true; return false; }
    const lineBytes = Buffer.byteLength(line);
    if (metadataBytes + lineBytes > maxMetadataBytes) { truncated = true; return false; }
    metadataBytes += lineBytes;
    if (stream != null) fs.writeSync(stream, line);
    entries.push(record);
    return entries.length <= maxEntries;
  };
  try {
    roots.forEach((root, index) => {
      const rootId = `root-${index + 1}`;
      const pending = [{ absolute: root, relative: '' }];
      while (pending.length && !truncated) {
        const current = pending.pop();
        let directory;
        try { directory = fs.opendirSync(current.absolute); } catch (error) { recordError({ path: current.relative || '.', error: String(error.message).slice(0, 300) }); continue; }
        try { let entry; while ((entry = directory.readSync()) !== null) {
          if (truncated) break;
          const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
          const absolute = path.join(current.absolute, entry.name);
          if (outputPath && path.resolve(absolute) === outputPath) continue;
          let stat;
          try { stat = fs.lstatSync(absolute); } catch (error) { recordError({ path: relative, error: String(error.message).slice(0, 300) }); continue; }
          const isLink = stat.isSymbolicLink() || Boolean(stat.st_reparse_tag);
          if (isLink) { recordSkipped({ rootId, path: relative, traversed: false }); writeRecord({ rootId, path: relative, kind: 'symlink', traversed: false }); continue; }
          const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
          if (!writeRecord({ rootId, path: relative, kind, bytes: stat.isFile() ? stat.size : 0, mtimeMs: stat.mtimeMs })) break;
          if (stat.isDirectory()) { if (pending.length >= maxEntries) truncated = true; else pending.push({ absolute, relative }); }
        } } finally { try { directory.closeSync(); } catch (_) {} }
      }
    });
  } finally { if (stream != null) fs.closeSync(stream); }
  const provenance = options.provenance ? checkProvenance({ ...options.provenance, root: options.provenance.root || roots[0], rootId: 'root-1' }) : { valid: true, checked: false };
  return {
    schema: 'genesis-repo-atlas/1',
    roots: roots.map((_, index) => `root-${index + 1}`),
    entries,
    counts: { entries: entries.length, symlinksSkipped: skippedSymlinks.length, errors: errors.length },
    skippedSymlinks,
    errors,
    truncated,
    metadataBytes,
    provenance,
    coverage: 'bounded metadata census; no semantic-all-files claim',
    semanticCoverageClaim: false,
    outputPath: outputPath ? path.basename(outputPath) : null,
  };
}

module.exports = { scan, checkProvenance, contained, containedPath, extractPointer, extractRegistryEntries };
