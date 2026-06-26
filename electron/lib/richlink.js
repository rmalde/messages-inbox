'use strict';

// Decode an iMessage URL-balloon payload (message.payload_data, an
// NSKeyedArchiver-encoded LPLinkMetadata) into a simple rich-link preview.
// All local — no network. Returns { title, summary, url, domain } or null.

const { parseBPList } = require('./bplist');

function domainOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h || null;
  } catch { return null; }
}

function decodeLinkPreview(buf) {
  let archive;
  try { archive = parseBPList(buf); } catch { return null; }
  const objs = archive && archive['$objects'];
  const top = archive && archive['$top'];
  if (!Array.isArray(objs) || !top || !top.root) return null;

  const deref = (v) => (v && typeof v === 'object' && typeof v.uid === 'number') ? objs[v.uid] : v;
  const str = (v) => { const o = deref(v); return typeof o === 'string' && o ? o : undefined; };

  let meta = deref(top.root);
  if (!meta || typeof meta !== 'object') return null;
  // The archived root is usually a wrapper; the LPLinkMetadata is nested.
  if (meta.richLinkMetadata) meta = deref(meta.richLinkMetadata);
  if (!meta || typeof meta !== 'object') return null;

  const title = str(meta.title);
  const summary = str(meta.summary);
  const siteName = str(meta.siteName);

  // URL / originalURL are NSURL objects: { 'NS.relative': <string>, 'NS.base': … }
  let url;
  for (const key of ['URL', 'originalURL']) {
    const o = deref(meta[key]);
    if (typeof o === 'string') { url = o; break; }
    if (o && typeof o === 'object') { const rel = str(o['NS.relative']); if (rel) { url = rel; break; } }
  }

  if (!title && !url && !summary) return null;
  const domain = url ? domainOf(url) : null;
  return {
    title: title || null,
    summary: summary || null,
    url: url || null,
    site: siteName || domain || null,
    domain,
  };
}

module.exports = { decodeLinkPreview };
