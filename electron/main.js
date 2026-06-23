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
const aiPrevState = {}; // guid -> { lastDate, lastFromMe } for send detection
let aiReflectCooldownUntil = 0;
let aiDraftCooldownUntil = 0; // back off drafting after billing/auth failures
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
    setTimeout(aiTick, 3000);
    setInterval(aiTick, 9000);
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

ipcMain.handle('messages:list', async (_e, chatId) => {
  return db.getMessages(chatId);
});

ipcMain.handle('chat:open', async (_e, guid) => {
  store.markOpened(guid, Date.now());
  return true;
});

ipcMain.handle('chat:archive', async (_e, guid) => {
  store.archive(guid, Date.now());
  // Archiving with a live draft = the draft was unwanted (target -> empty).
  const draft = aiStore && aiStore.getDraft(guid);
  if (draft) {
    const reached = aiStore.recordSample({ guid, name: draft.name, incomingText: draft.incomingText, draft: draft.text, sent: '', archived: true });
    aiStore.deleteDraft(guid);
    if (reached) maybeReflect();
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
    const result = await sendMessage(payload);
    // Learn from the edit: AI draft vs what Ronak actually sent.
    if (draft) {
      const reached = aiStore.recordSample({ guid: payload.guid, name: draft.name, incomingText: draft.incomingText, draft: draft.text, sent: payload.text, archived: false });
      aiStore.deleteDraft(payload.guid);
      if (reached) maybeReflect();
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- AI: drafting + learning loop ----------------------------------------

// Rolling backfill window: draft for chats whose last incoming message is this
// recent and still awaiting a reply. New messages fall inside it automatically.
const DRAFT_WINDOW_MS = 36 * 60 * 60 * 1000;

async function aiTick() {
  if (!aiStore || aiStatus.reflecting) return;
  let convos;
  try {
    convos = store.decorate(await db.getConversations());
  } catch { return; }

  const cutoff = Date.now() - DRAFT_WINDOW_MS;

  // 1) Learning capture: a chat that had a draft now shows a newer outgoing
  //    message (sent from another device / Messages) -> record the edit.
  for (const c of convos) {
    const prev = aiPrevState[c.guid];
    const draft = aiStore.getDraft(c.guid);
    if (draft && c.lastFromMe && (!prev || c.lastDate > prev.lastDate)) {
      const reached = aiStore.recordSample({ guid: c.guid, name: draft.name, incomingText: draft.incomingText, draft: draft.text, sent: c.lastText || '', archived: false });
      aiStore.deleteDraft(c.guid);
      if (reached) maybeReflect();
    }
    aiPrevState[c.guid] = { lastDate: c.lastDate, lastFromMe: c.lastFromMe };
  }

  // 2) Draft generation for today's awaiting-reply chats (a few per tick).
  // Back off while the API is unusable (no credits / bad key) so we don't spam
  // failing calls; it resumes automatically after the cooldown.
  if (Date.now() < aiDraftCooldownUntil) return;
  const needsDraft = convos.filter((c) =>
    !c.archived && !c.lastFromMe && c.lastIncomingDate >= cutoff &&
    !(aiStore.getDraft(c.guid) && aiStore.getDraft(c.guid).forDate === c.lastIncomingDate)
  );

  let budget = 4; // cap per tick to spread cost / avoid rate limits
  for (const c of needsDraft) {
    if (budget-- <= 0) break;
    await generateDraftFor(c);
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
    });
    if (res.ok && res.text) {
      aiStore.setDraft(c.guid, {
        text: res.text,
        forDate: c.lastIncomingDate,
        incomingText: lastIncoming ? lastIncoming.text : '',
        name: c.name,
      });
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
