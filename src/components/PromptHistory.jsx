import React, { useEffect, useState } from 'react';

function statusLine(s) {
  if (!s) return null;
  if (!s.hasKey) return { kind: 'warn', text: 'No Anthropic API key found — drafting is off.' };
  if (s.lastErrorType === 'billing') return { kind: 'warn', text: 'Anthropic API credit balance is too low — add credits to enable drafting.' };
  if (s.lastErrorType === 'auth') return { kind: 'warn', text: 'Anthropic API key was rejected.' };
  if (s.lastError) return { kind: 'warn', text: `AI error: ${s.lastError}` };
  return { kind: 'ok', text: `Drafting with ${s.model}. ${s.pending}/${s.reflectEvery} edits until the next prompt update · ${s.total} total.` };
}

export default function PromptHistory({ onClose }) {
  const [versions, setVersions] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    window.api.aiVersions().then(setVersions);
    window.api.aiStatus().then(setStatus);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const st = statusLine(status);
  const ordered = versions ? [...versions].reverse() : [];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="prompt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-head">
          <div className="prompt-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z" /></svg>
            AI Style — Prompt Evolution
          </div>
          <button className="prompt-close" onClick={onClose}>✕</button>
        </div>

        {st && <div className={'prompt-status ' + st.kind}>{st.text}</div>}

        <div className="prompt-list">
          {versions == null && <div className="prompt-empty">Loading…</div>}
          {versions && versions.length === 0 && <div className="prompt-empty">No prompts yet.</div>}
          {ordered.map((v) => (
            <div className="prompt-version" key={v.version}>
              <div className="pv-head">
                <span className="pv-badge">{v.version === 0 ? 'v0 · baseline' : `v${v.version}`}</span>
                {v.sampleCount > 0 && <span className="pv-meta">after {v.sampleCount} edits</span>}
                <span className="pv-date">{new Date(v.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              {v.reflection && (
                <div className="pv-reflection">
                  <div className="pv-label">What the edits revealed</div>
                  <p>{v.reflection}</p>
                </div>
              )}
              <div className="pv-label">System prompt</div>
              <pre className="pv-prompt">{v.systemPrompt}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
