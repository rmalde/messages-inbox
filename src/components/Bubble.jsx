import React, { useEffect, useState } from 'react';
import Attachment from './Attachment';
import Avatar from './Avatar';
import { bubbleTime } from '../lib/format';

// Rich-link hero images, cached across renders (path -> dataUrl|null).
const linkImgCache = new Map();

function LinkCard({ lp }) {
  const [img, setImg] = useState(() => (lp.imagePath && linkImgCache.get(lp.imagePath)) || null);
  useEffect(() => {
    if (!lp.imagePath) { setImg(null); return; }
    if (linkImgCache.has(lp.imagePath)) { setImg(linkImgCache.get(lp.imagePath)); return; }
    let live = true;
    window.api.attachment(lp.imagePath).then((d) => {
      const url = (d && d.dataUrl) || null;
      linkImgCache.set(lp.imagePath, url);
      if (live) setImg(url);
    });
    return () => { live = false; };
  }, [lp.imagePath]);

  return (
    <div
      className="link-card"
      title={lp.url || ''}
      onClick={() => lp.url && window.api.openExternal(lp.url)}
    >
      {img && <img className="lc-img" src={img} alt="" draggable={false} />}
      {lp.title && <div className="lc-title">{lp.title}</div>}
      {lp.summary && <div className="lc-summary">{lp.summary}</div>}
      {(lp.site || lp.domain) && <div className="lc-site">{lp.site || lp.domain}</div>}
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s]+)/g;
const EMOJI_ONLY = /^(?:\s*(?:\p{Extended_Pictographic}️?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|[\u{1F1E6}-\u{1F1FF}]){1,3}\s*)$/u;

function linkify(text) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    URL_RE.test(p) ? (
      <a key={i} href={p} onClick={(e) => { e.preventDefault(); window.api.openExternal(p); }}>{p}</a>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export default function Bubble({ msg, groupPos, isGroup, animate }) {
  const mine = msg.fromMe;
  const sms = msg.service && msg.service !== 'iMessage';
  const lp = msg.linkPreview;
  // Strip U+FFFC — the invisible placeholder iMessage embeds where an
  // attachment sits in the text — before deciding what this bubble contains.
  const text = (msg.text || '').replace(/￼/g, '').trim();
  // When there's a card and the text is just a bare URL, hide the text (the
  // card represents it). Keep any text that has more than just the link.
  const textIsBareUrl = lp && text && /^https?:\/\/\S+$/i.test(text);
  const showText = text && !textIsBareUrl;
  const emojiOnly = text && !lp && EMOJI_ONLY.test(text) && msg.attachments.length === 0;
  // Image-only and link-card-only messages render bare — the media/card IS the
  // bubble in Messages, with no colored wrapper around it.
  const mediaOnly = !showText && (msg.attachments.length > 0 || !!lp);
  const tail = groupPos === 'single' || groupPos === 'last';
  const runStart = groupPos === 'single' || groupPos === 'first';

  const cls = [
    'bubble', mine ? 'mine' : 'theirs',
    sms && mine ? 'sms' : '',
    emojiOnly ? 'emoji-only' : '',
    mediaOnly ? 'media-only' : '',
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
            : <span style={{ width: 28, flexShrink: 0 }} />
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
          {showText && <span>{linkify(text)}</span>}
          {lp && <LinkCard lp={lp} />}

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
