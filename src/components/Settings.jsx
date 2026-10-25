import React, { useEffect, useState } from 'react';

function Toggle({ on, onChange }) {
  return (
    <button
      className={'toggle' + (on ? ' on' : '')}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export default function Settings({ onClose }) {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    let live = true;
    window.api.getSettings().then((s) => { if (live) setSettings(s || {}); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const autoDraft = !settings ? true : settings.autoDraft !== false; // default on

  async function set(key, value) {
    const next = await window.api.setSetting(key, value);
    setSettings(next);
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-panel">
        <div className="panel-title-row">
          <span className="panel-title">Settings</span>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6 L18 18 M18 6 L6 18" />
            </svg>
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-name">Auto drafting</div>
            <div className="setting-desc">Draft replies to incoming messages in the background</div>
          </div>
          <Toggle on={autoDraft} onChange={(v) => set('autoDraft', v)} />
        </div>
      </div>
    </div>
  );
}
