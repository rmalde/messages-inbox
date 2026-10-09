'use strict';

// Priority ranking of inbox conversations via pairwise comparisons from a tiny
// OpenRouter model (jev). The Messages section becomes a priority queue: a
// one-time merge sort puts the backlog in order, then each new incoming
// message binary-searches its slot — O(log n) comparisons per message.

const fs = require('fs');
const os = require('os');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const RANK_MODEL = 'typesafe/jev-router';

let cachedKey;
function getKey() {
  if (cachedKey !== undefined) return cachedKey;
  if (process.env.OPENROUTER_API_KEY) { cachedKey = process.env.OPENROUTER_API_KEY; return cachedKey; }
  const files = ['.zshrc', '.zprofile', '.zshenv', '.bash_profile', '.profile'].map((f) => os.homedir() + '/' + f);
  for (const f of files) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/OPENROUTER_API_KEY\s*=\s*"?([^"\n]+)"?/);
      if (m) { cachedKey = m[1].trim(); return cachedKey; }
    } catch { /* missing file */ }
  }
  cachedKey = null;
  return cachedKey;
}

function hasKey() { return !!getKey(); }

// Ronak's rubric, verbatim in spirit — the whole ordering policy lives here.
const RUBRIC = `You prioritize incoming text conversations for Ronak, a startup founder (CEO of Trajectory, an AI startup). Given two conversations A and B, decide which should sit HIGHER in his inbox.

Priority tiers, highest to lowest:
1. INTROS — someone connecting Ronak to another person (very often a fresh group chat created to introduce two people). ALWAYS the highest priority.
2. Anyone from SEQUOIA — equally highest priority.
3. HIRING conversations — specific candidates, interviews, offers, closing someone. Always high.
4. General RECRUITING — sourcing, recruiters, pipeline, referral chatter.
5. Any other work-related texts.
6. Not work related — friends, family, plans: middle priority.
7. Someone else's company and how Ronak can help THEM out: lower priority.
8. Spam, promos, automated notifications, unknown numbers: lowest.

If both fall in the same tier, the conversation with more recent activity goes higher.
Reply with exactly one letter: A or B. Nothing else.`;

function classifyError(status, body) {
  const msg = (body && body.error && (body.error.message || body.error)) || '';
  if (status === 402 || /credit|payment|balance/i.test(String(msg))) return 'billing';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  return 'other';
}

async function callJev(user) {
  const key = getKey();
  if (!key) return { ok: false, errorType: 'nokey', error: 'No OPENROUTER_API_KEY found' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: RANK_MODEL,
          temperature: 0,
          max_tokens: 8,
          messages: [
            { role: 'system', content: RUBRIC },
            { role: 'user', content: user },
          ],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorType = classifyError(res.status, body);
        if (errorType === 'rate' && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        return { ok: false, errorType, error: `HTTP ${res.status}: ${JSON.stringify(body.error || body).slice(0, 200)}` };
      }
      const text = (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
      return { ok: true, text };
    } catch (e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
      return { ok: false, errorType: 'network', error: String((e && e.message) || e) };
    }
  }
  return { ok: false, errorType: 'other', error: 'unreachable' };
}

// One conversation as a compact card the model can judge.
function buildCard(convo, messages, now = Date.now()) {
  const ageH = convo.lastDate ? Math.max(0, Math.round((now - convo.lastDate) / 3600000)) : null;
  const age = ageH == null ? '' : ageH < 1 ? 'active <1h ago' : ageH < 48 ? `active ${ageH}h ago` : `active ${Math.round(ageH / 24)}d ago`;
  const head = `"${convo.name}"${convo.isGroup ? ' (group chat)' : ''}${age ? ' — ' + age : ''}`;
  const lines = (messages || [])
    .filter((m) => (m.text && m.text.trim()) || (m.attachments && m.attachments.length))
    .slice(-6)
    .map((m) => {
      const who = m.fromMe ? 'Ronak' : (convo.isGroup ? (m.sender || 'Them') : (convo.name || 'Them'));
      const body = m.text && m.text.trim() ? m.text.trim().slice(0, 180) : '[attachment]';
      return `${who}: ${body}`;
    });
  return head + '\n' + (lines.length ? lines.join('\n') : '(no recent text)');
}

// Which of two cards ranks higher? -> 'A' | 'B'
async function compareCards(cardA, cardB) {
  const res = await callJev(`A:\n${cardA}\n\nB:\n${cardB}\n\nWhich belongs higher in the inbox? Reply A or B.`);
  if (!res.ok) return res;
  const t = (res.text || '').trim().toUpperCase();
  const m = t.match(/\b([AB])\b/);
  if (!m) return { ok: false, errorType: 'parse', error: 'unparseable: ' + t.slice(0, 40) };
  return { ok: true, winner: m[1] };
}

// Merge sort with an async comparator; halves sort in parallel so wall time is
// far below the comparison count. cmp(a, b) resolves 'A' when a ranks higher.
async function mergeSort(list, cmp) {
  if (list.length <= 1) return list.slice();
  const mid = list.length >> 1;
  const [l, r] = await Promise.all([
    mergeSort(list.slice(0, mid), cmp),
    mergeSort(list.slice(mid), cmp),
  ]);
  const out = [];
  let i = 0, j = 0;
  while (i < l.length && j < r.length) {
    out.push((await cmp(l[i], r[j])) === 'A' ? l[i++] : r[j++]);
  }
  while (i < l.length) out.push(l[i++]);
  while (j < r.length) out.push(r[j++]);
  return out;
}

// Binary-search the candidate's slot in an already-ranked list.
// ranked: array of items; returns the insertion index.
async function binaryInsertIndex(ranked, candidate, cmp) {
  let lo = 0, hi = ranked.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((await cmp(candidate, ranked[mid])) === 'A') hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

module.exports = { hasKey, buildCard, compareCards, mergeSort, binaryInsertIndex, RANK_MODEL };
