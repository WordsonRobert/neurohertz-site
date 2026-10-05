/**
 * story.js — The scroll score.
 *
 * One writer: every frame, `derive()` reads the scroll position and computes
 * the whole stage from it — the film position f (0–5), the headset orbit h
 * (0–4), the 3D layer's visibility, the active nav link and the progress bar.
 * Chapters never write shared state themselves, so the result never depends on
 * the order in which their triggers happen to fire.
 *
 * f and h are anchored to the panel cards: when card i is centred on the
 * reading line, the matching act is exactly halfway through beat i.
 */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function absTop(el) {
  let y = 0;
  for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
  return y;
}

function cardTrack(cards) {
  let centers = [];
  return {
    measure() { centers = cards.map((c) => absTop(c) + c.offsetHeight / 2); },
    at(line) {
      const n = centers.length;
      if (!n) return 0;
      if (line <= centers[0]) return clamp(0.5 - (centers[0] - line) / (centers[1] - centers[0]) * 1, 0, 0.5);
      for (let i = 0; i < n - 1; i++) {
        if (line < centers[i + 1]) return i + 0.5 + (line - centers[i]) / (centers[i + 1] - centers[i]);
      }
      return clamp(n - 0.5 + (line - centers[n - 1]) / (centers[n - 1] - centers[n - 2]), 0, n);
    },
  };
}

export function initStory({ scope, stage, film = {} }) {
  const lenis = window.Lenis && !reduced ? new window.Lenis({ lerp: 0.11, smoothWheel: true, wheelMultiplier: 1 }) : null;
  document.documentElement.classList.toggle('lenis', !!lenis);

  const filmEl = document.getElementById('film');
  const headsetEl = document.getElementById('headset');
  const filmCards = [...document.querySelectorAll('#film .step__card')];
  const headCards = [...document.querySelectorAll('#headset .hstep__card')];
  const filmTrack = cardTrack(filmCards);
  const headTrack = cardTrack(headCards);
  const progressEl = document.getElementById('progress');
  const navLinks = [...document.querySelectorAll('.nav__links a')];
  const navTargets = navLinks.map((a) => document.querySelector(a.getAttribute('href')));
  const sections = ['top', 'film', 'headset', 'tuning', 'results', 'lab', 'platform', 'uses', 'evidence', 'team', 'contact']
    .map((id) => document.getElementById(id)).filter(Boolean);

  let vh = window.innerHeight, docH = 1, mobile = false, navTops = [];
  let lastNav = null, lastBeat = -1;

  function readLine() { return mobile ? vh * 0.8 : vh * 0.5; }

  function measure() {
    vh = window.innerHeight;
    mobile = window.innerWidth <= 900;
    docH = document.documentElement.scrollHeight;
    filmTrack.measure();
    headTrack.measure();
    navTops = navTargets.map((t) => (t ? absTop(t) : Infinity));
    scope?.resize();
    stage?.resize();
  }

  function derive() {
    const y = window.scrollY;
    const line = y + readLine();

    const f = filmTrack.at(line);
    const h = headTrack.at(line);
    const fr = filmEl.getBoundingClientRect();
    const hr = headsetEl.getBoundingClientRect();

    if (scope) {
      scope.setVisible(fr.top < vh && fr.bottom > 0);
      scope.setF(f);
      const beat = Math.min(4, Math.floor(f));
      if (beat !== lastBeat) { lastBeat = beat; film.onBeat?.(beat); }
    }

    if (stage) {
      const heroP = clamp(y / (vh * 0.85));
      const heroVis = 1 - smooth(0.45, 0.95, heroP);
      const enter = smooth(vh * 1.05, vh * 0.3, hr.top);
      const exit = 1 - smooth(vh * 0.55, vh * 0.05, hr.bottom);
      const headsetVis = Math.min(enter, exit);
      stage.setState({ hero: heroP, headset: h, headsetVis });
      stage.setOpacity(Math.max(heroVis, headsetVis));
    }

    progressEl.style.transform = `scaleX(${clamp(y / Math.max(1, docH - vh)).toFixed(4)})`;

    // Active chapter for the nav: the last target whose top is above the line.
    let active = null;
    navTops.forEach((top, i) => { if (top - vh * 0.5 <= y + vh * 0.2) active = navLinks[i]; });
    if (y < vh * 0.5) active = null;
    if (active !== lastNav) {
      lastNav?.classList.remove('is-active');
      active?.classList.add('is-active');
      lastNav = active;
    }
  }

  function loop(t) {
    lenis?.raf(t);
    derive();
    requestAnimationFrame(loop);
  }

  // In-page links: centre film/headset cards on the reading line, land other sections under the nav.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const el = id === '#top' ? document.body : document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('nh:navigate'));
    let to;
    const card = el.querySelector?.('.step__card, .hstep__card');
    if (id === '#top') to = 0;
    else if (card) to = absTop(card) + card.offsetHeight / 2 - readLine();
    else to = absTop(el) - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 64) * 0.4;
    if (lenis) lenis.scrollTo(Math.max(0, to), { duration: 1.6 });
    else window.scrollTo({ top: Math.max(0, to), behavior: reduced ? 'auto' : 'smooth' });
    history.replaceState(null, '', id);
  });

  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(measure, 120); });
  window.addEventListener('load', measure);
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(measure, 120); }).observe(document.body);

  measure();
  requestAnimationFrame(loop);

  // Respect a deep link once layout has settled.
  if (location.hash && location.hash.length > 1) {
    const el = document.querySelector(location.hash);
    if (el) setTimeout(() => { const card = el.querySelector?.('.step__card, .hstep__card'); const to = card ? absTop(card) + card.offsetHeight / 2 - readLine() : absTop(el); window.scrollTo(0, Math.max(0, to)); lenis?.scrollTo(Math.max(0, to), { immediate: true }); }, 60);
  }

  return { lenis, measure, sections };
}
