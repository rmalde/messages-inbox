import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { listTime, sidebarTitle } from '../lib/format';

const PAGE = 50; // rows rendered per chunk — keeps huge archives from mounting at once

function preview(c) {
  let t = c.lastText || '';
  if (!t && c.lastHasAttachment) t = '📷 Attachment';
  if (c.lastFromMe && t) t = 'You: ' + t;
  return t;
}

function ArchiveGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function DraftChip() {
  return <span className="draft-chip" title="AI draft ready">Draft </span>;
}

export default function Sidebar({
  conversations, filter, setFilter, search, setSearch,
  selectedGuid, onSelect, onArchive, onUnarchive, onOpenPrompts, counts,
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
        <span className="spacer" />
        <button className="bar-btn ai-btn" title="AI style & prompt evolution" onClick={onOpenPrompts}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z" />
            <path d="M19 14l.8 2.4L22 17l-2.2.6L19 20l-.8-2.4L16 17l2.2-.6L19 14z" />
          </svg>
        </button>
        <button className="bar-btn" title="Filters">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="17" x2="14" y2="17" />
          </svg>
        </button>
        <button className="bar-btn" title="New Message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>

      <div className="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="segmented">
        <button className={filter === 'inbox' ? 'active' : ''} onClick={() => setFilter('inbox')}>
          Inbox
          <span className="total">{counts.inbox}</span>
          {counts.unread > 0 && <span className="count">{counts.unread}</span>}
        </button>
        <button className={filter === 'archived' ? 'active' : ''} onClick={() => setFilter('archived')}>
          Archived<span className="total">{counts.archived}</span>
        </button>
      </div>

      <div className="convo-list" ref={listRef} onScroll={onScroll}>
        {conversations.length === 0 && (
          <div className="empty-list">
            {filter === 'archived' ? 'No archived conversations' : 'Inbox zero ✨'}
          </div>
        )}
        {shown.map((c) => (
          <div
            key={c.guid}
            className={'convo' + (c.unread ? ' unread' : '') + (c.guid === selectedGuid ? ' selected' : '')}
            onClick={() => onSelect(c)}
          >
            {c.unread && <div className="unread-dot" />}
            <Avatar name={c.name} handle={c.isGroup ? undefined : c.identifier} isGroup={c.isGroup} participants={c.participants} />
            <div className="convo-body">
              <div className="convo-row1">
                <span className="convo-name">{sidebarTitle(c.name, c.isGroup)}</span>
                <span className="convo-time">{listTime(c.lastDate)}<span className="chev">›</span></span>
              </div>
              <div className="convo-preview">{c.hasDraft && <DraftChip />}{preview(c)}</div>
            </div>
            <button
              className="row-archive"
              title={filter === 'archived' ? 'Move to Inbox' : 'Archive (⌘⇧E)'}
              onClick={(e) => { e.stopPropagation(); (filter === 'archived' ? onUnarchive : onArchive)(c); }}
            >
              {filter === 'archived' ? '↩' : <ArchiveGlyph />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
