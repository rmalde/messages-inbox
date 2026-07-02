import React, { useRef, useLayoutEffect, useEffect, useState } from 'react';
import Avatar from './Avatar';
import Bubble from './Bubble';
import Composer from './Composer';
import { daySeparator, shouldSeparate, sidebarTitle } from '../lib/format';

function sameRun(a, b) {
  return a && b && a.fromMe === b.fromMe && a.sender === b.sender && !shouldSeparate(a.date, b.date);
}

export default function Thread({ convo, messages, draft, onArchive, onUnarchive, onSend }) {
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

  // Only animate bubbles that arrive after the conversation is already open,
  // so switching chats doesn't trigger a flurry of entrance animations.
  const justOpened = scrolledGuid.current !== convo.guid;

  return (
    <div className="main">
      <div className={'thread-header' + (atTop ? ' at-top' : '')}>
        <div className="header-center">
          <Avatar name={convo.name} handle={convo.isGroup ? undefined : convo.identifier} isGroup={convo.isGroup} participants={convo.participants} />
          <span className="title">{sidebarTitle(convo.name, convo.isGroup)}<span className="chev">›</span></span>
        </div>
        <div className="thread-actions">
          {!convo.isGroup && convo.identifier && (
            <button
              className="icon-btn"
              title="FaceTime Audio"
              onClick={() => window.api.openExternal('facetime-audio://' + encodeURIComponent(convo.identifier))}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.6 3.8 L9 3.2 a1.2 1.2 0 0 1 1.35 .7 L11.5 6.7 a1.2 1.2 0 0 1 -.35 1.4 L9.6 9.4 a13.8 13.8 0 0 0 5 5 L16 12.85 a1.2 1.2 0 0 1 1.4 -.35 l2.8 1.15 a1.2 1.2 0 0 1 .7 1.35 L20.2 17.4 a2 2 0 0 1 -2 1.6 C10.6 19 5 13.4 5 5.8 a2 2 0 0 1 1.6 -2 Z" />
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
                <rect x="2.5" y="6" width="13" height="12" rx="3.2" />
                <path d="M15.5 12.6 L20 15.9 a0.9 0.9 0 0 0 1.5 -.75 V8.85 a0.9 0.9 0 0 0 -1.5 -.75 L15.5 11.4" />
              </svg>
            </button>
          )}
          {convo.archived ? (
            <button className="icon-btn" onClick={() => onUnarchive(convo)} title="Move to Inbox">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14 v4.4 A1.6 1.6 0 0 0 5.6 20 h12.8 a1.6 1.6 0 0 0 1.6 -1.6 V14" />
                <path d="M12 14.5 V4.5 M8 8.2 L12 4.2 L16 8.2" />
              </svg>
            </button>
          ) : (
            <button className="icon-btn" onClick={() => onArchive(convo)} title="Archive (⌘⇧E)">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="4.6" rx="1.2" />
                <path d="M5 8.6 V18.4 a1.6 1.6 0 0 0 1.6 1.6 h10.8 a1.6 1.6 0 0 0 1.6 -1.6 V8.6" />
                <line x1="10" y1="12.6" x2="14" y2="12.6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
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

function bold(s) {
  const [first, ...rest] = s.split(' ');
  return `<b>${first}</b> ${rest.join(' ')}`;
}
