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

  // main -> renderer events (menu accelerators, theme)
  on: (channel, cb) => {
    const allowed = [
      'archive-current',
      'mark-read-current',
      'nav',
      'toggle-archived-view',
      'theme-changed',
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
