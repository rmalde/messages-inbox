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

// First token of a name ("Mike Liu SV Angel" -> "Mike"). Phone numbers /
// emails (no spaces) pass through unchanged.
export function firstName(name) {
  if (!name) return name;
  return name.trim().split(/\s+/)[0];
}

// Sidebar display: first names only. For groups, shorten each participant in a
// joined list ("Arjun Karanam, Michael Elabd" -> "Arjun, Michael"); leave a
// custom group name (no commas) as-is.
export function sidebarTitle(name, isGroup) {
  if (!name) return name;
  if (isGroup) {
    if (name.includes(',')) {
      return name.split(',').map((s) => firstName(s.trim())).filter(Boolean).join(', ');
    }
    return name;
  }
  return firstName(name);
}

export function initials(name) {
  if (!name) return '?';
  // For group names ("Arjun, Michael, +4") use just the first participant.
  const first = name.split(',')[0];
  const clean = first.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!clean) return '#';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Apple-style avatar gradients — a lighter tint up top easing into a richer
// tone of the same hue, vertically (matching iMessage's clean colored circles).
const AVATAR_COLORS = [
  ['#FF8D85', '#F0584E'], ['#FFB66B', '#F2913A'], ['#FFD76A', '#F3C53D'],
  ['#86E0A3', '#46C76E'], ['#7FD0F2', '#3AA7E0'], ['#8FB4F2', '#5E86E6'],
  ['#C3A6F0', '#9B6FE0'], ['#F2A0C8', '#E069A6'], ['#B6BECC', '#8A93A3'],
];

export function avatarGradient(name) {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
