'use strict';

const { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('./lib/db');
const { Store } = require('./lib/store');
const { sendMessage, revealGroupByName } = require('./lib/send');
const { getContactImage } = require('./lib/contacts');
const { AiStore, REFLECT_EVERY } = require('./lib/aistore');
const ai = require('./lib/ai');
const rank = require('./lib/rank');

// When run from source (`electron .`) the app would otherwise show as
// "Electron" with the default icon. Force the real identity.
app.setName('Messages Inbox');

let store;
let aiStore;
let aiStatus = { hasKey: false, lastError: null, lastErrorType: null, reflecting: false };
let aiReflectCooldownUntil = 0;
let aiDraftCooldownUntil = 0; // back off drafting after billing/auth failures
let aiLastGenAt = 0;          // throttle expensive generation to GEN_EVERY_MS
let aiGenBusy = false;        // guard against overlapping generation passes
let rankBusy = false;         // a backlog merge sort is running
let rankCooldownUntil = 0;    // back off ranking after billing/auth failures
const rankCards = new Map();  // guid -> { forDate, card } comparison snippets
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open any link in the user's default browser (e.g. their logged-in Chrome
  // window) rather than spawning a blank, profile-less Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const here = process.env.VITE_DEV ? 'http://127.0.0.1:5173' : 'file://';
    if (!url.startsWith(here)) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });

  if (process.env.VITE_DEV) {
    win.loadURL('http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{ role: 'appMenu' }]
      : []),
    { role: 'editMenu' },
    {
      label: 'Conversation',
      submenu: [
        {
          label: 'Archive Conversation',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => win && win.webContents.send('archive-current'),
        },
        {
          label: 'Mark Read',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => win && win.webContents.send('mark-read-current'),
        },
        { type: 'separator' },
        {
          label: 'Next Conversation',
          accelerator: 'CmdOrCtrl+Down',
          click: () => win && win.webContents.send('nav', 1),
        },
        {
          label: 'Previous Conversation',
          accelerator: 'CmdOrCtrl+Up',
          click: () => win && win.webContents.send('nav', -1),
        },
        { type: 'separator' },
        {
          label: 'Open in Messages',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => win && win.webContents.send('open-in-messages'),
        },
        {
          label: 'Toggle Their Turn',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => win && win.webContents.send('toggle-turn'),
        },
        {
          label: 'Toggle Archived View',
          click: () => win && win.webContents.send('toggle-archived-view'),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'inbox-store.json'));
  store.onExternalChange = () => { if (win) win.webContents.send('ai-changed'); };
  aiStore = new AiStore(app.getPath('userData'));
  aiStatus.hasKey = ai.hasKey();
  // Custom dock icon when launched from source (the packaged build already
  // has its icns baked into the bundle).
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon-1024.png');
    if (app.dock && fs.existsSync(iconPath)) app.dock.setIcon(iconPath);
  } catch { /* ignore */ }
  buildMenu();
  createWindow();

  // AI drafting loop — generate drafts for today's awaiting-reply chats and
  // capture edits for learning. Runs only if an API key is available.
  if (aiStatus.hasKey) {
    setTimeout(aiTick, 2000);
    setInterval(aiTick, SWEEP_MS);
  }

  nativeTheme.on('updated', () => {
    if (win) win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ------------------------------------------------------------------

const CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

function diagnoseAccess() {
  // chat.db always exists on a Mac that has used Messages; if we can't read it
  // the cause is almost always missing Full Disk Access for this app.
  try {
    fs.accessSync(CHAT_DB, fs.constants.R_OK);
    return { canRead: true };
  } catch {
    return { canRead: false };
  }
}

ipcMain.handle('conversations:list', async () => {
  try {
    const convos = store.decorate(await db.getConversations());
    if (aiStore) {
      const now = Date.now();
      for (const c of convos) {
        c.hasDraft = aiStore.hasDraft(c.guid);
        const u = aiStore.getUrgent(c.guid);
        const live = u && (u.expiresAt ? now < u.expiresAt : now - u.forDate < URGENT_TTL_MS);
        c.timeSensitive = !!(u && u.urgent && live && u.forDate === c.lastIncomingDate && !c.lastFromMe);
      }
      const rankIdx = new Map(aiStore.getPriority().order.map((g, i) => [g, i]));
      for (const c of convos) c.priorityRank = rankIdx.has(c.guid) ? rankIdx.get(c.guid) : null;
    }
    return { ok: true, convos };
  } catch (e) {
    const diag = diagnoseAccess();
    return { ok: false, needsAccess: !diag.canRead, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('access:check', async () => diagnoseAccess());

ipcMain.handle('access:openSettings', async () => {
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
  return true;
});

ipcMain.handle('messages:reveal', async (_e, name) => {
  return revealGroupByName(name);
});

ipcMain.handle('open:accessibility', async () => {
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  return true;
});

ipcMain.handle('open:external', async (_e, url) => {
  // Web links plus the Apple communication schemes our UI offers.
  if (typeof url === 'string' && /^(https?:\/\/|facetime(-audio)?:|imessage:)/i.test(url)) {
    await shell.openExternal(url);
  }
  return true;
});

ipcMain.handle('messages:list', async (_e, chatId) => {
  return db.getMessages(chatId);
});

ipcMain.handle('chat:open', async (_e, guid) => {
  store.markOpened(guid, Date.now());
  return true;
});

ipcMain.handle('chat:archive', async (_e, guid) => {
  store.archive(guid, Date.now());
  // Learning capture involves a sqlite round-trip — run it off the response
  // path so archiving feels instant in the UI.
  captureArchiveSignal(guid);
  if (aiStore) aiStore.clearUrgent(guid);
  return true;
});

async function captureArchiveSignal(guid) {
  const draft = aiStore && aiStore.getDraft(guid);
  const skip = aiStore && aiStore.getSkip(guid);
  if (draft || skip) {
    // Only learn if the draft/skip is still CURRENT for the conversation tail.
    // If Ronak replied elsewhere since, the tail moved on (forDate !== last) and
    // he never acted on this draft — so it isn't real signal.
    const last = await db.lastMessage(guid).catch(() => null);
    const lastDate = last ? last.date : null;
    if (draft && draft.forDate === lastDate) {
      // Saw the draft, archived instead of sending -> the draft was unwanted.
      const reached = aiStore.recordSample({ guid, name: draft.name, incomingText: draft.incomingText, draft: draft.text, sent: '', archived: true });
      if (reached) maybeReflect();
    } else if (skip && skip.forDate === lastDate) {
      // Archived a chat the model chose to skip -> the skip was the right call.
      const reached = aiStore.recordSample({ guid, name: skip.name || '', incomingText: skip.incomingText || '', draft: '', sent: '', skipped: true, archived: true });
      if (reached) maybeReflect();
    }
    aiStore.deleteDraft(guid);
    aiStore.clearSkip(guid);
  }
}

ipcMain.handle('chat:setTurn', async (_e, { guid, section, forDate }) => {
  // section null clears the override (back to natural placement)
  if (section) store.setTurnOverride(guid, section, forDate);
  else store.clearTurnOverride(guid);
  return true;
});

ipcMain.handle('chat:unarchive', async (_e, guid) => {
  store.unarchive(guid);
  return true;
});

ipcMain.handle('message:send', async (_e, payload) => {
  try {
    const draft = aiStore && aiStore.getDraft(payload.guid);
    const skip = aiStore && aiStore.getSkip(payload.guid);
    const result = await sendMessage(payload);
    // Sending in our app is always genuine signal (Ronak saw whatever we had).
    // Each message he sends becomes one learning sample.
    if (aiStore) {
      let reached = false;
      if (draft) {
        // Had a draft -> compare it to what he actually sent (an edit).
        reached = aiStore.recordSample({ guid: payload.guid, name: draft.name, incomingText: draft.incomingText, draft: draft.text, sent: payload.text, archived: false });
        aiStore.deleteDraft(payload.guid);
      } else if (skip) {
        // We'd judged "no message" but he sent one -> should have drafted.
        reached = aiStore.recordSample({ guid: payload.guid, name: skip.name || '', incomingText: skip.incomingText || '', draft: '', sent: payload.text, skipped: true, archived: false });
        aiStore.clearSkip(payload.guid);
      } else {
        // Nothing was on offer (not drafted yet) -> a voice example / missed draft.
        reached = aiStore.recordSample({ guid: payload.guid, name: '', incomingText: '', draft: '', sent: payload.text, noGen: true, archived: false });
      }
      if (reached) maybeReflect();
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- AI: drafting + learning loop ----------------------------------------

// Rolling window: draft for chats active within this long. New messages fall
// inside it automatically.
const DRAFT_WINDOW_MS = 36 * 60 * 60 * 1000;
// After one of Ronak's OWN messages, only keep drafting follow-ups for this
// long — the rapid-succession window. Past it he's done; it's their turn.
const CONT_WINDOW_MS = 15 * 60 * 1000;
const SWEEP_MS = 3000;          // how often we clear stale drafts (cheap, no API)
const GEN_EVERY_MS = 9000;      // how often we run the (throttled) generation pass
const URGENT_WINDOW_MS = 6 * 60 * 60 * 1000;   // classify messages this fresh
const URGENT_TTL_MS = 12 * 60 * 60 * 1000;     // 'today' relevance expires

// Runs every SWEEP_MS. Always does the cheap staleness sweep so a brand-new
// message (from them, or from Ronak on another device) clears the now-outdated
// draft promptly. Generation is throttled to GEN_EVERY_MS and guarded so passes
// don't overlap.
async function aiTick() {
  if (!aiStore || aiStatus.reflecting) return;
  let convos;
  try {
    convos = store.decorate(await db.getConversations());
  } catch { return; }

  const now = Date.now();

  // 1) Drop stale drafts/skips. A draft/skip is keyed to the conversation tail
  //    (`forDate` = the last message at generation time); once the tail changes
  //    — a new incoming message, or one Ronak sent (here or from another app) —
  //    it no longer applies and is cleared so we never surface an off-by-one
  //    draft. We do NOT learn here: learning only happens for actions taken IN
  //    our app (the message:send and chat:archive handlers), never from messages
  //    that appeared from another device.
  let changed = false;
  for (const c of convos) {
    const draft = aiStore.getDraft(c.guid);
    const skip = aiStore.getSkip(c.guid);
    if (draft && draft.forDate !== c.lastDate) { aiStore.deleteDraft(c.guid); changed = true; }
    if (skip && skip.forDate !== c.lastDate) { aiStore.clearSkip(c.guid); }
    // Time-sensitive verdicts die when superseded, answered, or past their
    // own model-chosen expiry (with the global TTL as a backstop).
    const u = aiStore.getUrgent(c.guid);
    const expired = u && u.urgent && (u.expiresAt ? now >= u.expiresAt : now - u.forDate > URGENT_TTL_MS);
    if (u && (u.forDate !== c.lastIncomingDate || c.lastFromMe || expired)) {
      aiStore.clearUrgent(c.guid);
      if (u.urgent) changed = true;
    }
  }
  // Prune ranked entries whose conversation is gone or archived (removal
  // preserves the relative order of everything else).
  {
    const valid = new Set(convos.filter((c) => !c.archived).map((c) => c.guid));
    const pr = aiStore.getPriority();
    if (pr.order.some((g) => !valid.has(g))) {
      pr.order = pr.order.filter((g) => valid.has(g));
      aiStore.savePriority();
      changed = true;
    }
  }
  if (changed && win) win.webContents.send('ai-changed');

  // Fire a reflection if enough samples have piled up (e.g. while Ronak was
  // replying from his phone) — don't rely solely on an in-app action to trigger
  // it. Guarded internally by threshold/cooldown/in-progress checks.
  maybeReflect();

  // 2) Draft the next message Ronak would send, given the current tail. Covers
  //    replies (last message is theirs) AND continuations (Ronak just texted and
  //    may be mid-burst). Throttled + guarded; backs off while the API is down.
  if (aiGenBusy || now - aiLastGenAt < GEN_EVERY_MS || now < aiDraftCooldownUntil) return;
  const cutoff = now - DRAFT_WINDOW_MS;
  const needsDraft = convos.filter((c) => {
    if (c.archived || c.lastDate < cutoff) return false;
    // Only draft a continuation shortly after Ronak's own message (rapid-fire
    // window); otherwise he's done and it's their turn — no continuation.
    if (c.lastFromMe && (now - c.lastDate) > CONT_WINDOW_MS) return false;
    const d = aiStore.getDraft(c.guid);
    if (d && d.forDate === c.lastDate) return false;   // already drafted this tail
    const s = aiStore.getSkip(c.guid);
    if (s && s.forDate === c.lastDate) return false;   // already judged: no message
    return true;
  });
  if (!needsDraft.length) return;

  aiGenBusy = true;
  aiLastGenAt = now;
  try {
    let budget = 4; // cap per pass to spread cost / avoid rate limits
    for (const c of needsDraft) {
      if (budget-- <= 0) break;
      await generateDraftFor(c);
    }

    // Time-sensitive triage: judge each fresh incoming message once (verdicts,
    // including NO, are remembered per message). Tiny calls; never blocks the
    // message from appearing — it just floats the chat up once labeled.
    const needsTriage = convos.filter((c) => {
      if (c.archived || c.lastFromMe) return false;
      if (!c.lastIncomingDate || now - c.lastIncomingDate > URGENT_WINDOW_MS) return false;
      const u = aiStore.getUrgent(c.guid);
      return !(u && u.forDate === c.lastIncomingDate);
    });
    let triageBudget = 3;
    for (const c of needsTriage) {
      if (triageBudget-- <= 0) break;
      await classifyUrgentFor(c);
    }

    // Priority ranking (jev): one-time backlog merge sort, then each new
    // incoming message binary-searches its slot — the Messages section is a
    // priority queue ordered by Ronak's rubric.
    if (rank.hasKey() && now >= rankCooldownUntil) {
      const pr = aiStore.getPriority();
      if (!pr.backfilled) {
        runBacklogSort(convos); // detached — minutes-long, has its own guard
      } else if (!rankBusy) {
        const byGuid = {};
        for (const c of convos) byGuid[c.guid] = c;
        const needsRank = convos.filter((c) =>
          !c.archived && !c.lastFromMe && c.lastIncomingDate &&
          !(pr.byGuid[c.guid] && pr.byGuid[c.guid].forDate === c.lastIncomingDate));
        let rankBudget = 2;
        for (const c of needsRank) {
          if (rankBudget-- <= 0) break;
          await insertIntoRanking(c, byGuid);
        }
      }
    }
  } finally {
    aiGenBusy = false;
  }
}

// ---- priority ranking helpers ----------------------------------------------

async function rankCardFor(c) {
  const hit = rankCards.get(c.guid);
  if (hit && hit.forDate === c.lastDate) return hit.card;
  const msgs = await db.getMessages(c.chatId, 10).catch(() => []);
  const card = rank.buildCard(c, msgs);
  rankCards.set(c.guid, { forDate: c.lastDate, card });
  if (rankCards.size > 400) rankCards.delete(rankCards.keys().next().value);
  return card;
}

// Model comparison with recency fallback — a billing/auth failure cools the
// whole ranker off instead of burning the queue on doomed calls.
async function rankCompare(a, b) {
  if (Date.now() < rankCooldownUntil) return a.lastDate >= b.lastDate ? 'A' : 'B';
  const [ca, cb] = [await rankCardFor(a), await rankCardFor(b)];
  const res = await rank.compareCards(ca, cb);
  if (!res.ok) {
    if (res.errorType === 'billing' || res.errorType === 'auth' || res.errorType === 'nokey') {
      rankCooldownUntil = Date.now() + 10 * 60 * 1000;
      aiStatus.lastError = 'ranking: ' + res.error;
      aiStatus.lastErrorType = res.errorType;
    }
    return a.lastDate >= b.lastDate ? 'A' : 'B';
  }
  return res.winner;
}

// One-time: merge sort the existing Messages backlog into priority order.
async function runBacklogSort(convos) {
  if (rankBusy) return;
  rankBusy = true;
  const cooldownBefore = rankCooldownUntil;
  try {
    const list = convos.filter((c) => !c.archived && !c.lastFromMe);
    const sorted = await rank.mergeSort(list, rankCompare);
    // If billing died mid-sort the result is part-recency garbage — don't
    // persist it as "backfilled"; retry wholesale once the cooldown lifts.
    if (rankCooldownUntil > cooldownBefore) return;
    const pr = aiStore.getPriority();
    pr.order = sorted.map((c) => c.guid);
    pr.byGuid = {};
    for (const c of sorted) pr.byGuid[c.guid] = { forDate: c.lastIncomingDate };
    pr.backfilled = true;
    aiStore.savePriority();
    if (win) win.webContents.send('ai-changed');
  } catch (e) {
    aiStatus.lastError = 'backlog sort: ' + String((e && e.message) || e);
  } finally {
    rankBusy = false;
  }
}

// Binary-insert one conversation (new or newly-active) into the ranked order.
async function insertIntoRanking(c, byGuid) {
  const pr = aiStore.getPriority();
  const rankedGuids = pr.order.filter((g) => g !== c.guid && byGuid[g] && !byGuid[g].archived);
  const ranked = rankedGuids.map((g) => byGuid[g]);
  const idx = await rank.binaryInsertIndex(ranked, c, rankCompare);
  rankedGuids.splice(idx, 0, c.guid);
  pr.order = rankedGuids;
  pr.byGuid[c.guid] = { forDate: c.lastIncomingDate };
  aiStore.savePriority();
  if (win) win.webContents.send('ai-changed');
}

async function classifyUrgentFor(c) {
  try {
    const messages = await db.getMessages(c.chatId, 20);
    const res = await ai.classifyUrgent({ messages, isGroup: c.isGroup, name: c.name });
    if (res.ok) {
      // The model decides how long this stays urgent; 0 hours = not urgent.
      const expiresAt = res.urgent ? Date.now() + res.hours * 3600 * 1000 : 0;
      aiStore.setUrgent(c.guid, c.lastIncomingDate, !!res.urgent, expiresAt);
      if (res.urgent && win) win.webContents.send('ai-changed');
    }
  } catch (e) {
    aiStatus.lastError = String((e && e.message) || e);
  }
}

async function generateDraftFor(c) {
  try {
    const messages = await db.getMessages(c.chatId, 60); // ensure >= 20 non-empty for context
    const lastIncoming = [...messages].reverse().find((m) => !m.fromMe);
    const res = await ai.generateDraft({
      systemPrompt: aiStore.currentPrompt(),
      messages,
      isGroup: c.isGroup,
      name: c.name,
    });
    if (res.ok && res.skip) {
      // Model judged no message is warranted. Remember the decision (keyed to
      // the current tail) so we don't redraft it every tick; show no draft.
      aiStore.setSkip(c.guid, c.lastDate, c.name, lastIncoming ? lastIncoming.text : '');
      aiStore.deleteDraft(c.guid);
      aiStatus.lastError = null;
      aiStatus.lastErrorType = null;
      if (win) win.webContents.send('ai-changed');
    } else if (res.ok && res.text) {
      aiStore.setDraft(c.guid, {
        text: res.text,
        forDate: c.lastDate,
        incomingText: lastIncoming ? lastIncoming.text : '',
        name: c.name,
      });
      aiStore.clearSkip(c.guid);
      aiStatus.lastError = null;
      aiStatus.lastErrorType = null;
      if (win) win.webContents.send('ai-changed');
    } else if (!res.ok) {
      aiStatus.lastError = res.error;
      aiStatus.lastErrorType = res.errorType;
      if (['billing', 'auth', 'nokey'].includes(res.errorType)) {
        aiDraftCooldownUntil = Date.now() + 2 * 60 * 1000; // retry in 2 min
      }
    }
  } catch (e) {
    aiStatus.lastError = String((e && e.message) || e);
  }
}

async function maybeReflect() {
  if (!aiStore || aiStatus.reflecting) return;
  if (aiStore.pendingCount() < REFLECT_EVERY) return;
  if (Date.now() < aiReflectCooldownUntil) return;
  aiStatus.reflecting = true;
  try {
    // Reflect on up to 40 pending samples (broader view = less batch-to-batch
    // swing), and clear only the ones we actually used.
    const samples = aiStore.pendingSamples().slice(0, 40);
    const res = await ai.reflect({ systemPrompt: aiStore.currentPrompt(), samples });
    if (res.ok) {
      aiStore.addVersion({ reflection: res.reflection, systemPrompt: res.systemPrompt, sampleCount: samples.length });
      aiStore.clearPending(samples.length);
      if (win) win.webContents.send('ai-changed');
    } else {
      aiStatus.lastError = res.error;
      aiStatus.lastErrorType = res.errorType;
      aiReflectCooldownUntil = Date.now() + 10 * 60 * 1000; // retry later
    }
  } catch (e) {
    aiStatus.lastError = String((e && e.message) || e);
    aiReflectCooldownUntil = Date.now() + 10 * 60 * 1000;
  } finally {
    aiStatus.reflecting = false;
  }
}

ipcMain.handle('ai:draftFor', async (_e, guid) => {
  const d = aiStore && aiStore.getDraft(guid);
  return d ? d.text : null;
});

ipcMain.handle('ai:dismissDraft', async (_e, guid) => {
  if (aiStore) aiStore.deleteDraft(guid);
  return true;
});

ipcMain.handle('ai:versions', async () => (aiStore ? aiStore.versions() : []));

ipcMain.handle('ai:samples', async () => (aiStore ? aiStore.recentSamples(20) : []));

ipcMain.handle('ai:status', async () => ({
  ...aiStatus,
  model: ai.DRAFT_MODEL,
  pending: aiStore ? aiStore.pendingCount() : 0,
  total: aiStore ? aiStore.totalSamples() : 0,
  reflectEvery: REFLECT_EVERY,
}));

ipcMain.handle('attachment:data', async (_e, filePath) => {
  try {
    if (!filePath) return null;
    const stat = fs.statSync(filePath);
    if (stat.size > 25 * 1024 * 1024) return null; // skip huge files
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // Sniff magic bytes first — rich-link payload files carry no meaningful
    // extension, and the bytes are the truth anyway.
    const mime =
      buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png'
      : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg'
      : buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 ? 'image/gif'
      : buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00 ? 'image/x-icon'
      : buf.length > 12 && buf.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp'
      : ext === '.heic' ? 'image/heic'
      : ext === '.mov' ? 'video/quicktime'
      : ext === '.mp4' ? 'video/mp4'
      : 'image/jpeg';
    return { mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch {
    return null;
  }
});

ipcMain.handle('theme:isDark', () => nativeTheme.shouldUseDarkColors);

ipcMain.handle('contact:image', async (_e, handle) => {
  try { return await getContactImage(handle); } catch { return null; }
});
