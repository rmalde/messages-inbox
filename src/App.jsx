import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Thread from './components/Thread';
import PromptHistory from './components/PromptHistory';

const CONVO_POLL = 4000;
const MSG_POLL = 3000;

export default function App() {
  const [convos, setConvos] = useState([]);
  const [filter, setFilter] = useState('inbox');
  const [search, setSearch] = useState('');
  const [selectedGuid, setSelectedGuid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [accessError, setAccessError] = useState(null); // {needsAccess, error}
  const [toast, setToast] = useState(null); // {text, onUndo}
  const [draft, setDraft] = useState(null); // AI draft text for the open chat
  const [showPrompts, setShowPrompts] = useState(false); // prompt-history overlay

  const selectedRef = useRef(null);
  const toastTimer = useRef(null);
  const optimisticRef = useRef([]); // pending sent messages, by guid
  const visibleRef = useRef([]); // latest rendered (filtered) conversation order

  const selected = useMemo(
    () => convos.find((c) => c.guid === selectedGuid) || null,
    [convos, selectedGuid]
  );

  const refreshConvos = useCallback(async () => {
    const res = await window.api.listConversations();
    if (!res || res.ok === false) {
      setAccessError({ needsAccess: res ? res.needsAccess : true, error: res && res.error });
      return [];
    }
    setAccessError(null);
    setConvos(res.convos);
    return res.convos;
  }, []);

  const refreshMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    const msgs = await window.api.listMessages(chatId);
    // Drop optimistic bubbles that have now landed in the DB.
    optimisticRef.current = optimisticRef.current.filter(
      (o) => !msgs.some((m) => m.fromMe && m.text.trim() === o.text.trim() && m.date >= o.date - 4000)
    );
    setMessages([...msgs, ...optimisticRef.current]);
  }, []);

  // Initial + interval polling for conversation list.
  useEffect(() => {
    refreshConvos();
    const id = setInterval(refreshConvos, CONVO_POLL);
    return () => clearInterval(id);
  }, [refreshConvos]);

  // Poll messages for the open conversation.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const chatId = selected.chatId;
    (async () => {
      setLoadingMsgs(true);
      await refreshMessages(chatId);
      if (live) setLoadingMsgs(false);
    })();
    const id = setInterval(() => refreshMessages(chatId), MSG_POLL);
    return () => { live = false; clearInterval(id); };
  }, [selected && selected.chatId, refreshMessages]);

  // Refresh the open thread the instant the conversation list detects a new
  // message in it (snappier than waiting for the next message poll tick).
  useEffect(() => {
    if (selected) refreshMessages(selected.chatId);
  }, [selected && selected.lastDate, refreshMessages]);

  // Pull the AI draft for the open chat (re-fetches when a draft appears).
  useEffect(() => {
    if (!selectedGuid) { setDraft(null); return; }
    let live = true;
    window.api.draftFor(selectedGuid).then((d) => { if (live) setDraft(d || null); });
    return () => { live = false; };
  }, [selectedGuid, selected && selected.hasDraft]);

  // React to main-process AI events (new draft / new prompt version).
  useEffect(() => {
    const off = window.api.on('ai-changed', () => {
      refreshConvos();
      if (selectedRef.current) {
        window.api.draftFor(selectedRef.current.guid).then((d) => setDraft(d || null));
      }
    });
    return () => off && off();
  }, [refreshConvos]);

  const selectConvo = useCallback(async (c) => {
    // Already open — don't reload/reset scroll.
    if (selectedRef.current && selectedRef.current.guid === c.guid) return;
    optimisticRef.current = [];
    setMessages([]);
    setSelectedGuid(c.guid);
    selectedRef.current = c;
    await window.api.openChat(c.guid);
    // reflect read-state locally right away
    setConvos((prev) => prev.map((x) => (x.guid === c.guid ? { ...x, unread: false } : x)));
  }, []);

  const showToast = useCallback((text, onUndo) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, onUndo });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const archive = useCallback(async (c) => {
    if (!c) return;
    // Pick the conversation directly above the one being archived (fall back to
    // the one below if it was at the top).
    const cur = visibleRef.current;
    const idx = cur.findIndex((x) => x.guid === c.guid);
    const neighborGuid = idx > 0 ? cur[idx - 1].guid : (cur[idx + 1] ? cur[idx + 1].guid : null);

    await window.api.archive(c.guid);
    const list = await refreshConvos();
    if (filter === 'inbox') {
      const target = neighborGuid && list.find((x) => x.guid === neighborGuid && !x.archived);
      if (target) selectConvo(target);
      else { setSelectedGuid(null); setMessages([]); }
    }
    showToast('Conversation archived', async () => {
      await window.api.unarchive(c.guid);
      await refreshConvos();
      if (filter === 'inbox') selectConvo(c);
      setToast(null);
    });
  }, [refreshConvos, filter, selectConvo, showToast]);

  const unarchive = useCallback(async (c) => {
    if (!c) return;
    await window.api.unarchive(c.guid);
    await refreshConvos();
  }, [refreshConvos]);

  const send = useCallback(async (c, text) => {
    setDraft(null); // sending consumes the draft
    const opt = { id: -Date.now(), guid: 'opt-' + Date.now(), date: Date.now(), fromMe: true, text, service: c.service, sender: 'Me', attachments: [], reactions: [], pending: true };
    optimisticRef.current = [...optimisticRef.current, opt];
    setMessages((prev) => [...prev, opt]);
    const res = await window.api.send({ guid: c.guid, text, handle: c.identifier });
    if (!res.ok) {
      // mark the optimistic bubble as failed
      optimisticRef.current = optimisticRef.current.map((o) =>
        o.guid === opt.guid ? { ...o, text: text + '  ⚠️ (failed to send)', pending: false } : o
      );
      setMessages((prev) => prev.map((m) => (m.guid === opt.guid ? { ...m, text: text + '  ⚠️ (failed to send)', pending: false } : m)));
      console.error('send failed:', res.error);
    }
    setTimeout(() => refreshMessages(c.chatId), 1200);
  }, [refreshMessages]);

  // Menu-accelerator events from the main process.
  useEffect(() => {
    const offs = [
      window.api.on('archive-current', () => {
        const c = selectedRef.current;
        if (c) archive(c);
      }),
      window.api.on('toggle-archived-view', () => {
        setFilter((f) => (f === 'inbox' ? 'archived' : 'inbox'));
      }),
      window.api.on('mark-read-current', () => {
        const c = selectedRef.current;
        if (c) window.api.openChat(c.guid).then(refreshConvos);
      }),
      window.api.on('nav', (dir) => navStep(dir)),
    ];
    return () => offs.forEach((off) => off && off());
  }, [archive, refreshConvos]);

  // keep selectedRef current for the menu handlers
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return convos
      .filter((c) => (filter === 'archived' ? c.archived : !c.archived))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.lastText || '').toLowerCase().includes(q));
  }, [convos, filter, search]);

  useEffect(() => { visibleRef.current = visible; }, [visible]);

  // Read from refs (not render-scoped state) so the function is stable and the
  // menu/keyboard handlers never act on a stale selection or list.
  const navStep = useCallback((dir) => {
    const list = visibleRef.current;
    const n = list.length;
    if (!n) return;
    const curGuid = selectedRef.current && selectedRef.current.guid;
    const idx = list.findIndex((c) => c.guid === curGuid);
    // Wrap around so the shortcuts cycle endlessly; with nothing selected,
    // forward lands on the first row and backward on the last.
    const next = idx === -1
      ? list[dir > 0 ? 0 : n - 1]
      : list[(idx + dir + n) % n];
    if (next) selectConvo(next);
  }, [selectConvo]);

  // Cmd+Shift+] / Cmd+Shift+[ cycle conversations. Handled in the renderer
  // (e.code is keyboard-layout independent) rather than via a menu accelerator,
  // which proved unreliable for these keys.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'KeyF') {
        e.preventDefault();
        const el = document.querySelector('.search input');
        if (el) el.focus();
        return;
      }
      if (!e.metaKey || !e.shiftKey || e.altKey || e.ctrlKey) return;
      if (e.code === 'BracketRight') { e.preventDefault(); navStep(1); }
      else if (e.code === 'BracketLeft') { e.preventDefault(); navStep(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navStep]);

  const counts = useMemo(() => ({
    inbox: convos.filter((c) => !c.archived).length,
    unread: convos.filter((c) => !c.archived && c.unread).length,
    archived: convos.filter((c) => c.archived).length,
  }), [convos]);

  if (accessError && accessError.needsAccess && convos.length === 0) {
    return (
      <div className="access-screen">
        <div className="access-card">
          <div className="access-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2>Full Disk Access needed</h2>
          <p>
            Messages Inbox reads your local Messages database to show your
            conversations. macOS keeps it protected, so you’ll need to grant
            access once.
          </p>
          <ol>
            <li>Click <b>Open Settings</b> below.</li>
            <li>Find <b>Messages Inbox</b> in the list and turn it <b>on</b> (add it with “+” if it’s not listed — it lives in /Applications).</li>
            <li>Quit and reopen Messages Inbox.</li>
          </ol>
          <div className="access-actions">
            <button className="btn-primary" onClick={() => window.api.openAccessSettings()}>Open Settings</button>
            <button className="btn-secondary" onClick={() => refreshConvos()}>Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        conversations={visible}
        filter={filter}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        selectedGuid={selectedGuid}
        onSelect={selectConvo}
        onArchive={archive}
        onUnarchive={unarchive}
        onOpenPrompts={() => setShowPrompts(true)}
        counts={counts}
      />
      {selected ? (
        <Thread
          convo={selected}
          messages={messages}
          draft={draft}
          onArchive={archive}
          onUnarchive={unarchive}
          onSend={send}
          loading={false}
        />
      ) : (
        <div className="main">
          <div className="no-chat">
            <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3.6 c-5.2 0 -9.2 3.4 -9.2 7.7 c0 2.2 1.05 4.15 2.75 5.55 c-.2 1.15 -.75 2.2 -1.6 3.05 c-.25 .25 -.05 .7 .3 .65 c1.75 -.2 3.3 -.85 4.5 -1.7 c1.02 .3 2.12 .45 3.25 .45 c5.2 0 9.2 -3.4 9.2 -7.7 s-4 -7.6 -9.2 -7.6 Z" />
            </svg>
            <div className="nc-title">No Conversation Selected</div>
            <div className="nc-sub">Choose a conversation from the list to read and reply.</div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.onUndo && (
            <button className="toast-undo" onClick={() => toast.onUndo()}>Undo</button>
          )}
        </div>
      )}
      {showPrompts && <PromptHistory onClose={() => setShowPrompts(false)} />}
    </div>
  );
}
