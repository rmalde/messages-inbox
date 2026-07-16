'use strict';

// Sending goes through AppleScript — the same channel Messages.app uses.
// We send to an existing chat by its GUID so replies land in the right
// thread (works for both 1:1 and group chats). Falls back to addressing the
// participant directly if the chat object can't be resolved.

const { execFile } = require('child_process');
const { OSASCRIPT } = require('./bin');

const SCRIPT = `
on run argv
  set chatGuid to item 1 of argv
  set theMessage to item 2 of argv
  set theHandle to item 3 of argv
  tell application "Messages"
    try
      set targetChat to a reference to chat id chatGuid
      send theMessage to targetChat
      return "ok:chat"
    on error
      set targetService to 1st service whose service type = iMessage
      set targetBuddy to participant theHandle of targetService
      send theMessage to targetBuddy
      return "ok:buddy"
    end try
  end tell
end run
`;

function sendMessage({ guid, text, handle }) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      OSASCRIPT,
      ['-', guid || '', text || '', handle || ''],
      { timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || '').trim()));
        resolve((stdout || '').trim());
      }
    );
    child.stdin.write(SCRIPT);
    child.stdin.end();
  });
}

// Reveal an existing (custom-named) group thread by reproducing the manual
// gesture: ⌘N opens a compose with the To: field focused, we type the group's
// name, and pick the autocomplete suggestion — which switches to the existing
// thread with history. ⌘N (not ⌘F) matters: focus lands in the recipient
// field, so the trailing Return only SELECTS a suggestion — it can never send
// a message. Requires Accessibility permission (System Events keystrokes).
function revealGroupByName(name) {
  const esc = String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (!esc.trim()) return Promise.resolve({ ok: false, error: 'empty name' });
  const lines = [
    'tell application "Messages" to activate',
    'delay 0.35',
    'tell application "System Events"',
    '  tell process "Messages"',
    '    set frontmost to true',
    '    keystroke "n" using {command down}',
    '    delay 0.5',
    `    keystroke "${esc}"`,
    '    delay 0.7',
    '    key code 125', // down arrow → highlight the first autocomplete suggestion
    '    delay 0.15',
    '    key code 36',  // return → select it (in the To: field this only picks a suggestion)
    '  end tell',
    'end tell',
  ];
  const args = [];
  for (const l of lines) { args.push('-e', l); }
  return new Promise((resolve) => {
    execFile(OSASCRIPT, args, { timeout: 10000 }, (err, _stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim();
        const needsAccessibility = /-1719|assistive access|not allowed/i.test(msg);
        return resolve({ ok: false, needsAccessibility, error: msg });
      }
      resolve({ ok: true });
    });
  });
}

module.exports = { sendMessage, revealGroupByName };
