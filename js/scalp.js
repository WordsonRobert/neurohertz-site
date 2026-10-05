/**
 * scalp.js — The 10–20 top view, drawn once from montage.js wherever it is
 * needed: the boot check, the film's corner map and the headset's montage.
 */
import { CHANNELS, ZONE_OF, mapXY } from './dsp/montage.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
};

/** Build the map into `svg`; returns { set(id, state), all(state), nodes }. */
export function buildScalp(svg, { radius = 0.1, labels = true } = {}) {
  svg.textContent = '';
  el('circle', { class: 'scalp__ring', cx: 0, cy: 0, r: 0.4 }, svg);
  el('circle', { class: 'scalp__head', cx: 0, cy: 0, r: 0.95 }, svg);
  el('path', { class: 'scalp__nose', d: 'M-0.12,-0.94 L0,-1.1 L0.12,-0.94' }, svg);
  el('path', { class: 'scalp__ear', d: 'M-0.95,-0.14 C-1.06,-0.12 -1.08,0.12 -0.95,0.14' }, svg);
  el('path', { class: 'scalp__ear', d: 'M0.95,-0.14 C1.06,-0.12 1.08,0.12 0.95,0.14' }, svg);

  const nodes = {};
  for (const ch of CHANNELS) {
    const [x, y] = mapXY(ch.id);
    const g = el('g', { class: 'scalp__e', 'data-id': ch.id, 'data-zone': ZONE_OF[ch.id], transform: `translate(${x.toFixed(3)} ${y.toFixed(3)})` }, svg);
    el('circle', { r: radius }, g);
    if (labels) {
      const t = el('text', {}, g);
      t.textContent = ch.id;
    }
    nodes[ch.id] = g;
  }

  const set = (id, state, on = true) => nodes[id]?.classList.toggle(`is-${state}`, on);
  const all = (state, on = true) => Object.values(nodes).forEach((n) => n.classList.toggle(`is-${state}`, on));
  return { set, all, nodes };
}
