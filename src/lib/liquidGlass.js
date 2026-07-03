// Liquid glass — our own implementation, no library, no DOM captures.
//
// How it works: for each glass element we bake a displacement map onto a
// canvas — a rounded-rect signed-distance field turned into lens vectors,
// encoded in the R (x) and G (y) channels — and feed it to an SVG
// feDisplacementMap that the element references via backdrop-filter:
//
//   backdrop-filter: url(#lens) blur(..) saturate(..)
//
// The browser refracts whatever is REALLY behind the element, live — bubbles
// bend through the pane with zero capture lag. (Chromium supports SVG filters
// in backdrop-filter; this is the same technique as shuding/liquid-glass.)

import React, { useLayoutEffect, useRef } from 'react';

function smoothStep(a, b, t) {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function roundedRectSDF(x, y, halfW, halfH, radius) {
  const qx = Math.abs(x) - halfW + radius;
  const qy = Math.abs(y) - halfH + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

let svgRoot = null;
let uid = 0;

function ensureSvgRoot() {
  if (svgRoot && document.body.contains(svgRoot)) return svgRoot;
  svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgRoot.setAttribute('width', '0');
  svgRoot.setAttribute('height', '0');
  svgRoot.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;';
  svgRoot.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
  document.body.appendChild(svgRoot);
  return svgRoot;
}

// Bake the lens: neutral in the flat center, bending progressively toward the
// bezel so the backdrop magnifies through the middle and squeezes at the rim.
function bakeMap(w, h, { bezel = 0.15, curve = 0.8, shape }) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const data = new Uint8ClampedArray(w * h * 4);

  const halfW = shape?.halfW ?? 0.3;
  const halfH = shape?.halfH ?? 0.2;
  const radius = shape?.radius ?? 0.6;

  let maxScale = 0;
  const raw = new Float32Array(w * h * 2);
  let j = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ix = x / w - 0.5;
      const iy = y / h - 0.5;
      const sdf = roundedRectSDF(ix, iy, halfW, halfH, radius);
      const disp = smoothStep(curve, 0, sdf - bezel);
      const scaled = smoothStep(0, 1, disp);
      const dx = (ix * scaled + 0.5) * w - x;
      const dy = (iy * scaled + 0.5) * h - y;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      if (m > maxScale) maxScale = m;
      raw[j++] = dx;
      raw[j++] = dy;
    }
  }
  maxScale *= 0.5; // amplifies bend (values overflow 0..1 and clamp at the rim)

  j = 0;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (raw[j++] / maxScale + 0.5) * 255;
    data[i + 1] = (raw[j++] / maxScale + 0.5) * 255;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  return { url: canvas.toDataURL(), scale: maxScale };
}

export function applyLiquidGlass(el, opts = {}) {
  const id = 'lg-' + (++uid);
  const root = ensureSvgRoot();
  const defs = root.querySelector('defs');

  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('colorInterpolationFilters', 'sRGB');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  const feMap = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
  feMap.setAttribute('in', 'SourceGraphic');
  feMap.setAttribute('in2', id + '-src');
  feImage.setAttribute('result', id + '-src');
  feMap.setAttribute('xChannelSelector', 'R');
  feMap.setAttribute('yChannelSelector', 'G');
  filter.appendChild(feImage);
  filter.appendChild(feMap);
  defs.appendChild(filter);

  let lastW = 0, lastH = 0;
  const rebuild = () => {
    const r = el.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width));
    const h = Math.max(2, Math.round(r.height));
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    const { url, scale } = bakeMap(w, h, opts);
    filter.setAttribute('width', String(w));
    filter.setAttribute('height', String(h));
    feImage.setAttribute('width', String(w));
    feImage.setAttribute('height', String(h));
    feImage.setAttribute('href', url);
    const eff = Math.max(scale * (opts.strength ?? 1), opts.minScale ?? 0);
    feMap.setAttribute('scale', String(eff));
    const post = opts.post ?? 'blur(2px) saturate(1.5)';
    const value = ('url(#' + id + ') ' + post).trim();
    el.style.backdropFilter = value;
    el.style.webkitBackdropFilter = value;
  };

  rebuild();
  const ro = new ResizeObserver(rebuild);
  ro.observe(el);

  return () => {
    ro.disconnect();
    filter.remove();
    el.style.backdropFilter = '';
    el.style.webkitBackdropFilter = '';
  };
}

// Wrapper element: a pane of glass around arbitrary children.
export function Glass({ as = 'div', glass, children, ...props }) {
  const ref = useLiquidGlass(glass);
  return React.createElement(as, { ref, ...props }, children);
}

// Hook: attach to the element you want to become a pane of glass.
export function useLiquidGlass(opts) {
  const ref = useRef(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    return applyLiquidGlass(ref.current, optsRef.current || {});
  }, []);
  return ref;
}
