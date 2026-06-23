import React, { useRef, useLayoutEffect, useEffect } from 'react';
import Avatar from './Avatar';
import Bubble from './Bubble';
import Composer from './Composer';
import { daySeparator, shouldSeparate } from '../lib/format';

function sameRun(a, b) {
  return a && b && a.fromMe === b.fromMe && a.sender === b.sender && !shouldSeparate(a.date, b.date);
}

export default function Thread({ convo, messages, draft, onArchive, onUnarchive, onSend }) {
  const scrollRef = useRef(null);
  const lastCount = useRef(0);
  const scrolledGuid = useRef(null); // guid we've already pinned to bottom
  const mountedAt = useRef(0);
  const seenIds = useRef(new Set()); // message ids already rendered for this chat

  // Reset the "seen" set when switching conversations.
  useEffect(() => { seenIds.current = new Set(); }, [convo.guid]);
  // After each render, remember which messages we've shown so only genuinely
  // new ones animate on the next poll (not the same last bubble every tick).
  useEffect(() => {
    for (const m of messages) seenIds.current.add(m.id);
  }, [messages]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Wait until messages for this chat have actually rendered — otherwise we'd
    // "scroll" an empty list and then never re-pin once content arrives.
    if (messages.length === 0) return;

    const chatChanged = scrolledGuid.current !== convo.guid;
    const grew = messages.length !== lastCount.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 260;

    if (chatChanged) {
      const jump = () => { el.scrollTop = el.scrollHeight; };
      el.style.scrollBehavior = 'auto';
      jump();
      requestAnimationFrame(jump);                       // after layout settles
      setTimeout(() => { jump(); el.style.scrollBehavior = 'smooth'; }, 140); // after async images
      scrolledGuid.current = convo.guid;
      mountedAt.current = Date.now();
    } else if (grew && nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
    lastCount.current = messages.length;
  }, [messages, convo.guid]);

  // Only animate bubbles that arrive after the conversation is already open,
  // so switching chats doesn't trigger a flurry of entrance animations.
  const justOpened = scrolledGuid.current !== convo.guid;

  return (
    <div className="main">
      <div className="thread-header">
        <div className="header-center">
          <Avatar name={convo.name} size="sm" handle={convo.isGroup ? undefined : convo.identifier} />
          <span className="title">{convo.name}<span className="chev">›</span></span>
        </div>
        <div className="thread-actions">
          {convo.archived ? (
            <button className="icon-btn" onClick={() => onUnarchive(convo)} title="Move to Inbox">↩︎ Unarchive</button>
          ) : (
            <button className="icon-btn" onClick={() => onArchive(convo)} title="Archive (⌘⇧E)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
              </svg>
            </button>
          )}
          <button className="icon-btn" title="FaceTime">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="messages" ref={scrollRef}>
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

      <Composer key={convo.guid} draft={draft} onSend={(t) => onSend(convo, t)} />
    </div>
  );
}

function bold(s) {
  const [first, ...rest] = s.split(' ');
  return `<b>${first}</b> ${rest.join(' ')}`;
}
