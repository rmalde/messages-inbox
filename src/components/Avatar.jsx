import React, { useEffect, useState } from 'react';
import { initials, avatarGradient } from '../lib/format';

// Cache resolved contact photos across renders (handle -> dataUrl|null).
const photoCache = new Map();

export default function Avatar({ name, handle, size }) {
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

  const cls = 'avatar' + (size === 'sm' ? ' sm' : '');

  if (img) {
    return (
      <div
        className={cls}
        style={{ backgroundImage: `url("${img}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
    );
  }

  const [a, b] = avatarGradient(name);
  return (
    <div className={cls} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      {initials(name)}
    </div>
  );
}
