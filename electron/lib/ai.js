'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const API_URL = 'https://api.anthropic.com/v1/messages';
const DRAFT_MODEL = 'claude-haiku-4-5-20251001';
const REFLECT_MODEL = 'claude-opus-4-8';

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

async function callAnthropic({ model, system, messages, max_tokens = 400, temperature }) {
  const key = getApiKey();
  if (!key) return { ok: false, errorType: 'nokey', error: 'No API key found' };
  try {
    const reqBody = { model, max_tokens, system, messages };
    if (temperature != null) reqBody.temperature = temperature; // some models reject it
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(reqBody),
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

// True for a resolved contact name, false for a bare phone/email handle.
function looksLikeName(s) {
  return !!s && /[A-Za-z]/.test(s) && !/^\+?\d[\d\s().-]*$/.test(s) && !s.includes('@');
}

// Build a compact transcript for the drafting prompt. In 1:1s the counterpart
// is labelled by name (not "Them"); in groups each line already carries the
// sender's resolved name.
function buildTranscript(messages, isGroup, name) {
  const other = !isGroup && looksLikeName(name) ? name.trim() : null;
  return messages
    .filter((m) => (m.text && m.text.trim()) || m.attachments.length)
    .slice(-24) // at least the last ~20 real messages for context
    .map((m) => {
      const who = m.fromMe ? 'Me' : (isGroup ? (m.sender || 'Them') : (other || 'Them'));
      const body = m.text && m.text.trim() ? m.text.trim() : '[attachment]';
      return `${who}: ${body}`;
    })
    .join('\n');
}

const NO_REPLY = 'NO_REPLY';

async function generateDraft({ systemPrompt, messages, isGroup, name }) {
  const transcript = buildTranscript(messages, isGroup, name);
  const real = looksLikeName(name) ? name.trim() : null;
  const ctx = isGroup
    ? `This is a group chat${real ? ` with ${real}` : ''}.`
    : `This is a 1:1 conversation${real ? ` with ${real}` : ''}.`;
  // Who sent the most recent message (matches the last transcript line) — used
  // to keep the drafter from answering Ronak's own messages as if it were the
  // other person.
  const considered = messages.filter((m) => (m.text && m.text.trim()) || m.attachments.length);
  const last = considered[considered.length - 1];
  const lastFromMe = !!(last && last.fromMe);
  const lastWho = lastFromMe ? 'me (Ronak — labelled "Me")' : (isGroup && last && last.sender ? last.sender : (real || 'the other person'));
  // No fixed preamble — all guidance (voice, chain behaviour, when to skip)
  // lives in the system prompt, which is seeded in v0 and free to evolve.
  const turnRule = lastFromMe
    ? `The last message above is already mine, so decide between two options:
- CONTINUE as me if my last message is incomplete or an opener clearly leading into more — write the very next thing I'd text (e.g. after "ok so we were thinking" → the rest of the thought; after "yeah one sec" → the thing I follow up with).
- Otherwise output exactly ${NO_REPLY}: if my last message is a complete thought, or a question I asked THEM (e.g. "neil mehta next?", "what time works?"), it's their turn now — never answer my own message as if I were the other person.`
    : `The last message above is from ${lastWho} — draft my reply to it.`;
  const user = `${ctx}

----
${transcript}
----

You write ONLY my (Ronak's, labelled "Me:") own messages — never the other person's words. ${turnRule}

Output ONLY my next message text, or exactly ${NO_REPLY} if no message from me is warranted right now.`;
  const res = await callAnthropic({
    model: DRAFT_MODEL,
    system: systemPrompt,
    messages: [{ role: 'user', content: user }],
    max_tokens: 320,
    temperature: 0.7,
  });
  if (res.ok) {
    const stripped = (res.text || '').replace(/[\s."'`*]+$/g, '').trim();
    if (!stripped || stripped.toUpperCase() === NO_REPLY) return { ok: true, skip: true };
  }
  return res;
}

// Reflection: given the current prompt and a batch of (draft -> what Ronak
// actually sent) samples, propose an improved style prompt.
async function reflect({ systemPrompt, samples }) {
  const batch = samples.map((s, i) => {
    const head = `### Sample ${i + 1}${s.name ? ` (with ${s.name})` : ''}\nThey said: ${(s.incomingText || '').slice(0, 400)}`;
    if (s.noGen) {
      // No draft had been produced; Ronak wrote this himself. A voice example
      // and a signal the drafter should have something ready in this situation.
      return `${head}\nAI had NOT drafted anything yet.\nRonak wrote: ${(s.sent || '').slice(0, 600)}`;
    }
    if (s.skipped) {
      // The AI chose not to draft. Did Ronak agree (no reply / archived) or not?
      const verdict = s.archived || !(s.sent || '').trim()
        ? 'Ronak also did NOT send anything (archived / left it) — skipping was the RIGHT call.'
        : `Ronak DID send: ${(s.sent || '').slice(0, 600)} — a draft would have helped; skipping was WRONG here.`;
      return `${head}\nAI decided: NO DRAFT (judged no message needed)\nOutcome: ${verdict}`;
    }
    const outcome = s.archived
      ? '[ARCHIVED WITHOUT SENDING — the draft was unwanted; he chose not to reply at all]'
      : (s.sent || '').trim() || '[sent empty]';
    return `${head}\nAI draft: ${(s.draft || '').slice(0, 600)}\nRonak actually sent: ${outcome}`;
  }).join('\n\n');

  const system = `You maintain the STYLE GUIDE used to draft Ronak's text messages. You'll see the CURRENT guide and ${samples.length} recent cases. Each case is either (a) a draft vs what Ronak actually sent or archived, (b) a case where the AI chose NOT to draft (and whether that was right), or (c) a message Ronak wrote himself before any draft existed.

How the drafter works (don't fight it): Ronak texts in QUICK SUCCESSION — several short messages, not one paragraph. The drafter writes ONE short next message at a time and can output NO_REPLY. Short messages, openers, and partial thoughts are NORMAL and CORRECT — never push the guide toward long paragraph-style replies.

ORGANIZE THE GUIDE AROUND WHO HE'S TALKING TO. Maintain an explicit, stable taxonomy of sender categories and figure out which one each case belongs to (every case shows "with <name>" — infer from the name and the content). Start from categories like: fellow founders, close friends, investors/VCs, potential hires / candidates / recruiting, work colleagues/teammates, family. DISCOVER and add other categories the evidence reveals (e.g. press, customers, acquaintances) — don't force everyone into two buckets. For each category, capture how his voice differs (tone, length, formality, emoji, openings/closings, what he cuts or adds) and when he gives no response.

REFINE METHODICALLY AND INCREMENTALLY. Treat the current guide as the accumulated model of Ronak. Adjust only what THIS batch of evidence supports; keep everything else stable. Do NOT rewrite wholesale or swing the whole voice between two modes from one batch to the next — the goal is to converge on the underlying per-category patterns, not flip-flop. When a case contradicts the current guide, prefer a small, well-scoped refinement to the relevant category over a global change. Don't overfit to one-offs.

Also keep learning WHEN TO GIVE NO RESPONSE (closings, acknowledgements, group noise, FYIs, his own already-complete turns) without skipping messages he'd actually answer.

Keep the guide well-organized (a short general-voice section, then a clear section per category) and reasonably concise — refine, don't bloat.

OUTPUT FORMAT (this is not JSON — follow it exactly):
First write 2-4 sentences of analysis: what this batch revealed and what you changed.
Then a line containing exactly:
===GUIDE===
Then the full updated style guide as raw text (no JSON, no code fences, no quoting).`;

  const user = `CURRENT STYLE GUIDE:\n"""\n${systemPrompt}\n"""\n\nRECENT CASES:\n${batch}`;

  const res = await callAnthropic({ model: REFLECT_MODEL, system, messages: [{ role: 'user', content: user }], max_tokens: 16000 });
  if (!res.ok) return res;
  const idx = res.text.indexOf('===GUIDE===');
  if (idx === -1) return { ok: false, errorType: 'parse', error: 'Reflection output missing the ===GUIDE=== marker' };
  const reflection = res.text.slice(0, idx).trim();
  const newPrompt = res.text.slice(idx + '===GUIDE==='.length).replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  if (!newPrompt || newPrompt.length < 200) return { ok: false, errorType: 'parse', error: 'Reflection produced no usable guide' };
  return { ok: true, reflection: reflection || 'Updated the style guide.', systemPrompt: newPrompt };
}

module.exports = { hasKey, getApiKey, generateDraft, reflect, DRAFT_MODEL, REFLECT_MODEL };
