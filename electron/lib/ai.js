'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const API_URL = 'https://api.anthropic.com/v1/messages';
const DRAFT_MODEL = 'claude-haiku-4-5-20251001';
const REFLECT_MODEL = 'claude-sonnet-4-6';

// Resolve the API key. A Finder-launched app doesn't inherit shell exports, so
// fall back to parsing the user's shell rc files.
let cachedKey;
function keyFilePaths() {
  const base = path.join(os.homedir(), 'Library', 'Application Support');
  return ['Messages Inbox', 'messages-inbox'].map((d) => path.join(base, d, 'anthropic-key'));
}
function getApiKey() {
  if (cachedKey !== undefined) return cachedKey;
  if (process.env.ANTHROPIC_API_KEY) { cachedKey = process.env.ANTHROPIC_API_KEY; return cachedKey; }
  // A dedicated, gitignored key file takes priority over shell rc files so the
  // app can use a key without touching the user's shell config.
  for (const f of keyFilePaths()) {
    try {
      const k = fs.readFileSync(f, 'utf8').trim();
      if (k) { cachedKey = k; return cachedKey; }
    } catch { /* missing */ }
  }
  const files = ['.zshrc', '.zprofile', '.zshenv', '.bash_profile', '.profile'].map((f) => path.join(os.homedir(), f));
  for (const f of files) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?/);
      if (m) { cachedKey = m[1].trim(); return cachedKey; }
    } catch { /* missing file */ }
  }
  cachedKey = null;
  return cachedKey;
}

function hasKey() { return !!getApiKey(); }

function classifyError(status, body) {
  const msg = (body && body.error && body.error.message) || '';
  if (/credit balance|too low|billing/i.test(msg)) return 'billing';
  if (status === 401 || /authentication|invalid x-api-key/i.test(msg)) return 'auth';
  if (status === 429 || /rate limit/i.test(msg)) return 'rate';
  return 'other';
}

async function callAnthropic({ model, system, messages, max_tokens = 400, temperature = 0.7 }) {
  const key = getApiKey();
  if (!key) return { ok: false, errorType: 'nokey', error: 'No API key found' };
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens, temperature, system, messages }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, errorType: classifyError(res.status, body), error: (body.error && body.error.message) || `HTTP ${res.status}` };
    }
    const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, errorType: 'network', error: String((e && e.message) || e) };
  }
}

// Build a compact transcript for the drafting prompt.
function buildTranscript(messages, isGroup) {
  return messages
    .filter((m) => (m.text && m.text.trim()) || m.attachments.length)
    .slice(-14)
    .map((m) => {
      const who = m.fromMe ? 'Me' : (isGroup ? (m.sender || 'Them') : 'Them');
      const body = m.text && m.text.trim() ? m.text.trim() : '[attachment]';
      return `${who}: ${body}`;
    })
    .join('\n');
}

async function generateDraft({ systemPrompt, messages, isGroup }) {
  const transcript = buildTranscript(messages, isGroup);
  const user = `Here's a text conversation${isGroup ? ' (a group chat)' : ''}. Draft my (Ronak's) next reply to the most recent message, in my exact voice. Output ONLY the message text.\n\n----\n${transcript}\n----`;
  return callAnthropic({
    model: DRAFT_MODEL,
    system: systemPrompt,
    messages: [{ role: 'user', content: user }],
    max_tokens: 320,
    temperature: 0.7,
  });
}

// Reflection: given the current prompt and a batch of (draft -> what Ronak
// actually sent) samples, propose an improved style prompt.
async function reflect({ systemPrompt, samples }) {
  const batch = samples.map((s, i) => {
    const outcome = s.archived
      ? '[ARCHIVED WITHOUT SENDING — the draft was unwanted; he chose not to reply at all]'
      : (s.sent || '').trim() || '[sent empty]';
    return `### Sample ${i + 1}${s.name ? ` (with ${s.name})` : ''}\nThey said: ${(s.incomingText || '').slice(0, 400)}\nAI draft: ${(s.draft || '').slice(0, 600)}\nRonak actually sent: ${outcome}`;
  }).join('\n\n');

  const system = `You tune a system prompt that drafts text-message replies in Ronak's voice. You'll see the CURRENT prompt and ${samples.length} recent cases comparing the AI's draft to what Ronak actually sent (or that he archived it without replying). Identify the consistent patterns in how he edits — tone, length, formality, emoji, openings, what he cuts or adds — and rewrite the prompt to minimize future edits. Keep everything that's working; change only what the evidence supports. Do not overfit to one-offs.

Respond with ONLY valid JSON, no markdown fence:
{"reflection": "<2-4 sentences on what the edits reveal and what you changed>", "systemPrompt": "<the full improved system prompt>"}`;

  const user = `CURRENT SYSTEM PROMPT:\n"""\n${systemPrompt}\n"""\n\nRECENT CASES:\n${batch}`;

  const res = await callAnthropic({ model: REFLECT_MODEL, system, messages: [{ role: 'user', content: user }], max_tokens: 3000, temperature: 0.4 });
  if (!res.ok) return res;
  try {
    const jsonText = res.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText);
    if (!parsed.systemPrompt || !parsed.reflection) throw new Error('missing fields');
    return { ok: true, reflection: parsed.reflection, systemPrompt: parsed.systemPrompt };
  } catch (e) {
    return { ok: false, errorType: 'parse', error: 'Could not parse reflection output' };
  }
}

module.exports = { hasKey, getApiKey, generateDraft, reflect, DRAFT_MODEL, REFLECT_MODEL };
