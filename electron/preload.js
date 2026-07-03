'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  listMessages: (chatId) => ipcRenderer.invoke('messages:list', chatId),
  openChat: (guid) => ipcRenderer.invoke('chat:open', guid),
  archive: (guid) => ipcRenderer.invoke('chat:archive', guid),
  unarchive: (guid) => ipcRenderer.invoke('chat:unarchive', guid),
  send: (payload) => ipcRenderer.invoke('message:send', payload),
  attachment: (filePath) => ipcRenderer.invoke('attachment:data', filePath),
  isDark: () => ipcRenderer.invoke('theme:isDark'),
  checkAccess: () => ipcRenderer.invoke('access:check'),
  openAccessSettings: () => ipcRenderer.invoke('access:openSettings'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  contactImage: (handle) => ipcRenderer.invoke('contact:image', handle),
  draftFor: (guid) => ipcRenderer.invoke('ai:draftFor', guid),
  dismissDraft: (guid) => ipcRenderer.invoke('ai:dismissDraft', guid),
  aiVersions: () => ipcRenderer.invoke('ai:versions'),
  aiSamples: () => ipcRenderer.invoke('ai:samples'),
  aiStatus: () => ipcRenderer.invoke('ai:status'),

  // main -> renderer events (menu accelerators, theme)
  on: (channel, cb) => {
    const allowed = [
      'archive-current',
      'mark-read-current',
      'nav',
      'toggle-archived-view',
      'open-in-messages',
      'theme-changed',
      'ai-changed',
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
