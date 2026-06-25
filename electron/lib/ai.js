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

// Fixed operating rules for the drafter, prepended to the (evolving) style
// guide. Kept out of the learned prompt so reflection can never erode them.
const DRAFTER_CONTEXT = `You draft text messages as Ronak, in his exact voice, inside a Messages app.

Ronak texts in quick succession — several short messages rather than one long paragraph. So you draft his NEXT SINGLE message, not a whole reply. You are part of an ongoing chain: each time, you propose just the one next thing he'd send, and after he sends it you'll be asked again for the message after that.

Read the LAST line of the transcript to decide what to do:
- If it's from someone else → draft Ronak's reply to it.
- If it's from "Me" (Ronak just texted) → you're continuing his burst. Only draft a follow-up if he's clearly mid-thought — e.g. his last text was a short opener ("yeah", "haha", "one sec", "ok so") or he hasn't finished his point yet. If his last message already completes the point, it's the other person's turn, so give no response.

Giving NO response: output exactly ${NO_REPLY} (those characters, nothing else) whenever no message from Ronak is warranted right now — his turn is complete, the thread has wound down, the last message is a closing/acknowledgement ("sounds good", "👍", "thanks!!"), it's group chatter he wouldn't join, or it's purely informational. Never force a message where none is natural; ${NO_REPLY} is always a valid, good answer.

The STYLE GUIDE below describes his voice — match it exactly.`;

async function generateDraft({ systemPrompt, messages, isGroup, name }) {
  const transcript = buildTranscript(messages, isGroup, name);
  const real = looksLikeName(name) ? name.trim() : null;
  const ctx = isGroup
    ? `This is a group chat${real ? ` with ${real}` : ''}.`
    : `This is a 1:1 conversation${real ? ` with ${real}` : ''}.`;
  const system = `${DRAFTER_CONTEXT}\n\n=== STYLE GUIDE ===\n${systemPrompt}`;
  const user = `${ctx}

----
${transcript}
----

Draft my (Ronak's) next single message per the rules. Output ONLY the message text, or exactly ${NO_REPLY} if no message is warranted.`;
  const res = await callAnthropic({
    model: DRAFT_MODEL,
    system,
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

  const system = `You tune the STYLE GUIDE used to draft text messages in Ronak's voice. You'll see the CURRENT guide and ${samples.length} recent cases. Each case is either (a) a draft compared to what Ronak actually sent or archived, (b) a case where the AI chose NOT to draft (and whether that was right), or (c) a message Ronak wrote himself before any draft existed.

Important context about how the drafter works (don't fight it): Ronak texts in QUICK SUCCESSION — several short messages, not one paragraph. The drafter produces ONE short next message at a time and can output NO_REPLY. So short messages, openers, and partial thoughts are NORMAL and CORRECT — never push the guide toward long, complete, paragraph-style replies.

From the evidence, refine the guide on three axes:
1. VOICE — tone, length, formality, emoji, openings/closings, what he cuts or adds.
2. RELATIONSHIP NUANCE — learn how his style shifts by WHO he's talking to (each case shows "with <name>"; infer the relationship from the name and content). He very likely texts investors / work contacts more measured and considered, close friends more casual, playful and emoji-heavy, and colleagues or family differently again. Identify these patterns and encode them EXPLICITLY as relationship-conditioned guidance (e.g. "With investors/work contacts: …  With close friends: …  With family: …") so drafts adapt to the person rather than being one-size-fits-all.
3. WHEN TO GIVE NO RESPONSE — learn the kinds of messages he leaves unanswered (closings, acknowledgements, group noise, FYIs, his own already-complete turns) so the drafter skips those, while making sure it does NOT skip messages he'd actually answer.

Rewrite the guide to minimize future edits, mis-skips, and missed drafts. Keep what's working; change only what the evidence supports. Do not overfit to one-offs.

Respond with ONLY valid JSON, no markdown fence:
{"reflection": "<2-4 sentences on what the edits reveal and what you changed>", "systemPrompt": "<the full improved system prompt>"}`;

  const user = `CURRENT SYSTEM PROMPT:\n"""\n${systemPrompt}\n"""\n\nRECENT CASES:\n${batch}`;

  const res = await callAnthropic({ model: REFLECT_MODEL, system, messages: [{ role: 'user', content: user }], max_tokens: 4000 });
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
