import React, { useRef, useLayoutEffect, useEffect, useState } from 'react';
import Avatar from './Avatar';
import Bubble from './Bubble';
import Composer from './Composer';
import { BellSlashGlyph } from './MuteGlyphs';
import { daySeparator, shouldSeparate, sidebarTitle } from '../lib/format';

function sameRun(a, b) {
  return a && b && a.fromMe === b.fromMe && a.sender === b.sender && !shouldSeparate(a.date, b.date);
}

export default function Thread({ convo, messages, draft, onArchive, onUnarchive, onMute, onUnmute, onSend, onOpenInMessages }) {
  const scrollRef = useRef(null);
  const lastId = useRef(null);          // id of the last rendered message
  const scrolledGuid = useRef(null);    // guid we've already pinned to bottom
  const atBottom = useRef(true);        // was the user pinned to the bottom?
  const seenIds = useRef(new Set());    // message ids already rendered for this chat
  const [showJump, setShowJump] = useState(false); // scroll-to-bottom chip
  const [atTop, setAtTop] = useState(false);       // lighten the veil at the very top

  // Reset the "seen" set when switching conversations.
  useEffect(() => { seenIds.current = new Set(); }, [convo.guid]);
  // After each render, remember which messages we've shown so only genuinely
  // new ones animate on the next poll (not the same last bubble every tick).
  useEffect(() => {
    for (const m of messages) seenIds.current.add(m.id);
  }, [messages]);

  // Track whether the user is parked at the bottom *before* a new message lands,
  // so a tall incoming bubble can't fool a post-insert distance check.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = dist < 120;
    setShowJump(dist > 400);
    setAtTop(el.scrollTop < 8);
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (el) { el.scrollTop = el.scrollHeight; atBottom.current = true; setShowJump(false); }
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Wait until messages for this chat have actually rendered — otherwise we'd
    // "scroll" an empty list and then never re-pin once content arrives.
    if (messages.length === 0) return;

    const last = messages[messages.length - 1];
    const chatChanged = scrolledGuid.current !== convo.guid;
    const isNew = last.id !== lastId.current;
    const pin = () => { el.scrollTop = el.scrollHeight; };

    if (chatChanged) {
      el.style.scrollBehavior = 'auto';
      pin();
      requestAnimationFrame(pin);                        // after layout settles
      setTimeout(() => { pin(); el.style.scrollBehavior = 'smooth'; }, 140); // after async images
      scrolledGuid.current = convo.guid;
      atBottom.current = true;
      setShowJump(false);
    } else if (isNew && (atBottom.current || last.fromMe)) {
      // New message: follow it to the bottom if the user was already there, or
      // whenever it's one they just sent (incl. from another device).
      pin();
      requestAnimationFrame(pin);                        // catch late-loading images
      atBottom.current = true;
    }
    lastId.current = last.id;
  }, [messages, convo.guid]);

  // Keep clear air between the last message and the (floating) composer: as a
  // multiline draft grows the bar, grow the scroller's bottom padding to match
  // and stay pinned if we were at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const comp = el && el.parentElement.querySelector('.composer');
    if (!el || !comp) return undefined;
    const sync = () => {
      // Measure BEFORE the padding change: if the user was reading near the
      // bottom, keep the last message pinned above the taller bar.
      const distBefore = el.scrollHeight - el.scrollTop - el.clientHeight;
      el.style.paddingBottom = (comp.offsetHeight + 14) + 'px';
      if (atBottom.current || distBefore < 260) el.scrollTop = el.scrollHeight;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(comp);
    window.addEventListener('composer-resize', sync);
    return () => { ro.disconnect(); window.removeEventListener('composer-resize', sync); };
  }, [convo.guid]);

  // Only animate bubbles that arrive after the conversation is already open,
  // so switching chats doesn't trigger a flurry of entrance animations.
  const justOpened = scrolledGuid.current !== convo.guid;

  return (
    <div className="main">
      <div className={'thread-header' + (atTop ? ' at-top' : '')}>
        <div className="header-center">
          <Avatar name={convo.name} handle={convo.isGroup ? undefined : convo.identifier} isGroup={convo.isGroup} participants={convo.participants} />
          <span className="title">{convo.isGroup ? sidebarTitle(convo.name, true) : convo.name}<span className="chev">›</span></span>
        </div>
        <div className="thread-actions">
          {!convo.isGroup && convo.identifier && (
            <button
              className="icon-btn"
              title="FaceTime Audio"
              onClick={() => window.api.openExternal('facetime-audio://' + encodeURIComponent(convo.identifier))}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7.8 3.6 l1.9 -.45 a1.3 1.3 0 0 1 1.5 .78 l1.05 2.7 a1.3 1.3 0 0 1 -.37 1.47 l-1.55 1.3 a12.9 12.9 0 0 0 4.27 4.27 l1.3 -1.55 a1.3 1.3 0 0 1 1.47 -.37 l2.7 1.05 a1.3 1.3 0 0 1 .78 1.5 l-.45 1.9 a2 2 0 0 1 -1.95 1.55 C11.3 17.75 6.25 12.7 6.25 5.55 a2 2 0 0 1 1.55 -1.95 Z" />
              </svg>
            </button>
          )}
          {!convo.isGroup && convo.identifier && (
            <button
              className="icon-btn"
              title="FaceTime Video"
              onClick={() => window.api.openExternal('facetime://' + encodeURIComponent(convo.identifier))}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6.5" width="12.4" height="11" rx="3" />
                <path d="M15.4 12.9 l3.9 2.6 a1 1 0 0 0 1.55 -.83 V9.33 a1 1 0 0 0 -1.55 -.83 l-3.9 2.6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {convo.muted && (
        <div className="mute-banner">
          <BellSlashGlyph size={13} strokeWidth={2} />
          <span>Muted — new messages stay in Archived</span>
          <button onClick={() => onUnmute(convo)}>Unmute</button>
        </div>
      )}

      <div className={'messages' + (convo.muted ? ' has-banner' : '')} ref={scrollRef} onScroll={onScroll}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const sep = shouldSeparate(prev && prev.date, m.date);
          const prevSame = !sep && sameRun(prev, m);
          const nextSame = sameRun(m, next);
          const groupPos = !prevSame && !nextSame ? 'single'
            : !prevSame && nextSame ? 'first'
            : prevSame && nextSame ? 'middle' : 'last';
          const animate = !justOpened && !seenIds.current.has(m.id);
          return (
            <React.Fragment key={m.id}>
              {sep && (
                <div className="day-sep" dangerouslySetInnerHTML={{ __html: bold(daySeparator(m.date)) }} />
              )}
              <Bubble msg={m} groupPos={groupPos} isGroup={convo.isGroup} animate={animate} />
            </React.Fragment>
          );
        })}
      </div>

      {showJump && (
        <button className="jump-btn" onClick={jumpToBottom} title="Jump to latest">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="5 9 12 16 19 9" />
          </svg>
        </button>
      )}

      <Composer key={convo.guid} draft={draft} onSend={(t) => onSend(convo, t)} />
    </div>
  );
}

function bold(txt) {
  const i = txt.lastIndexOf(' at ');
  if (i === -1) return `<b>${txt}</b>`;
  return `<b>${txt.slice(0, i)}</b>${txt.slice(i)}`;
}
