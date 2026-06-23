import React from 'react';
import { initials, avatarGradient } from '../lib/format';

export default function Avatar({ name, size }) {
  const [a, b] = avatarGradient(name);
  return (
    <div
      className={'avatar' + (size === 'sm' ? ' sm' : '')}
      style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {initials(name)}
    </div>
  );
}
