import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { listTime, sidebarTitle } from '../lib/format';

const PAGE = 50; // rows rendered per chunk — keeps huge archives from mounting at once

function preview(c) {
  // Collapse newlines/whitespace runs — previews are a single visual stream.
  let t = (c.lastText || '').replace(/\s+/g, ' ').trim();
  if (!t && c.lastHasAttachment) t = 'Photo';
  if (c.lastFromMe && t) t = 'You: ' + t;
  return t;
}

/* SF-symbol-style archivebox: lid, box, handle — 1.8pt stroke, round caps. */
function ArchiveGlyph({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4.6" rx="1.2" />
      <path d="M5 8.6 V18.4 a1.6 1.6 0 0 0 1.6 1.6 h10.8 a1.6 1.6 0 0 0 1.6 -1.6 V8.6" />
      <line x1="10" y1="12.6" x2="14" y2="12.6" />
    </svg>
  );
}

function DraftChip() {
  return <span className="draft-chip" title="AI draft ready">Draft </span>;
}

export default function Sidebar({
  conversations, filter, setFilter, search, setSearch,
  selectedGuid, onSelect, onArchive, onUnarchive, onOpenPrompts, counts, aiBusy,
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
        <button className={'bar-btn ai-btn' + (aiBusy ? ' reflecting' : '')} title={aiBusy ? 'AI is updating its style guide…' : 'AI style & prompt evolution'} onClick={onOpenPrompts}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3.2 L13.9 9 a1 1 0 0 0 .64 .64 L20.3 11.5 a0.55 0.55 0 0 1 0 1 L14.54 14.36 a1 1 0 0 0 -.64 .64 L12 20.8 a0.55 0.55 0 0 1 -1 0 L9.46 15 a1 1 0 0 0 -.64 -.64 L3.7 12.5 a0.55 0.55 0 0 1 0 -1 L9.46 9.64 a1 1 0 0 0 .64 -.64 L11 3.2 a0.55 0.55 0 0 1 1 0 Z" transform="translate(-1.2 1.2) scale(0.92)" />
            <path d="M18.6 3.2 l.75 2.06 a0.7 0.7 0 0 0 .42 .42 L21.8 6.4 a0.36 0.36 0 0 1 0 .68 l-2.03 .72 a0.7 0.7 0 0 0 -.42 .42 L18.6 10.3 a0.36 0.36 0 0 1 -.68 0 l-.72 -2.08 a0.7 0.7 0 0 0 -.42 -.42 L14.7 7.08 a0.36 0.36 0 0 1 0 -.68 l2.08 -.72 a0.7 0.7 0 0 0 .42 -.42 L17.92 3.2 a0.36 0.36 0 0 1 .68 0 Z" />
          </svg>
        </button>
        <button className="bar-btn" title="New Message (opens Messages)" onClick={() => window.api.openExternal('imessage://')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15.2 5.2 H6.4 A2.4 2.4 0 0 0 4 7.6 v10 A2.4 2.4 0 0 0 6.4 20 h10 a2.4 2.4 0 0 0 2.4 -2.4 V8.8" />
            <path d="M17.8 3.4 a1.9 1.9 0 0 1 2.7 2.7 L12 14.6 l-3.6 .9 .9 -3.6 Z" />
          </svg>
        </button>
      </div>

      <div className="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

      <div className="segmented">
        <button className={filter === 'inbox' ? 'active' : ''} onClick={() => setFilter('inbox')}>
          Inbox
          {counts.unread > 0 && <span className="count">{counts.unread}</span>}
        </button>
        <button className={filter === 'archived' ? 'active' : ''} onClick={() => setFilter('archived')}>
          Archived
        </button>
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
            {filter === 'inbox' && c.timeSensitive && i === 0 && (
              <div className="section-label urgent">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" />
                </svg>
                Time Sensitive
              </div>
            )}
            {filter === 'inbox' && !c.timeSensitive && i > 0 && shown[i - 1].timeSensitive && (
              <div className="section-label">Messages</div>
            )}
          <div
            className={'convo' + (c.unread ? ' unread' : '') + (c.guid === selectedGuid ? ' selected' : '')}
            onClick={() => onSelect(c)}
          >
            {c.unread && <div className="unread-dot" />}
            <Avatar name={c.name} handle={c.isGroup ? undefined : c.identifier} isGroup={c.isGroup} participants={c.participants} />
            <div className="convo-body">
              <div className="convo-row1">
                <span className="convo-name">{sidebarTitle(c.name, c.isGroup)}</span>
                <span className="convo-time">{listTime(c.lastDate)}</span>
              </div>
              <div className="convo-preview">{c.hasDraft && <DraftChip />}{preview(c)}</div>
            </div>
            <button
              className="row-archive"
              title={filter === 'archived' ? 'Move to Inbox' : 'Archive (⌘⇧E)'}
              onClick={(e) => { e.stopPropagation(); (filter === 'archived' ? onUnarchive : onArchive)(c); }}
            >
              {filter === 'archived' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14 v4.4 A1.6 1.6 0 0 0 5.6 20 h12.8 a1.6 1.6 0 0 0 1.6 -1.6 V14" />
                  <path d="M12 14.5 V4.5 M8 8.2 L12 4.2 L16 8.2" />
                </svg>
              ) : <ArchiveGlyph />}
            </button>
          </div>
          </React.Fragment>
        ))}
      </div>

      <div className="list-footer">
        {filter === 'inbox'
          ? `${counts.inbox.toLocaleString()} conversation${counts.inbox === 1 ? '' : 's'}${counts.unread ? ` · ${counts.unread} unread` : ''}`
          : `${counts.archived.toLocaleString()} archived`}
      </div>
    </div>
  );
}
