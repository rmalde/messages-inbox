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

module.exports = { sendMessage };
