import React, { useEffect, useState } from 'react';

function statusLine(s) {
  if (!s) return null;
  if (!s.hasKey) return { kind: 'warn', text: 'No Anthropic API key found — drafting is off.' };
  if (s.lastErrorType === 'billing') return { kind: 'warn', text: 'Anthropic API credit balance is too low — add credits to enable drafting.' };
  if (s.lastErrorType === 'auth') return { kind: 'warn', text: 'Anthropic API key was rejected.' };
  if (s.lastError) return { kind: 'warn', text: `AI error: ${s.lastError}` };
  return { kind: 'ok', text: `Drafting with ${s.model}. ${s.pending}/${s.reflectEvery} edits until the next prompt update · ${s.total} total.` };
}

function editKind(s) {
  if (s.noGen) return { tag: 'Wrote it himself (no draft yet)', cls: 'k-arch' };
  if (s.skipped) {
    return (s.sent || '').trim()
      ? { tag: "Skipped — should've drafted", cls: 'k-edit' }
      : { tag: 'Skipped ✓ (no reply)', cls: 'k-same' };
  }
  if (s.archived) return { tag: 'Archived — no reply', cls: 'k-arch' };
  if ((s.draft || '').trim() === (s.sent || '').trim()) return { tag: 'Sent as-is', cls: 'k-same' };
  return { tag: 'Edited', cls: 'k-edit' };
}

export default function PromptHistory({ onClose }) {
  const [tab, setTab] = useState('prompts');
  const [versions, setVersions] = useState(null);
  const [samples, setSamples] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    window.api.aiVersions().then(setVersions);
    window.api.aiSamples().then(setSamples);
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
            AI Style
          </div>
          <div className="prompt-tabs">
            <button className={tab === 'prompts' ? 'active' : ''} onClick={() => setTab('prompts')}>Prompt evolution</button>
            <button className={tab === 'edits' ? 'active' : ''} onClick={() => setTab('edits')}>
              Recent edits{samples && samples.length ? ` (${samples.length})` : ''}
            </button>
          </div>
          <button className="prompt-close" onClick={onClose}>✕</button>
        </div>

        {st && <div className={'prompt-status ' + st.kind}>{st.text}</div>}

        {tab === 'prompts' && (
          <div className="prompt-list">
            {versions == null && <div className="prompt-empty">Loading…</div>}
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
        )}

        {tab === 'edits' && (
          <div className="prompt-list">
            {samples == null && <div className="prompt-empty">Loading…</div>}
            {samples && samples.length === 0 && (
              <div className="prompt-empty">No edits captured yet. Send (or archive) a drafted reply and it'll show here.</div>
            )}
            {samples && samples.map((s, i) => {
              const k = editKind(s);
              return (
                <div className="edit-card" key={i}>
                  <div className="edit-head">
                    <span className="edit-name">{s.name || 'Conversation'}</span>
                    <span className={'edit-tag ' + k.cls}>{k.tag}</span>
                    <span className="pv-date">{new Date(s.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  {s.incomingText ? <div className="edit-row"><span className="edit-lbl">They</span><span>{s.incomingText}</span></div> : null}
                  {s.noGen ? (
                    <>
                      <div className="edit-row"><span className="edit-lbl">AI</span><span className="edit-draft"><em>nothing drafted yet</em></span></div>
                      <div className="edit-row"><span className="edit-lbl">Sent</span><span className="edit-sent">{s.sent}</span></div>
                    </>
                  ) : s.skipped ? (
                    <>
                      <div className="edit-row"><span className="edit-lbl">AI</span><span className="edit-draft"><em>chose not to draft</em></span></div>
                      {(s.sent || '').trim()
                        ? <div className="edit-row"><span className="edit-lbl">Sent</span><span className="edit-sent">{s.sent}</span></div>
                        : <div className="edit-row"><span className="edit-lbl" /><span className="edit-sent"><em>left without replying — good skip</em></span></div>}
                    </>
                  ) : (
                    <>
                      <div className="edit-row"><span className="edit-lbl">Draft</span><span className="edit-draft">{s.draft}</span></div>
                      <div className="edit-row">
                        <span className="edit-lbl">{s.archived ? '' : 'Sent'}</span>
                        <span className="edit-sent">{s.archived ? <em>archived without replying</em> : s.sent}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
