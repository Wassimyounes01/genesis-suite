'use strict';

const path = require('node:path');

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function id(value, label) { if (typeof value !== 'string' || !ID.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) throw new Error(`${label} must be a simple identifier`); return value; }
function normalized(value) { return path.posix.normalize(String(value).replace(/\\/g, '/')).replace(/\/$/, '').toLowerCase(); }
function overlap(a, b) {
  const left = (a || []).map(normalized), right = (b || []).map(normalized);
  return left.some(x => right.some(y => x === '.' || y === '.' || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
}

class PlanGraph {
  constructor(options = {}) {
    this.maxNodes = Number.isInteger(options.maxNodes) ? Math.max(1, Math.min(1000, options.maxNodes)) : 50;
    this.maxDepth = Number.isInteger(options.maxDepth) ? Math.max(1, Math.min(20, options.maxDepth)) : 10;
    this.capacity = Number.isInteger(options.capacity) ? Math.max(1, Math.min(100, options.capacity)) : 3;
    this.nodes = new Map();
    const initial = options.nodes || [];
    if (!Array.isArray(initial) || initial.length > this.maxNodes) throw new Error('nodes must be a bounded array');
    for (const node of initial) {
      this._validate(node, true);
      if (this.nodes.has(node.id)) throw new Error(`node ${node.id} already exists`);
      this.nodes.set(node.id, clone({ ...node, dependsOn: [...node.dependsOn], owns: [...node.owns] }));
    }
    this._assertReferences();
    const initialCycle = this._cycle();
    if (initialCycle) throw new Error(`dependency cycle at ${initialCycle}`);
    const initialDepth = this._checkDepth();
    if (initialDepth) throw new Error(`dependency depth exceeds bound at ${initialDepth}`);
  }

  _validate(node, replacing = false) {
    if (!node || typeof node !== 'object') throw new Error('node object required');
    id(node.id, 'node id');
    if (typeof node.task !== 'string' || !node.task.trim()) throw new Error(`task required for ${node.id}`);
    if (!Array.isArray(node.dependsOn) || node.dependsOn.some(dep => typeof dep !== 'string' || !ID.test(dep))) throw new Error(`dependencies must be ids for ${node.id}`);
    if (new Set(node.dependsOn).size !== node.dependsOn.length || node.dependsOn.includes(node.id)) throw new Error(`invalid duplicate/self dependency for ${node.id}`);
    if (!Array.isArray(node.owns) || (!node.readOnly && node.owns.length === 0)) throw new Error(`write ownership required for ${node.id}`);
    if (node.owns.length > 100 || node.dependsOn.length > this.maxNodes) throw new Error(`ownership or dependency bound exceeded for ${node.id}`);
    if (node.owns.some(file => typeof file !== 'string' || !file.trim() || path.isAbsolute(file) || path.win32.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) throw new Error(`ownership paths must be workspace-relative for ${node.id}`);
    if (node.readOnly !== true && node.owns.some(file => normalized(file) === '.')) throw new Error(`write ownership cannot be the workspace root for ${node.id}`);
    if (node.plannerDepth != null && (!Number.isInteger(node.plannerDepth) || node.plannerDepth < 1 || node.plannerDepth > this.maxDepth)) throw new Error(`plannerDepth exceeds bound for ${node.id}`);
    if (!replacing && this.nodes.size >= this.maxNodes) throw new Error('plan graph capacity reached');
  }

  _assertReferences() {
    for (const node of this.nodes.values()) for (const dep of node.dependsOn) if (!this.nodes.has(dep)) throw new Error(`unknown dependency ${dep} for ${node.id}`);
  }

  _cycle() {
    const visiting = new Set(), visited = new Set();
    const visit = current => {
      if (visiting.has(current)) return true;
      if (visited.has(current)) return false;
      visiting.add(current);
      const node = this.nodes.get(current);
      if (node && node.dependsOn.some(visit)) return true;
      visiting.delete(current); visited.add(current); return false;
    };
    return [...this.nodes.keys()].find(visit) || null;
  }

  _checkDepth() {
    const depth = new Map();
    const visit = nodeId => {
      if (depth.has(nodeId)) return depth.get(nodeId);
      const node = this.nodes.get(nodeId);
      const value = 1 + Math.max(0, ...(node.dependsOn || []).map(visit));
      depth.set(nodeId, value);
      return value;
    };
    for (const nodeId of this.nodes.keys()) if (visit(nodeId) > this.maxDepth) return nodeId;
    return null;
  }

  add(node) {
    this._validate(node);
    if (this.nodes.has(node.id)) throw new Error(`node ${node.id} already exists`);
    this.nodes.set(node.id, clone({ ...node, dependsOn: [...node.dependsOn], owns: [...node.owns] }));
    try { this._assertReferences(); const cycle = this._cycle(); if (cycle) throw new Error(`dependency cycle at ${cycle}`); const depth = this._checkDepth(); if (depth) throw new Error(`dependency depth exceeds bound at ${depth}`); } catch (error) { this.nodes.delete(node.id); throw error; }
    return this.get(node.id);
  }

  replace(node) {
    this._validate(node, true);
    if (!this.nodes.has(node.id)) throw new Error(`node ${node.id} not found`);
    const before = this.nodes.get(node.id);
    this.nodes.set(node.id, clone({ ...node, dependsOn: [...node.dependsOn], owns: [...node.owns] }));
    try { this._assertReferences(); const cycle = this._cycle(); if (cycle) throw new Error(`dependency cycle at ${cycle}`); const depth = this._checkDepth(); if (depth) throw new Error(`dependency depth exceeds bound at ${depth}`); } catch (error) { this.nodes.set(node.id, before); throw error; }
    return this.get(node.id);
  }

  get(nodeId) { id(nodeId, 'node id'); return this.nodes.has(nodeId) ? clone(this.nodes.get(nodeId)) : null; }
  list() { return [...this.nodes.values()].map(clone); }

  topologicalOrder() {
    this._assertReferences();
    const indegree = new Map([...this.nodes.keys()].map(key => [key, 0]));
    const children = new Map([...this.nodes.keys()].map(key => [key, []]));
    for (const node of this.nodes.values()) for (const dep of node.dependsOn) { indegree.set(node.id, indegree.get(node.id) + 1); children.get(dep).push(node.id); }
    const ready = [...indegree].filter(([, count]) => count === 0).map(([key]) => key).sort();
    const ordered = [];
    while (ready.length) { const current = ready.shift(); ordered.push(current); for (const child of children.get(current).sort()) if (indegree.set(child, indegree.get(child) - 1).get(child) === 0) ready.push(child); ready.sort(); }
    if (ordered.length !== this.nodes.size) throw new Error('dependency cycle detected');
    return ordered;
  }

  ready(completed = [], running = []) {
    this._assertReferences();
    const done = new Set(completed), active = new Set(running);
    for (const current of [...done, ...active]) if (!this.nodes.has(current)) throw new Error(`unknown execution node ${current}`);
    if (active.size > this.capacity) throw new Error('running work exceeds configured capacity');
    const selected = [];
    for (const node of this.nodes.values()) {
      if (done.has(node.id) || active.has(node.id) || !node.dependsOn.every(dep => done.has(dep))) continue;
      if ([...active, ...selected.map(item => item.id)].some(other => overlap(node.owns, this.nodes.get(other).owns))) continue;
      if (selected.length + active.size >= this.capacity) break;
      selected.push(node);
    }
    return { ready: selected.map(clone), running: [...active], capacity: this.capacity, blocked: [...this.nodes.keys()].filter(nodeId => !done.has(nodeId) && !active.has(nodeId) && !selected.some(item => item.id === nodeId)) };
  }

  validate() {
    try { this._assertReferences(); const cycle = this._cycle(); if (cycle) return { ok: false, errors: [`dependency cycle at ${cycle}`] }; const depth = this._checkDepth(); if (depth) return { ok: false, errors: [`dependency depth exceeds bound at ${depth}`] }; this.topologicalOrder(); return { ok: true, nodes: this.nodes.size, capacity: this.capacity, order: this.topologicalOrder() }; }
    catch (error) { return { ok: false, errors: [error.message] }; }
  }
}

function createPlanGraph(options) { return new PlanGraph(options); }
function validateGraph(nodes, options) { try { const graph = createPlanGraph({ ...(options || {}), nodes }); return graph.validate(); } catch (error) { return { ok: false, errors: [error.message] }; } }

module.exports = { PlanGraph, createPlanGraph, validateGraph, ownershipOverlaps: overlap };
