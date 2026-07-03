// True liquid-glass material (WebGL refraction) via @ybouane/liquidglass.
// The header and composer become physical glass panels: the library rasterizes
// the conversation behind them and runs refraction / chromatic-aberration /
// fresnel shaders. Captures are snapshots, so we re-mark on scroll and content
// changes (throttled — rasterizing the thread is not free).

let instance = null;
let pending = false;

function throttle(fn, ms) {
  let last = 0, timer = null;
  return () => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(); }
    else if (!timer) {
      timer = setTimeout(() => { timer = null; last = Date.now(); fn(); }, ms - (now - last));
    }
  };
}

export async function mountGlass() {
  if (instance || pending) return;
  const root = document.querySelector('.main');
  const header = document.querySelector('.thread-header');
  const composer = document.querySelector('.composer');
  if (!root || !header || !composer) return;
  pending = true;
  try {
    const { LiquidGlass } = await import('@ybouane/liquidglass');

    header.dataset.config = JSON.stringify({
      cornerRadius: 0,
      zRadius: 12,
      blurAmount: 0.42,
      refraction: 0.2,
      chromAberration: 0.02,
      edgeHighlight: 0.015,
      specular: 0.04,
      fresnel: 0.2,
      brightness: -0.015,
      shadowOpacity: 0,
    });
    composer.dataset.config = JSON.stringify({
      cornerRadius: 0,
      zRadius: 18,
      blurAmount: 0.34,
      refraction: 0.26,
      chromAberration: 0.025,
      edgeHighlight: 0.02,
      specular: 0.05,
      fresnel: 0.3,
      brightness: -0.01,
      shadowOpacity: 0,
    });

    document.body.classList.add('lg-on');
    instance = await LiquidGlass.init({ root, glassElements: [header, composer] });
    window.__lgMark = throttle(() => { if (instance) instance.markChanged(); }, 350);
  } catch (e) {
    document.body.classList.remove('lg-on');
    console.error('liquid glass failed to mount:', e);
  } finally {
    pending = false;
  }
}

export function unmountGlass() {
  if (instance) {
    try { instance.destroy(); } catch { /* already gone */ }
    instance = null;
  }
  window.__lgMark = undefined;
  document.body.classList.remove('lg-on');
}
