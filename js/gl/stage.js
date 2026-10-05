/**
 * stage.js — One renderer, two acts.
 *
 *   hero     the head turns slowly; the brain inside pulses with a coherent,
 *            slowed gamma wave that desynchronises when the reader asks it to
 *            "wander"
 *   headset  the camera orbits the headset through a fixed set of keyframes,
 *            calling out one part at a time, and ends on the 10–20 top view
 *
 * Rendering is two passes: the brain first, then — after clearing depth — a
 * depth-only copy of the head, the headset and the glass shell. Far-side
 * electrodes are hidden by the head's depth, while the brain stays visible
 * through the glass.
 *
 * Scroll writes { hero, headset, headsetVis, drift } through setState(); the
 * stage derives everything else.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { headGeometry, neckGeometry, headDots, brainPoints, surfacePoint } from './anatomy.js';
import { buildHeadset } from './headset.js';
import { CHANNELS, ZONE_OF } from '../dsp/montage.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

/** Camera keyframes through the headset chapter: h is the headset scroll position (0–4). */
const KEYS = [
  { h: 0.0, az: 35, el: 12, d: 5.8, call: null },
  { h: 0.55, az: 32, el: 20, d: 5.3, call: 'electrodes' },
  { h: 1.1, az: 98, el: 14, d: 5.1, call: 'adcl' },
  { h: 1.5, az: 12, el: 46, d: 5.0, call: 'serpentine' },
  { h: 1.9, az: -98, el: 14, d: 5.1, call: 'adcr' },
  { h: 2.45, az: -180, el: 6, d: 5.0, call: 'pod' },
  { h: 2.85, az: -222, el: -6, d: 4.8, call: 'tubes' },
  { h: 3.55, az: -180, el: 84, d: 5.6, call: null },
  { h: 4.0, az: -180, el: 84, d: 5.6, call: null },
];

const CALLOUTS = {
  electrodes: ['19 dry electrodes', 'The 10–20 layout, pressed to the scalp. No gel.'],
  adcl: ['ADC-L zone', 'Eight left-hemisphere channels, P3 among them.'],
  serpentine: ['Serpentine links', 'Zig-zag traces give every contact room to settle.'],
  adcr: ['ADC-R zone', 'Eight right-hemisphere channels.'],
  pod: ['Main pod', 'Midline converter, microcontroller and audio driver.'],
  tubes: ['Acoustic tubes', 'Audio from the pod to both ears.'],
};

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const light = v('color-scheme').includes('light') || document.documentElement.dataset.theme === 'light' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: light)').matches);
  return {
    light,
    bg: v('--bg'), violet: v('--violet'), violetHi: v('--violet-hi'), amber: v('--amber'),
    zones: { left: v('--zone-l'), right: v('--zone-r'), mid: v('--zone-m'), bus: v('--zone-bus'), tube: v('--zone-tube'), mech: v('--zone-mech') },
  };
}

