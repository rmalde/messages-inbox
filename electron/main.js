'use strict';

const { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('./lib/db');
const { Store } = require('./lib/store');
const { sendMessage } = require('./lib/send');

let store;
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
  buildMenu();
  createWindow();

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
    const convos = await db.getConversations();
    return { ok: true, convos: store.decorate(convos) };
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
  return true;
});

ipcMain.handle('chat:unarchive', async (_e, guid) => {
  store.unarchive(guid);
  return true;
});

ipcMain.handle('message:send', async (_e, payload) => {
  try {
    const result = await sendMessage(payload);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

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
