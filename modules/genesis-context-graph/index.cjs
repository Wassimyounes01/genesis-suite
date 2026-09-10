'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_BYTES = 4 * 1024 * 1024;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function id(value, label) { if (typeof value !== 'string' || !ID.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) throw new Error(`${label} must be a simple identifier`); return value; }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function tokens(value) { return [...new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 1))].slice(0, 40); }

class ContextGraph {
  constructor(options = {}) {
    if (typeof options.stateDir !== 'string' || !options.stateDir.trim()) throw new Error('stateDir is required and must be caller-supplied');
    if (typeof options.sourceRoot !== 'string' || !options.sourceRoot.trim()) throw new Error('sourceRoot is required and must be caller-supplied');
    this.stateDir = path.resolve(options.stateDir);
    this.sourceRoot = path.resolve(options.sourceRoot);
    this.file = path.join(this.stateDir, 'context.json');
    this.maxCards = Number.isInteger(options.maxCards) ? Math.max(1, Math.min(500, options.maxCards)) : 100;
    this.maxAttributes = Number.isInteger(options.maxAttributes) ? Math.max(1, Math.min(20, options.maxAttributes)) : 12;
    this._state = this._load();
  }

  _load() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    if (!fs.existsSync(this.file)) return { version: 1, cards: Object.create(null), transfers: [] };
    if (fs.statSync(this.file).size > 2 * 1024 * 1024) throw new Error('context graph state exceeds size bound');
    const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!state || state.version !== 1 || !state.cards || !Array.isArray(state.transfers)) throw new Error('invalid context graph state');
    return state;
  }

  _save() {
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(this._state, null, 2) + '\n';
    if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error('context graph state exceeds size bound');
    try { fs.writeFileSync(temporary, serialized, { mode: 0o600 }); fs.renameSync(temporary, this.file); }
    catch (error) { try { fs.rmSync(temporary, { force: true }); } catch {} throw error; }
  }

  _proofPath(proof) {
    if (!proof || typeof proof.path !== 'string' || !proof.path.trim()) throw new Error('source proof path required');
    const absolute = path.resolve(this.sourceRoot, proof.path);
    const relative = path.relative(this.sourceRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source proof outside sourceRoot');
    const realRoot = fs.realpathSync(this.sourceRoot);
    const realFile = fs.realpathSync(absolute);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('source proof symlink outside sourceRoot');
    return realFile;
  }

  proofValid(proof) {
    try {
      if (!proof || typeof proof.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(proof.sha256)) return false;
      const file = this._proofPath(proof), stat = fs.statSync(file);
      return stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === proof.sha256.toLowerCase();
    } catch { return false; }
  }

  _approval(card) {
    const approval = card.approval;
    if (!approval) return { valid: false, reason: 'no explicit approval supplied' };
    if (typeof approval.messageRef !== 'string' || !approval.messageRef.trim() || !approval.receipt || !this.proofValid(approval.receipt)) return { valid: false, reason: 'explicit approval receipt is missing or stale' };
    try {
      const receipt = JSON.parse(fs.readFileSync(this._proofPath(approval.receipt), 'utf8'));
      const requested = new Set(card.attributes.map(attribute => attribute.id));
      const approved = new Set(Array.isArray(receipt.attributeIds) ? receipt.attributeIds : []);
      const covers = [...requested].every(attributeId => approved.has(attributeId));
      if (receipt.kind !== 'user-approval' || receipt.approved !== true || receipt.cardId !== card.id || receipt.messageRef !== approval.messageRef || receipt.artifactSha256 !== card.artifact.sha256 || typeof receipt.quote !== 'string' || !receipt.quote.trim() || !covers) return { valid: false, reason: 'approval receipt does not explicitly approve this artifact and attributes' };
      return { valid: true, receipt: { kind: receipt.kind, approved: true, messageRef: receipt.messageRef, quote: receipt.quote.slice(0, 500), artifactSha256: receipt.artifactSha256, attributeIds: [...approved] } };
    } catch (error) { return { valid: false, reason: `approval receipt unreadable: ${error.message}` }; }
  }

  _validateCard(card) {
    if (!card || typeof card !== 'object') throw new Error('source card object required');
    id(card.id, 'card id');
    if (!card.task || typeof card.task !== 'object' || !ID.test(card.task.id || '') || typeof card.task.label !== 'string' || !card.task.label.trim() || card.task.label.length > 240 || typeof card.task.domain !== 'string' || !card.task.domain.trim() || card.task.domain.length > 80) throw new Error('bounded task id, label and domain are required');
    if (!card.artifact || typeof card.artifact.path !== 'string' || !/^[a-f0-9]{64}$/i.test(card.artifact.sha256 || '')) throw new Error('source artifact path and sha256 are required');
    if (!Array.isArray(card.attributes) || card.attributes.length < 1 || card.attributes.length > this.maxAttributes) throw new Error(`1..${this.maxAttributes} attributes are required`);
    const attrIds = new Set();
    for (const attribute of card.attributes) {
      id(attribute.id, 'attribute id');
      if (attrIds.has(attribute.id) || typeof attribute.label !== 'string' || !attribute.label.trim() || attribute.label.length > 240 || typeof attribute.mechanism !== 'string' || !attribute.mechanism.trim() || attribute.mechanism.length > 1000 || !Array.isArray(attribute.tags) || attribute.tags.length > 20 || attribute.tags.some(tag => typeof tag !== 'string' || tag.length > 80) || !Array.isArray(attribute.appliesTo) || attribute.appliesTo.length === 0 || attribute.appliesTo.length > 20 || !Array.isArray(attribute.contraindications) || attribute.contraindications.length > 20) throw new Error('attributes need bounded unique ids, labels, mechanisms, tags, appliesTo and contraindications');
      attrIds.add(attribute.id);
      if (attribute.evidence && (!attribute.evidence.path || !/^[a-f0-9]{64}$/i.test(attribute.evidence.sha256 || ''))) throw new Error('attribute evidence needs path and sha256');
    }
  }

  registerCard(card) {
    this._validateCard(card);
    if (Object.keys(this._state.cards).length >= this.maxCards && !Object.hasOwn(this._state.cards, card.id)) throw new Error('context card capacity reached');
    if (!this.proofValid(card.artifact)) throw new Error('source artifact is unavailable or sha256 is stale');
    for (const attribute of card.attributes) if (attribute.evidence && !this.proofValid(attribute.evidence)) throw new Error(`attribute evidence is unavailable or stale: ${attribute.id}`);
    const approval = this._approval(card);
    if (card.approval && !approval.valid) throw new Error(approval.reason);
    const stored = clone({ ...card, registeredAt: new Date().toISOString(), provenance: 'caller-supplied artifact and explicit approval receipt' });
    if (Object.hasOwn(this._state.cards, card.id)) {
      const existing = { ...this._state.cards[card.id] }; delete existing.registeredAt; delete existing.provenance;
      const incoming = { ...stored }; delete incoming.registeredAt; delete incoming.provenance;
      if (digest(existing) !== digest(incoming)) throw new Error('source card is immutable; register a new card id');
      return { cardId: card.id, attributes: card.attributes.length, userApproved: approval.valid, duplicate: true };
    }
    if (JSON.stringify(stored).length > 50000) throw new Error('source card exceeds state size bound');
    const before = clone(this._state);
    try { this._state.cards[card.id] = stored; this._save(); }
    catch (error) { this._state = before; throw error; }
    return { cardId: card.id, attributes: card.attributes.length, userApproved: approval.valid, duplicate: false };
  }

  getCard(cardId) { id(cardId, 'card id'); return this._state.cards[cardId] ? clone(this._state.cards[cardId]) : null; }

  _freshCard(card) {
    if (!this.proofValid(card.artifact)) return { fresh: false, reason: 'source artifact changed or unavailable' };
    for (const attribute of card.attributes) if (attribute.evidence && !this.proofValid(attribute.evidence)) return { fresh: false, reason: `attribute evidence changed or unavailable: ${attribute.id}` };
    if (!card.approval) return { fresh: true, approval: { valid: false, receipt: null } };
    const approval = this._approval(card);
    return approval.valid ? { fresh: true, approval } : { fresh: false, reason: approval.reason };
  }

  query(request = {}, options = {}) {
    const terms = tokens([request.goal, ...(request.attributes || [])].join(' '));
    const domain = String(request.domain || '').toLowerCase().trim();
    const constraints = new Set(tokens((request.constraints || []).join(' ')));
    const limit = Math.min(5, Math.max(1, Number(options.limit) || 5));
    const candidates = [], excluded = [];
    for (const card of Object.values(this._state.cards).slice(0, this.maxCards)) {
      const state = this._freshCard(card);
      if (!state.fresh) { if (excluded.length < 10) excluded.push({ cardId: card.id, reasons: [state.reason] }); continue; }
      const cardTerms = tokens([card.task.label, card.task.domain, ...card.attributes.map(attribute => `${attribute.label} ${attribute.mechanism} ${attribute.tags.join(' ')}`)].join(' '));
      const score = terms.length ? terms.filter(term => cardTerms.includes(term)).length : 0;
      for (const attribute of card.attributes) {
        const attributeTerms = tokens([attribute.label, attribute.mechanism, ...attribute.tags].join(' '));
        if (terms.length && !terms.some(term => attributeTerms.includes(term))) continue;
        if (domain && !attribute.appliesTo.includes('*') && !attribute.appliesTo.map(value => String(value).toLowerCase()).includes(domain)) continue;
        const blocked = attribute.contraindications.filter(item => Array.isArray(item.tags) && item.tags.some(tag => constraints.has(String(tag).toLowerCase()))).map(item => item.reason);
        if (blocked.length) { if (excluded.length < 10) excluded.push({ cardId: card.id, attributeId: attribute.id, reasons: blocked }); continue; }
        const approval = state.approval?.receipt;
        if (request.requireUserApproval === true && !approval) { if (excluded.length < 10) excluded.push({ cardId: card.id, attributeId: attribute.id, reasons: ['explicit user approval is required'] }); continue; }
        candidates.push({ cardId: card.id, attributeId: attribute.id, label: attribute.label, mechanism: attribute.mechanism, score, sourceTask: clone(card.task), sourceArtifact: clone(card.artifact), sourceEvidence: attribute.evidence ? clone(attribute.evidence) : null, userApproved: !!approval, approvalMessageRef: approval?.messageRef || null, transferStatus: 'candidate-unverified', missingEvidence: ['target-specific acceptance and regression check', ...(!approval ? ['explicit user approval if required by target'] : [])], applicability: clone(attribute.appliesTo), contraindications: attribute.contraindications.map(item => item.reason) });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId) || a.attributeId.localeCompare(b.attributeId));
    return { candidates: candidates.slice(0, limit), excluded, inspectedCards: Object.keys(this._state.cards).length, returned: Math.min(candidates.length, limit), truncated: candidates.length > limit, gaps: candidates.length ? [] : ['No fresh, explicitly approved matching source was found'], provenance: 'bounded source cards with explicit approval receipts; target transfer remains unverified' };
  }

  revalidateCandidate(candidate, request = {}) {
    if (!candidate || !candidate.cardId || !candidate.attributeId) return { valid: false, reasons: ['candidate identity required'] };
    const card = this._state.cards[candidate.cardId];
    if (!card) return { valid: false, reasons: ['source card unavailable'] };
    const state = this._freshCard(card), attribute = card.attributes.find(item => item.id === candidate.attributeId), reasons = [];
    if (!state.fresh) reasons.push(state.reason);
    if (!attribute) reasons.push('source attribute unavailable');
    if (attribute && candidate.mechanism !== attribute.mechanism) reasons.push('source mechanism changed');
    if (attribute && candidate.sourceArtifact && digest(candidate.sourceArtifact) !== digest(card.artifact)) reasons.push('source artifact proof changed');
    if (attribute && candidate.sourceEvidence !== undefined && digest(candidate.sourceEvidence) !== digest(attribute.evidence || null)) reasons.push('source evidence proof changed');
    if (request.requireUserApproval === true && (!state.fresh || !state.approval?.valid)) reasons.push('explicit approval unavailable');
    if (request.domain && attribute && !attribute.appliesTo.includes('*') && !attribute.appliesTo.includes(request.domain)) reasons.push('attribute applicability excludes target domain');
    const constraints = new Set(tokens((request.constraints || []).join(' ')));
    if (attribute) reasons.push(...attribute.contraindications.filter(item => Array.isArray(item.tags) && item.tags.some(tag => constraints.has(String(tag).toLowerCase()))).map(item => item.reason));
    return { valid: reasons.length === 0, reasons };
  }

  recordTransfer(transfer) {
    if (!transfer || !ID.test(transfer.id || '') || !transfer.sourceCardId || !transfer.attributeId || !transfer.targetTaskId) throw new Error('transfer needs id, sourceCardId, attributeId and targetTaskId');
    if (!this._state.cards[transfer.sourceCardId]?.attributes.some(attribute => attribute.id === transfer.attributeId)) throw new Error('source attribute is not indexed');
    const incoming = { sourceCardId: transfer.sourceCardId, attributeId: transfer.attributeId, targetTaskId: transfer.targetTaskId, reason: String(transfer.reason || '').slice(0, 500) };
    const existing = this._state.transfers.find(item => item.id === transfer.id);
    if (existing) {
      if (existing.sourceCardId !== incoming.sourceCardId || existing.attributeId !== incoming.attributeId || existing.targetTaskId !== incoming.targetTaskId || existing.reason !== incoming.reason || (transfer.status != null && transfer.status !== existing.status)) throw new Error('transfer proposal is immutable; transfer id is already bound');
      return { ...clone(existing), duplicate: true };
    }
    if (transfer.status != null && transfer.status !== 'candidate') throw new Error('new transfer proposals must have candidate status');
    if (this._state.transfers.length >= 200) throw new Error('transfer proposal capacity reached');
    const record = { id: transfer.id, ...incoming, status: 'candidate', recordedAt: new Date().toISOString() };
    const before = clone(this._state);
    try { this._state.transfers.push(record); this._save(); }
    catch (error) { this._state = before; throw error; }
    return clone(record);
  }

  snapshot() {
    const nodes = [], edges = [], nodeIds = new Set();
    const addNode = node => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); } };
    for (const card of Object.values(this._state.cards).slice(0, 20)) {
      const state = this._freshCard(card), taskId = `task:${card.task.id}`, artifactId = `artifact:${card.id}`;
      addNode({ id: taskId, type: 'task', label: card.task.label, status: 'candidate' }); addNode({ id: artifactId, type: 'artifact', label: card.artifact.path, status: state.fresh ? 'source-verified' : 'stale' });
      edges.push({ source: artifactId, target: taskId, type: 'derived-from', status: state.fresh ? 'source-verified' : 'stale' });
      for (const attribute of card.attributes) { const attributeId = `attribute:${card.id}:${attribute.id}`; addNode({ id: attributeId, type: 'attribute', label: attribute.label, status: state.fresh && !!state.approval?.valid ? 'user-approved' : state.fresh ? 'source-verified' : 'stale' }); edges.push({ source: artifactId, target: attributeId, type: 'has-attribute', status: state.fresh ? 'source-verified' : 'stale' }); }
    }
    for (const transfer of this._state.transfers.slice(-40)) { const sourceId = `attribute:${transfer.sourceCardId}:${transfer.attributeId}`, targetId = `task:${transfer.targetTaskId}`; if (!nodeIds.has(sourceId)) continue; addNode({ id: targetId, type: 'task', label: transfer.targetTaskId, status: 'candidate' }); edges.push({ source: sourceId, target: targetId, type: 'candidate-transfer', status: 'candidate', reason: transfer.reason }); }
    return { version: 1, nodes, edges, truncated: Object.keys(this._state.cards).length > 20 || this._state.transfers.length > 40, notes: ['Stale source artifacts are excluded from matching.', 'Approval receipts prove an explicit caller-supplied approval record, not identity or target success.'] };
  }
}

function createContextGraph(options) { return new ContextGraph(options); }

module.exports = { ContextGraph, createContextGraph, digest, tokens };
