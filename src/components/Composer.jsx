import React, { useRef, useState, useEffect } from 'react';
import { EMOJI_GROUPS } from '../lib/emoji';

export default function Composer({ onSend, disabled, draft }) {
  const [text, setText] = useState(draft || '');
  const [fromDraft, setFromDraft] = useState(!!draft); // text currently equals the AI draft
  const [showEmoji, setShowEmoji] = useState(false);
  const taRef = useRef(null);
  const popRef = useRef(null);
  const dirty = useRef(false);

  // Opening a conversation puts the caret in the field — you came here to type.
  useEffect(() => {
    if (taRef.current) taRef.current.focus({ preventScroll: true });
  }, []);

  // Mirror the AI draft into the box as long as the user hasn't typed anything.
  // Gating on `dirty` (not emptiness) means a refreshed draft replaces a stale
  // one — and a stale draft gets cleared when it's dropped (draft -> null) —
  // while anything you've actually typed is never clobbered. (Composer is keyed
  // by chat, so this only affects the open conversation.)
  useEffect(() => {
    if (dirty.current) return;
    setText(draft || '');
    setFromDraft(!!draft);
    // Caret lands at the end of the prefilled draft, ready to continue.
    if (draft && taRef.current) {
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    }
  }, [draft]);

  // Auto-grow textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, [text]);

  useEffect(() => {
    function onDoc(e) {
      if (popRef.current && !popRef.current.contains(e.target)) setShowEmoji(false);
    }
    if (showEmoji) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showEmoji]);

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
    setFromDraft(false);
    dirty.current = false;
  }

  function onChange(e) {
    setText(e.target.value);
    dirty.current = true;
    setFromDraft(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && (!e.shiftKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      {showEmoji && (
        <div className="emoji-pop" ref={popRef}>
          {EMOJI_GROUPS.map((g) => (
            <div key={g.name}>
              <div className="emoji-group-name">{g.name}</div>
              <div className="emoji-grid">
                {g.emojis.map((em) => (
                  <button
                    key={em}
                    onClick={() => {
                      setText((t) => t + em);
                      taRef.current && taRef.current.focus();
                    }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={'composer-input-wrap' + (fromDraft ? ' draft' : '')}>
        <textarea
          ref={taRef}
          rows={1}
          placeholder="iMessage"
          value={text}
          disabled={disabled}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <button className="send-btn" disabled={!text.trim() || disabled} onClick={submit} title="Send (Return)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="6 11 12 5 18 11" />
          </svg>
        </button>
      </div>
      <button
        className="emoji-btn"
        onClick={() => setShowEmoji((s) => !s)}
        title="Emoji"
        type="button"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="9.2" />
          <path d="M8 14.2 a4.4 4.4 0 0 0 8 0" />
          <circle cx="9" cy="9.6" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="15" cy="9.6" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </div>
  );
}
