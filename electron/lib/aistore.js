'use strict';

const fs = require('fs');
const path = require('path');
const V0_PROMPT = require('./style-prompt-v0');

const REFLECT_EVERY = 20; // sent/archived samples per prompt evolution

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch { /* best effort */ }
}

// Stores AI prompt versions, per-chat drafts, and the learning sample queue.
class AiStore {
  constructor(dir) {
    this.promptsFile = path.join(dir, 'ai-prompts.json');
    this.draftsFile = path.join(dir, 'ai-drafts.json');
    this.learningFile = path.join(dir, 'ai-learning.json');

    this.prompts = readJson(this.promptsFile, null);
    if (!this.prompts || !Array.isArray(this.prompts.versions) || !this.prompts.versions.length) {
      this.prompts = { versions: [{ version: 0, createdAt: Date.now(), reflection: null, systemPrompt: V0_PROMPT, sampleCount: 0 }] };
      writeJson(this.promptsFile, this.prompts);
    }
    this.drafts = readJson(this.draftsFile, { byGuid: {} });
    if (!this.drafts.byGuid) this.drafts = { byGuid: {} };
    this.learning = readJson(this.learningFile, { pending: [], recent: [], totalSamples: 0 });
    if (!this.learning.pending) this.learning = { pending: [], recent: [], totalSamples: 0 };
    if (!this.learning.recent) this.learning.recent = [];
  }

  // ---- prompts ----
  currentPrompt() {
    const v = this.prompts.versions[this.prompts.versions.length - 1];
    return v.systemPrompt;
  }
  versions() { return this.prompts.versions; }
  addVersion({ reflection, systemPrompt, sampleCount }) {
    this.prompts.versions.push({
      version: this.prompts.versions.length,
      createdAt: Date.now(),
      reflection,
      systemPrompt,
      sampleCount,
    });
    writeJson(this.promptsFile, this.prompts);
  }

  // ---- drafts ----
  getDraft(guid) { return this.drafts.byGuid[guid] || null; }
  hasDraft(guid) { return !!this.drafts.byGuid[guid]; }
  draftGuids() { return Object.keys(this.drafts.byGuid); }
  setDraft(guid, obj) {
    if (!obj || !obj.text) return;
    this.drafts.byGuid[guid] = { createdAt: Date.now(), ...obj };
    writeJson(this.draftsFile, this.drafts);
  }
  deleteDraft(guid) {
    if (this.drafts.byGuid[guid]) {
      delete this.drafts.byGuid[guid];
      writeJson(this.draftsFile, this.drafts);
    }
  }

  // ---- learning ----
  // Returns true if the pending queue has reached the reflection threshold.
  recordSample(sample) {
    const s = { ...sample, ts: Date.now() };
    this.learning.pending.push(s);
    this.learning.recent.push(s);
    if (this.learning.recent.length > 60) this.learning.recent = this.learning.recent.slice(-60);
    this.learning.totalSamples += 1;
    writeJson(this.learningFile, this.learning);
    return this.learning.pending.length >= REFLECT_EVERY;
  }
  pendingSamples() { return this.learning.pending; }
  pendingCount() { return this.learning.pending.length; }
  totalSamples() { return this.learning.totalSamples; }
  // Rolling history of recent edits (survives reflection resets), newest first.
  recentSamples(n = 20) { return this.learning.recent.slice(-n).reverse(); }
  clearPending() {
    this.learning.pending = [];
    writeJson(this.learningFile, this.learning);
  }
}

module.exports = { AiStore, REFLECT_EVERY };