export async function createStage(canvas, labelsEl, { lowPower = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const maxDpr = lowPower ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const target = new THREE.Vector3(0, 0.02, 0);
  const brainScene = new THREE.Scene();
  const scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xbfb8ff, 0x1a1420, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb9adff, 1.2); rim.position.set(-4, 2, -4); scene.add(rim);

  let tc = themeColors();
  const col = (c) => new THREE.Color(c);

  /* ── brain ─────────────────────────────────────────────────────────── */
  const brainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uDrift: { value: 0 }, uScale: { value: 400 }, uSize: { value: 0.017 },
      uA: { value: col(tc.violet) }, uB: { value: col(tc.amber) }, uOpacity: { value: 1 }, uLight: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform float uTime, uDrift, uScale, uSize;
      attribute float aSeed;
      attribute float aRegion;
      varying float vI;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Coherent: one travelling wavefront, front to back (slowed for the eye).
        float locked = 0.5 + 0.5 * sin(dot(position, vec3(0.0, 0.45, -1.6)) * 3.6 - uTime * 3.4);
        // Wandering: every point on its own frequency and phase.
        float own = 0.5 + 0.5 * sin(uTime * (1.6 + 5.0 * fract(aSeed * 17.31)) + aSeed * 61.0);
        float w = mix(locked, own, uDrift);
        vI = pow(w, 3.0);
        gl_PointSize = uSize * (0.55 + 0.95 * vI) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uA, uB;
      uniform float uOpacity, uLight;
      varying float vI;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float soft = smoothstep(0.25, 0.0, d);
        vec3 color = mix(uA, uB, smoothstep(0.35, 1.0, vI));
        float a = soft * (0.07 + 0.62 * vI) * uOpacity;
        gl_FragColor = vec4(color * mix(1.0, 0.9, uLight), a * mix(1.0, 0.75, uLight));
        #include <colorspace_fragment>
      }`,
  });
  const brain = new THREE.Points(brainPoints(lowPower ? 7000 : 12000), brainMat);
  brainScene.add(brain);

  /* ── head ──────────────────────────────────────────────────────────── */
  const shellMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    uniforms: { uRim: { value: col(tc.violetHi) }, uBase: { value: new THREE.Color(0x000000) }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vY = wp.y;
        vec4 mv = viewMatrix * wp;
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uRim, uBase; uniform float uAlpha;
      varying vec3 vN; varying vec3 vV; varying float vY;
      void main() {
        float fr = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.3);
        float fade = smoothstep(-1.9, -1.05, vY);
        gl_FragColor = vec4(uBase + uRim * fr, (0.04 + 0.8 * fr) * uAlpha * fade);
        #include <colorspace_fragment>
      }`,
  });
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const headGeo = headGeometry(lowPower ? 0.7 : 1);
  const neckGeo = neckGeometry();
  const head = new THREE.Group();
  for (const g of [headGeo, neckGeo]) {
    const pre = new THREE.Mesh(g, depthMat); pre.renderOrder = -1;
    const shell = new THREE.Mesh(g, shellMat); shell.renderOrder = 2;
    head.add(pre, shell);
  }
  const dotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: col(tc.violetHi) }, uScale: { value: 400 }, uSize: { value: 0.012 }, uAlpha: { value: 0.55 } },
    vertexShader: /* glsl */`
      uniform float uScale, uSize; attribute vec3 aNormal; varying float vF;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * aNormal);
        vF = clamp(dot(n, normalize(-mv.xyz)), 0.0, 1.0);
        gl_PointSize = uSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; varying float vF;
      void main() {
        vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard;
        gl_FragColor = vec4(uColor, uAlpha * vF * vF);
        #include <colorspace_fragment>
      }`,
  });
  const dots = new THREE.Points(headDots(lowPower ? 2600 : 4200), dotMat);
  dots.renderOrder = 1;
  head.add(dots);
  scene.add(head);

  /* ── headset ───────────────────────────────────────────────────────── */
  let headset = buildHeadset(tc.zones);
  scene.add(headset.group);

  /* ── post ──────────────────────────────────────────────────────────── */
  const composer = new EffectComposer(renderer);
  const brainPass = new RenderPass(brainScene, camera);
  const mainPass = new RenderPass(scene, camera);
  mainPass.clear = false;
  mainPass.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 0.32);
  composer.addPass(brainPass);
  composer.addPass(mainPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ── labels + callout ──────────────────────────────────────────────── */
  const labels = {};
  for (const ch of CHANNELS) {
    const el = document.createElement('span');
    el.className = 'elabel';
    el.dataset.zone = ZONE_OF[ch.id];
    el.textContent = ch.id;
    el.style.opacity = '0';
    labelsEl.append(el);
    labels[ch.id] = el;
  }
  const callout = document.createElement('div');
  callout.className = 'callout';
  callout.innerHTML = '<b></b><span></span>';
  const line = document.createElement('i'); line.className = 'callout-line';
  const dot = document.createElement('i'); dot.className = 'callout-dot';
  labelsEl.append(line, dot, callout);
  let activeCall = null;

  /* ── state ─────────────────────────────────────────────────────────── */
  const state = { hero: 0, headset: 0, headsetVis: 0, drift: 0, highlight: null };
  let drift = 0, opacity = 0, running = false, raf = 0, t0 = performance.now();
  let width = 1, height = 1;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyTheme() {
    tc = themeColors();
    // The composer's first RenderPass clears its linear target with the clear
    // colour already encoded to sRGB, and OutputPass encodes again on the way
    // out. Pre-decode once more so the page background lands exactly on --bg.
    renderer.setClearColor(new THREE.Color(tc.bg).convertSRGBToLinear(), 1);
    brainMat.uniforms.uA.value.set(tc.violet);
    brainMat.uniforms.uB.value.set(tc.amber);
    brainMat.uniforms.uLight.value = tc.light ? 1 : 0;
    brainMat.blending = tc.light ? THREE.NormalBlending : THREE.AdditiveBlending;
    brainMat.needsUpdate = true;
    shellMat.uniforms.uRim.value.set(tc.light ? tc.violet : tc.violetHi);
    shellMat.uniforms.uAlpha.value = tc.light ? 0.75 : 1;
    dotMat.uniforms.uColor.value.set(tc.light ? tc.violet : tc.violetHi);
    dotMat.uniforms.uAlpha.value = tc.light ? 0.45 : 0.55;
    for (const [k, m] of Object.entries(headset.zoneMat)) { m.color.set(tc.zones[k]); m.emissive.set(tc.zones[k]); m.emissiveIntensity = tc.light ? 0.05 : 0.35; }
    for (const e of Object.values(headset.electrodes)) {
      const c = tc.zones[e.userData.zone];
      e.userData.ring.material.color.set(c); e.userData.ring.material.emissive.set(c);
    }
    bloom.enabled = !tc.light;
  }

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.setSize(width * 0.5, height * 0.5);
    camera.aspect = width / height;
    const scale = (height * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * DEG) / 2));
    brainMat.uniforms.uScale.value = scale;
    dotMat.uniforms.uScale.value = scale;
  }

  function keyframe(h) {
    let i = 0;
    while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smooth(0, 1, (h - a.h) / (b.h - a.h));
    const near = (h - a.h) / (b.h - a.h) < 0.5 ? a : b;
    const callT = Math.abs(h - near.h) < 0.17 ? near.call : null;
    return { az: lerp(a.az, b.az, t), el: lerp(a.el, b.el, t), d: lerp(a.d, b.d, t), call: callT };
  }

  function pose(time) {
    const portrait = width / height < 0.9;
    const wide = width > 900;
    let az, el, d, shiftX, shiftY, call = null;
    if (state.headsetVis > 0.001 && state.headsetVis >= 1 - smooth(0.55, 1.0, state.hero)) {
      const k = keyframe(state.headset);
      az = k.az; el = k.el; d = k.d; call = k.call;
      shiftX = wide ? -0.17 : 0;
      shiftY = wide ? 0 : 0.2;
      if (portrait) d *= 1.32;
    } else {
      const idle = reduced ? 0 : Math.sin(time * 0.17) * 7;
      az = 34 + idle + pointer.sx * 8;
      el = 10 + pointer.sy * 4 + state.hero * 10;
      d = 5.9 - state.hero * 0.6;
      shiftX = wide ? -0.2 : 0;
      shiftY = wide ? 0.02 : 0.27;
      if (portrait) d *= 1.55;
    }
    const azr = az * DEG, elr = el * DEG;
    camera.position.set(
      target.x + d * Math.cos(elr) * Math.sin(azr),
      target.y + d * Math.sin(elr),
      target.z + d * Math.cos(elr) * Math.cos(azr),
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.setViewOffset(width, height, shiftX * width, shiftY * height, width, height);
    camera.updateProjectionMatrix();
    return call;
  }

  const tmp = new THREE.Vector3();
  const toScreen = (v) => { tmp.copy(v).project(camera); return [(tmp.x * 0.5 + 0.5) * width, (-tmp.y * 0.5 + 0.5) * height, tmp.z]; };
  const camDir = new THREE.Vector3();

  function updateLabels(call) {
    const show = state.headsetVis * opacity;
    const topView = state.headset > 3.15;
    camDir.copy(camera.position).sub(target).normalize();
    for (const [id, e] of Object.entries(headset.electrodes)) {
      const el = labels[id];
      const n = e.userData.normal;
      const facing = clamp((n.dot(camDir) - 0.1) / 0.5);
      const a = show * facing * (topView ? 1 : 0.85) * (state.highlight && state.highlight !== id ? 0.55 : 1);
      if (a < 0.02) { if (el.style.opacity !== '0') el.style.opacity = '0'; continue; }
      const p = e.position.clone().addScaledVector(n, 0.11);
      const [sx, sy] = toScreen(p);
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.opacity = a.toFixed(3);
    }

    const name = show > 0.3 ? call : null;
    if (name !== activeCall) {
      activeCall = name;
      if (name) { callout.querySelector('b').textContent = CALLOUTS[name][0]; callout.querySelector('span').textContent = CALLOUTS[name][1]; }
    }
    const vis = name ? 1 : 0;
    callout.style.opacity = line.style.opacity = dot.style.opacity = String(vis);
    if (!name) return;
    const anchor = headset.anchors[name];
    const ap = anchor.getWorldPosition(new THREE.Vector3());
    const [ax, ay] = toScreen(ap);
    const [cx, cy] = toScreen(target);
    let dx = ax - cx, dy = ay - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const reach = Math.min(170, width * 0.16);
    const boxW = callout.offsetWidth || 240, boxH = callout.offsetHeight || 70;
    let bx = ax + dx * reach, by = ay + dy * reach * 0.7;
    bx = dx > 0 ? bx : bx - boxW;
    by -= boxH / 2;
    const minX = width > 900 ? width * 0.42 : 12;
    bx = clamp(bx, minX, width - boxW - 12);
    by = clamp(by, 80, height - boxH - 16);
    callout.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`;
    const ex = dx > 0 ? bx : bx + boxW, ey = by + boxH / 2;
    const ll = Math.hypot(ex - ax, ey - ay);
    line.style.width = `${ll.toFixed(1)}px`;
    line.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px) rotate(${Math.atan2(ey - ay, ex - ax)}rad)`;
    dot.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px)`;
  }

  function frame(now) {
    raf = 0;
    const time = (now - t0) / 1000;
    const target01 = state.drift;
    drift += (target01 - drift) * 0.06;
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    brainMat.uniforms.uTime.value = reduced ? 1.2 : time;
    brainMat.uniforms.uDrift.value = drift;
    brainMat.uniforms.uOpacity.value = lerp(1, 0.28, state.headsetVis);

    for (const e of Object.values(headset.electrodes)) {
      const hot = state.highlight === e.userData.id;
      const m = e.userData.ring.material;
      m.emissiveIntensity = hot ? 2.2 : tc.light ? 0.05 : 0.35;
      if (hot) m.emissive.set(tc.amber); else m.emissive.set(tc.zones[e.userData.zone]);
    }

    const call = pose(time);
    composer.render();
    updateLabels(call);
    if (running) raf = requestAnimationFrame(frame);
  }

  function setOpacity(o) {
    opacity = o;
    canvas.style.opacity = o.toFixed(3);
    const want = o > 0.003;
    if (want && !running) { running = true; if (!raf) raf = requestAnimationFrame(frame); }
    else if (!want && running) {
      running = false;
      for (const el of Object.values(labels)) el.style.opacity = '0';
      callout.style.opacity = line.style.opacity = dot.style.opacity = '0';
    }
  }

  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  applyTheme();
  resize();
  pose(0);
  composer.render();
  canvas.classList.add('is-ready');

  const api = {
    setState(s) { Object.assign(state, s); },
    setOpacity,
    resize,
    applyTheme,
    highlight(id) { state.highlight = id; },
    renderOnce() { if (!raf) frame(performance.now()); },
  };
  if (new URLSearchParams(location.search).has('debug')) window.__nh = { api, bloom, brainMat, shellMat, camera, renderer, scene, brainScene, head, composer };
  return api;
}
