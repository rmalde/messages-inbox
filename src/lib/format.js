// Display helpers — timestamps, initials, deterministic avatar colors.

export function listTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const diffDays = (now - d) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function bubbleTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function daySeparator(ms) {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
  const diffDays = (now - d) / 86400000;
  if (diffDays < 7) {
    return `${d.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  }
  return d.toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  }) + `  ${time}`;
}

// Big gap between messages -> show a fresh day/time separator.
export function shouldSeparate(prevMs, ms) {
  if (!prevMs) return true;
  return ms - prevMs > 60 * 60 * 1000; // > 1 hour
}

export function initials(name) {
  if (!name) return '?';
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!clean) return '#';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  ['#FF6259', '#FF2D55'], ['#FFB340', '#FF9500'], ['#FFD426', '#FFCC00'],
  ['#5BD75B', '#34C759'], ['#5AC8FA', '#32ADE6'], ['#6E9CFF', '#007AFF'],
  ['#B07CFF', '#AF52DE'], ['#FF7AB6', '#FF2D55'], ['#9CA3AF', '#6B7280'],
];

export function avatarGradient(name) {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
