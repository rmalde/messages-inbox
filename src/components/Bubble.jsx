import React from 'react';
import Attachment from './Attachment';
import Avatar from './Avatar';
import { bubbleTime } from '../lib/format';

const URL_RE = /(https?:\/\/[^\s]+)/g;
const EMOJI_ONLY = /^(?:\s*(?:\p{Extended_Pictographic}️?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|[\u{1F1E6}-\u{1F1FF}]){1,3}\s*)$/u;

function linkify(text) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    URL_RE.test(p) ? (
      <a key={i} href={p} onClick={(e) => { e.preventDefault(); window.open(p); }}>{p}</a>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export default function Bubble({ msg, groupPos, isGroup, animate }) {
  const mine = msg.fromMe;
  const sms = msg.service && msg.service !== 'iMessage';
  const emojiOnly = msg.text && EMOJI_ONLY.test(msg.text.trim()) && msg.attachments.length === 0;
  const tail = groupPos === 'single' || groupPos === 'last';
  const runStart = groupPos === 'single' || groupPos === 'first';

  const cls = [
    'bubble', mine ? 'mine' : 'theirs',
    sms && mine ? 'sms' : '',
    emojiOnly ? 'emoji-only' : '',
    msg.pending ? 'pending' : '',
    'gp-' + groupPos,
    tail && !emojiOnly ? 'tail' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={'msg-row ' + (mine ? 'mine' : 'theirs') + (runStart ? ' grp-start' : '') + (animate ? ' animate' : '')}>
      {runStart && isGroup && !mine && <div className="sender-label">{msg.sender}</div>}
      <div className="bubble-wrap">
        {isGroup && !mine && (
          tail
            ? <Avatar name={msg.sender} handle={msg.handle} size="sm" />
            : <span style={{ width: 26, flexShrink: 0 }} />
        )}
        <div className={cls}>
          {msg.replyPreview && (
            <div className="reply-quote">
              <span className="who">{msg.replyPreview.sender}</span>
              {(msg.replyPreview.text || 'Attachment').slice(0, 120)}
            </div>
          )}
          {msg.attachments.map((a) => (
            <Attachment key={a.id} att={a} />
          ))}
          {msg.text && <span>{linkify(msg.text)}</span>}

          {msg.reactions.length > 0 && (
            <div className="reactions">
              {msg.reactions.slice(0, 4).map((r, i) => (
                <div className="reaction" key={i} title={r.sender}>{r.glyph}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="bubble-time">{msg.pending ? 'Sending…' : bubbleTime(msg.date)}</div>
    </div>
  );
}
