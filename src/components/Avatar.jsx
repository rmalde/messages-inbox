import React, { useEffect, useState } from 'react';
import { initials, avatarGradient } from '../lib/format';

// Cache resolved contact photos across renders (handle -> dataUrl|null).
const photoCache = new Map();

function useContactImage(handle) {
  const [img, setImg] = useState(() => (handle && photoCache.get(handle)) || null);
  useEffect(() => {
    if (!handle) { setImg(null); return; }
    if (photoCache.has(handle)) { setImg(photoCache.get(handle)); return; }
    let live = true;
    window.api.contactImage(handle).then((d) => {
      photoCache.set(handle, d || null);
      if (live) setImg(d || null);
    });
    return () => { live = false; };
  }, [handle]);
  return img;
}

const PersonGlyph = () => (
  <svg width="52%" height="52%" viewBox="0 0 24 24" fill="currentColor" opacity="0.9">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6v1H4z" />
  </svg>
);

// A single round avatar — contact photo if we have one, else initials on a
// muted gradient tile. A nameless phone/email handle gets a neutral person
// glyph instead of meaningless digit "initials".
function Single({ name, handle, className }) {
  const img = useContactImage(handle);
  if (img) {
    return (
      <div
        className={className}
        style={{ backgroundImage: `url("${img}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
    );
  }
  const label = initials(name || handle);
  const noName = !name || !/[A-Za-z]/.test(name); // a bare phone/email → no real initials
  const [a, b] = avatarGradient(name || handle);
  return (
    <div className={className} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      {noName ? <PersonGlyph /> : label}
    </div>
  );
}

// Two small overlapping bubbles for a group chat (the way Messages.app stacks
// participant icons). Falls back to a single tile when we only know one person.
function GroupAvatar({ name, participants, size }) {
  const names = (name || '').split(',').map((s) => s.trim()).filter(Boolean);
  const people = (participants || []).slice(0, 2).map((h, i) => ({ handle: h, name: names[i] }));
  if (people.length < 2) {
    return <Single name={names[0]} handle={people[0] && people[0].handle} className={'avatar' + (size === 'sm' ? ' sm' : '')} />;
  }
  return (
    <div className={'avatar group' + (size === 'sm' ? ' sm' : '')}>
      <Single name={people[1].name} handle={people[1].handle} className="g-tile back" />
      <Single name={people[0].name} handle={people[0].handle} className="g-tile front" />
    </div>
  );
}

export default function Avatar({ name, handle, participants, isGroup, size }) {
  if (isGroup) return <GroupAvatar name={name} participants={participants} size={size} />;
  return <Single name={name} handle={handle} className={'avatar' + (size === 'sm' ? ' sm' : '')} />;
}
