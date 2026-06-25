'use strict';

const { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('./lib/db');
const { Store } = require('./lib/store');
const { sendMessage } = require('./lib/send');
const { getContactImage } = require('./lib/contacts');
const { AiStore, REFLECT_EVERY } = require('./lib/aistore');
const ai = require('./lib/ai');

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
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
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
          label: 'Toggle Archived View',
          accelerator: 'CmdOrCtrl+Shift+A',
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
    if (aiStore) for (const c of convos) c.hasDraft = aiStore.hasDraft(c.guid);
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

ipcMain.handle('open:external', async (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
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
  }
  if (changed && win) win.webContents.send('ai-changed');

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
  } finally {
    aiGenBusy = false;
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
    const samples = aiStore.pendingSamples().slice(0, REFLECT_EVERY);
    const res = await ai.reflect({ systemPrompt: aiStore.currentPrompt(), samples });
    if (res.ok) {
      aiStore.addVersion({ reflection: res.reflection, systemPrompt: res.systemPrompt, sampleCount: samples.length });
      aiStore.clearPending();
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
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.gif' ? 'image/gif'
      : ext === '.heic' ? 'image/heic'
      : ext === '.webp' ? 'image/webp'
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
