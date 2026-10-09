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
    this.drafts = readJson(this.draftsFile, { byGuid: {}, skipByGuid: {}, urgentByGuid: {} });
    if (!this.drafts.byGuid) this.drafts = { byGuid: {}, skipByGuid: {}, urgentByGuid: {} };
    if (!this.drafts.skipByGuid) this.drafts.skipByGuid = {};
    if (!this.drafts.urgentByGuid) this.drafts.urgentByGuid = {};
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

  // ---- skip decisions ----
  // The model decided no reply is warranted for the incoming message dated
  // `forDate`. Remembering this (rather than storing a draft) stops us redrafting
  // the same message every tick, while never showing a draft chip.
  getSkip(guid) { return this.drafts.skipByGuid[guid] || null; }
  setSkip(guid, forDate, name, incomingText) {
    this.drafts.skipByGuid[guid] = { forDate, name, incomingText, createdAt: Date.now() };
    writeJson(this.draftsFile, this.drafts);
  }
  clearSkip(guid) {
    if (this.drafts.skipByGuid[guid]) {
      delete this.drafts.skipByGuid[guid];
      writeJson(this.draftsFile, this.drafts);
    }
  }

  // ---- time-sensitive triage ----
  // A classification VERDICT (urgent or not) for the incoming message dated
  // `forDate` — remembering negatives too, so each message is judged once.
  getUrgent(guid) { return this.drafts.urgentByGuid[guid] || null; }
  setUrgent(guid, forDate, urgent, expiresAt) {
    this.drafts.urgentByGuid[guid] = { forDate, urgent, expiresAt, createdAt: Date.now() };
    writeJson(this.draftsFile, this.drafts);
  }
  clearUrgent(guid) {
    if (this.drafts.urgentByGuid[guid]) {
      delete this.drafts.urgentByGuid[guid];
      writeJson(this.draftsFile, this.drafts);
    }
  }

  // ---- priority ranking ----
  // Persistent priority queue for the Messages section: `order` is guids,
  // highest priority first; `byGuid[guid].forDate` records which incoming
  // message was ranked (a newer one triggers re-insertion); `backfilled` marks
  // the one-time merge sort of the backlog as done.
  getPriority() {
    if (!this.drafts.priority) this.drafts.priority = { order: [], byGuid: {}, backfilled: false };
    return this.drafts.priority;
  }
  savePriority() { writeJson(this.draftsFile, this.drafts); }

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
  // Clear the first `n` pending samples (the ones a reflection consumed), or
  // all of them when no count is given.
  clearPending(n) {
    this.learning.pending = n ? this.learning.pending.slice(n) : [];
    writeJson(this.learningFile, this.learning);
  }
}

module.exports = { AiStore, REFLECT_EVERY };
