'use strict';

// Minimal binary plist (bplist00) parser — enough to read NSKeyedArchiver
// graphs (ints, reals, strings, data, arrays, dicts, UIDs). Returns a plain JS
// value; CF$UID references come back as { uid: <int> } so callers can resolve
// the $objects table themselves. No dependencies.

function readUInt(b, off, size) {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + b[off + i];
  return v;
}

function parseBPList(buf) {
  if (buf.length < 40 || buf.toString('latin1', 0, 8) !== 'bplist00') {
    throw new Error('not a binary plist');
  }
  const t = buf.length - 32; // trailer
  const offsetSize = buf[t + 6];
  const refSize = buf[t + 7];
  const numObjects = readUInt(buf, t + 8, 8);
  const topRef = readUInt(buf, t + 16, 8);
  const tableStart = readUInt(buf, t + 24, 8);

  const offsets = new Array(numObjects);
  for (let i = 0; i < numObjects; i++) {
    offsets[i] = readUInt(buf, tableStart + i * offsetSize, offsetSize);
  }

  function parse(index) {
    let off = offsets[index];
    const marker = buf[off++];
    const type = marker & 0xF0;
    const info = marker & 0x0F;
    const count = () => {
      if (info !== 0x0F) return info;
      const m = buf[off++];
      const n = 1 << (m & 0x0F);
      const c = readUInt(buf, off, n);
      off += n;
      return c;
    };
    switch (type) {
      case 0x00: return marker === 0x09 ? true : marker === 0x08 ? false : null;
      case 0x10: return readUInt(buf, off, 1 << info);
      case 0x20: return info === 3 ? buf.readDoubleBE(off) : buf.readFloatBE(off);
      case 0x30: return buf.readDoubleBE(off); // date — raw seconds since 2001
      case 0x40: { const n = count(); return Buffer.from(buf.subarray(off, off + n)); }
      case 0x50: { const n = count(); return buf.toString('latin1', off, off + n); }
      case 0x60: { const n = count(); return Buffer.from(buf.subarray(off, off + n * 2)).swap16().toString('utf16le'); }
      case 0x80: return { uid: readUInt(buf, off, info + 1) };
      case 0xA0: case 0xC0: {
        const n = count();
        const out = [];
        for (let i = 0; i < n; i++) out.push(parse(readUInt(buf, off + i * refSize, refSize)));
        return out;
      }
      case 0xD0: {
        const n = count();
        const keys = [];
        for (let i = 0; i < n; i++) keys.push(readUInt(buf, off + i * refSize, refSize));
        off += n * refSize;
        const obj = {};
        for (let i = 0; i < n; i++) obj[parse(keys[i])] = parse(readUInt(buf, off + i * refSize, refSize));
        return obj;
      }
      default: return null;
    }
  }
  return parse(topRef);
}

module.exports = { parseBPList };
