import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { BellGlyph, BellSlashGlyph } from './MuteGlyphs';
import { listTime, sidebarTitle } from '../lib/format';

const PAGE = 50; // rows rendered per chunk — keeps huge archives from mounting at once

function preview(c) {
  // Collapse newlines/whitespace runs — previews are a single visual stream.
  let t = (c.lastText || '').replace(/\s+/g, ' ').trim();
  if (!t && c.lastHasAttachment) t = 'Photo';
  if (c.lastFromMe && t) t = 'You: ' + t;
  return t;
}

function DraftChip() {
  return <span className="draft-chip" title="AI draft ready">Draft </span>;
}

export default function Sidebar({
  conversations, filter, setFilter, search, setSearch,
  selectedGuid, onSelect, onArchive, onUnarchive, onUnmute, onOpenPrompts, onOpenSettings, counts, aiBusy,
}) {
  // Incrementally reveal rows as the user scrolls so an archive of 1000+
  // conversations doesn't mount (and fire a contact-photo lookup) all at once.
  const [limit, setLimit] = useState(PAGE);
  const listRef = useRef(null);
  useEffect(() => {
    setLimit(PAGE);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filter, search]);

  function onScroll(e) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) {
      setLimit((n) => (n < conversations.length ? n + PAGE : n));
    }
  }

  // When cycling (⌘⇧]/[) lands on a row beyond the rendered window, grow the
  // window so it exists, then scroll the selection into view.
  useEffect(() => {
    if (!selectedGuid) return;
    const idx = conversations.findIndex((c) => c.guid === selectedGuid);
    if (idx >= limit) setLimit(Math.ceil((idx + 1) / PAGE) * PAGE);
  }, [selectedGuid, conversations, limit]);

  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.convo.selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedGuid, limit]);

  const shown = conversations.slice(0, limit);

  return (
    <div className="sidebar">
      <div className="sidebar-bar">
        <div className="segmented">
          <button className={filter === 'inbox' ? 'active' : ''} onClick={() => setFilter('inbox')}>
            Inbox
            {counts.unread > 0 && <span className="count">{counts.unread}</span>}
          </button>
          <button className={filter === 'archived' ? 'active' : ''} onClick={() => setFilter('archived')}>
            Archived
          </button>
        </div>
        <span className="spacer" />
        <button className="bar-btn" title="New Message (opens Messages)" onClick={() => window.api.openExternal('imessage://')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.9 5.4 H7.3 C5.7 5.4 4.4 6.7 4.4 8.3 v 8.4 c0 1.6 1.3 2.9 2.9 2.9 h 8.4 c1.6 0 2.9 -1.3 2.9 -2.9 V 11.1" />
            <path d="M19.8 4.2 a1.85 1.85 0 0 0 -2.6 0 L10.55 10.85 a1 1 0 0 0 -.26 .45 l-.79 3.2 3.2 -.79 a1 1 0 0 0 .45 -.26 L19.8 6.8 a1.85 1.85 0 0 0 0 -2.6 Z" />
          </svg>
        </button>
      </div>

      <div className="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="10.8" cy="10.8" r="6.9" />
          <line x1="20.6" y1="20.6" x2="15.9" y2="15.9" />
        </svg>
        <input
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); }
          }}
        />
      </div>

      <div className="convo-list" ref={listRef} onScroll={onScroll}>
        {conversations.length === 0 && (
          <div className="empty-list">
            {search.trim()
              ? `No results for “${search.trim()}”`
              : filter === 'archived' ? 'No archived conversations' : 'Inbox zero ✨'}
          </div>
        )}
        {shown.map((c, i) => (
          <React.Fragment key={c.guid}>
            {filter === 'inbox' && (i === 0 || shown[i - 1].section !== c.section) && (
              (c.section === 0 || i > 0) ? (
                <div className="section-label">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 9 L12 16 L19 9" />
                  </svg>
                  {c.section === 0 ? 'Time sensitive' : c.section === 2 ? 'Their turn' : 'Messages'}
                  <span className="sl-count">{conversations.filter((x) => x.section === c.section).length}</span>
                </div>
              ) : null
            )}
          <div
            className={'convo' + (c.unread ? ' unread' : '') + (c.guid === selectedGuid ? ' selected' : '')}
            onClick={() => onSelect(c)}
          >
            {c.unread && <div className="unread-dot" />}
            <Avatar name={c.name} handle={c.isGroup ? undefined : c.identifier} isGroup={c.isGroup} participants={c.participants} />
            <div className="convo-body">
              <div className="convo-row1">
                <span className="convo-name">{c.isGroup ? sidebarTitle(c.name, true) : c.name}</span>
                {c.muted && (
                  <span className="muted-mark" title="Muted — new messages stay in Archived">
                    <BellSlashGlyph size={12} strokeWidth={2.2} />
                  </span>
                )}
                <span className="convo-time">{listTime(c.lastDate)}</span>
              </div>
              <div className="convo-preview">{c.hasDraft && <DraftChip />}{preview(c)}</div>
            </div>
          </div>
          </React.Fragment>
        ))}
      </div>

      <div className="list-footer">
        {filter === 'inbox'
          ? `${counts.inbox.toLocaleString()} conversation${counts.inbox === 1 ? '' : 's'}${counts.unread ? ` · ${counts.unread} unread` : ''}`
          : `${counts.archived.toLocaleString()} archived${counts.muted ? ` · ${counts.muted.toLocaleString()} muted` : ''}`}
      </div>
    </div>
  );
}
