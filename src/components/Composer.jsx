import React, { useRef, useState, useEffect } from 'react';
import { EMOJI_GROUPS } from '../lib/emoji';

export default function Composer({ onSend, disabled }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const taRef = useRef(null);
  const popRef = useRef(null);

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
      <div className="composer-input-wrap">
        <textarea
          ref={taRef}
          rows={1}
          placeholder="iMessage"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
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
