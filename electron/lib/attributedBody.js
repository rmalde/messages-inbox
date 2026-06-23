'use strict';

// macOS Messages stores most message text inside a binary `attributedBody`
// blob (a legacy NSArchiver "streamtyped" stream) rather than the `text`
// column. The visible string lives right after the `NSString` class marker:
//
//   ... NSString \x00 \x01 \x94 \x84 \x01 '+' <len> <utf8 bytes> ...
//
// <len> is a single byte for lengths < 128. For longer strings the byte is
// 0x81 followed by a uint16 (little-endian), or 0x82 followed by a uint32.
// The length counts UTF-8 *bytes*, not characters.

function decodeAttributedBody(hexOrBuf) {
  if (!hexOrBuf) return null;
  const buf = Buffer.isBuffer(hexOrBuf)
    ? hexOrBuf
    : Buffer.from(hexOrBuf, 'hex');
  if (buf.length === 0) return null;

  const marker = buf.indexOf('NSString', 0, 'latin1');
  if (marker === -1) return null;

  // First '+' (0x2B) after the NSString class marker introduces the bytes.
  let i = buf.indexOf(0x2b, marker);
  if (i === -1) return null;
  i += 1;

  let len = buf[i];
  i += 1;
  if (len === 0x81) {
    len = buf.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    len = buf.readUInt32LE(i);
    i += 4;
  }

  if (len <= 0 || i + len > buf.length) return null;
  const text = buf.slice(i, i + len).toString('utf8');
  return text.length ? text : null;
}

module.exports = { decodeAttributedBody };
