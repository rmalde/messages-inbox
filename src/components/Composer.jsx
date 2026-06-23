import React, { useRef, useState, useEffect } from 'react';
import { EMOJI_GROUPS } from '../lib/emoji';

export default function Composer({ onSend, disabled, draft }) {
  const [text, setText] = useState(draft || '');
  const [fromDraft, setFromDraft] = useState(!!draft); // text currently equals the AI draft
  const [showEmoji, setShowEmoji] = useState(false);
  const taRef = useRef(null);
  const popRef = useRef(null);
  const dirty = useRef(!!draft ? false : false);

  // Prefill the AI draft when it arrives — but never clobber what the user has
  // already typed. (Composer is keyed by chat, so this only fills the current one.)
  useEffect(() => {
    if (draft && !dirty.current) {
      setText(draft);
      setFromDraft(true);
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
    if (e.key === 'Enter' && !e.shiftKey) {
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
      {fromDraft && (
        <div className="draft-flag" title="AI draft — edit or send">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
          </svg>
          AI draft
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
        <button
          className="emoji-btn"
          onClick={() => setShowEmoji((s) => !s)}
          title="Emoji"
          type="button"
        >
          😀
        </button>
      </div>
      <button className="send-btn" disabled={!text.trim() || disabled} onClick={submit} title="Send">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="6 11 12 5 18 11" />
        </svg>
      </button>
    </div>
  );
}
