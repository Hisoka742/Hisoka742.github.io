// Glass-shard portfolio engine: every page is a smoked-glass slab with its content printed on the shards.
// Navigating shatters the current page and the next one flies in; "Case study →" shatters into a reading view.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PROFILE, T, PROJECTS, contactRows, metricValue } from './content.js';
import { state, setLang, parseRoute, baseHash, pageTitle } from './state.js';

/* ------------------------------------------------------------------ constants */
const BG = 0x050507;
const DEG = Math.PI / 180;
const DUR = 0.72;      // shatter / reassemble duration, s
const T_PHYS = 0.9;    // physical flight time that progress p∈[0,1] maps onto
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MID = 0.3635;    // Inter (ascender − descender) / 2, em: centres a DOM line box on the canvas baseline
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeInCubic = x => x * x * x;
const easeOutBack = x => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const clock = () => performance.now() / 1000;
const wa = a => `rgba(255,255,255,${a})`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* cut pattern, panel-normalised (x right, y down) */
const BASE = { tAB: [.22, 0], tBC: [.515, 0], tCE: [.84, 0], bAD: [.34, 1], bDE: [.865, 1], J0: [.385, .72], J1: [.48, .62], J2: [.716, .49] };
const CELLS = [
  ['TL', 'tAB', 'J0', 'bAD', 'BL'],        // A (hero)
  ['tAB', 'tBC', 'J1', 'J0'],              // B
  ['tBC', 'tCE', 'J2', 'J1'],              // C
  ['J0', 'J1', 'J2', 'bDE', 'bAD'],        // D
  ['tCE', 'TR', 'BR', 'bDE', 'J2'],        // E
];

/* ------------------------------------------------------------------ state */
let renderer, scene, camera, tilt, L, current = null, sliver;
const leaving = [];
let readerOpen = false, pending = null, busyUntil = 0, uid = 0;
let tiltX = .8 * DEG, tiltY = -1.2 * DEG, lastT = 0;
const U = { uPointer: { value: new THREE.Vector3(1e5, 1e5, 0) }, uGlow: { value: 0 }, uS: { value: 1 } };
const ptr = { x: -1, y: -1, nx: 0, ny: 0, inside: false, bx: -1e5, by: -1e5 };
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const $ui = document.getElementById('ui');
const $reader = document.getElementById('reader');
const $back = document.getElementById('back');
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _hit = new THREE.Vector3(), _plane = new THREE.Plane();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

/* ------------------------------------------------------------------ layout */
function computeL() {
  const W = innerWidth, H = innerHeight;
  const phone = W < 640 || H < 460;
  const mx = phone ? 16 : W * .055, my = phone ? 16 : H * .085;
  const bw = W - 2 * mx, bh = H - 2 * my;
  const portrait = H > W * 1.05;
  const S = phone ? Math.max(bw, bh) / 1730 * 1.2 : bw / 1730;
  const navH = phone ? 56 : Math.max(bh * .108, 58);
  const panelTop = navH + (phone ? 10 : 14), panelH = bh - panelTop;
  const depth = 13 * S, bevel = Math.max(2.6 * S, 1.4);
  const dpr = Math.min(Math.max(1.5, Math.min(devicePixelRatio || 1, 2)), 4096 / bw, 4096 / bh);
  return {
    W, H, phone, portrait, mx, my, bw, bh, S, navH, panelTop, panelH, dpr,
    gap: Math.max(14 * S, 8), depth, bevel, radius: Math.max(20 * S, 9) - bevel, zF: depth + bevel,
  };
}

/* ------------------------------------------------------------------ glass material */
function makeGlassMaterial(glowMul = 1, irid = .55) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x17171b, metalness: 0, roughness: .36, clearcoat: .7, clearcoatRoughness: .12, specularIntensity: .7,
    iridescence: irid, iridescenceIOR: 1.3, iridescenceThicknessRange: [250, 650], envMapIntensity: 1, transparent: true,
  });
  const gm = { value: glowMul };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uPointer: U.uPointer, uGlow: U.uGlow, uS: U.uS, uGlowMul: gm });
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uPointer; uniform float uGlow; uniform float uS; uniform float uGlowMul; varying vec3 vWPos;\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float dG = length(vWPos - uPointer) / (300.0 * uS);
    totalEmissiveRadiance += vec3(.42, .37, .62) * .16 * exp(-1.6 * dG * dG) * uGlow * uGlowMul; }`);
  };
  m.customProgramCacheKey = () => 'facet-glass';
  return m;
}

/* ------------------------------------------------------------------ polygon helpers */
function insetPoly(pts, d) {
  const n = pts.length;
  let A = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; A += x1 * y2 - x2 * y1; }
  const sg = A > 0 ? 1 : -1;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1; ex /= l; ey /= l;
    return [a[0] - ey * sg * d, a[1] + ex * sg * d, ex, ey];
  });
  return lines.map((L2, i) => {
    const L1 = lines[(i - 1 + n) % n];
    const den = L1[2] * L2[3] - L1[3] * L2[2];
    if (Math.abs(den) < 1e-6) return [L2[0], L2[1]];
    const t = ((L2[0] - L1[0]) * L2[3] - (L2[1] - L1[1]) * L2[2]) / den;
    return [L1[0] + L1[2] * t, L1[1] + L1[3] * t];
  });
}

function roundedShape(pts, r) {
  const n = pts.length, s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1, lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const rr = Math.min(r, la * .45, lb * .45);
    const p1 = [p[0] + (a[0] - p[0]) / la * rr, p[1] + (a[1] - p[1]) / la * rr];
    const p2 = [p[0] + (b[0] - p[0]) / lb * rr, p[1] + (b[1] - p[1]) / lb * rr];
    if (i === 0) s.moveTo(p1[0], p1[1]); else s.lineTo(p1[0], p1[1]);
    s.quadraticCurveTo(p[0], p[1], p2[0], p2[1]);
  }
  s.closePath();
  return s;
}

/* ------------------------------------------------------------------ text measuring */
const mctx = document.createElement('canvas').getContext('2d');
const hasLS = 'letterSpacing' in mctx;
function setFont(ctx, w, size, tr) {
  ctx.font = `${w} ${size}px ${FONT}`;
  if (hasLS) ctx.letterSpacing = `${(tr || 0) * size}px`;
}
function measure(s, w, size, tr) { setFont(mctx, w, size, tr); return mctx.measureText(s).width; }
function wrap(s, w, size, tr, maxW) {
  const out = []; let line = '';
  for (const word of s.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (line && measure(t, w, size, tr) > maxW) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
function txt(o) {
  const weight = o.weight || 400, tr = o.tr || 0, size = o.size;
  const lines = [];
  for (const s of (o.lines || [o.str])) lines.push(...(o.maxW ? wrap(s, weight, size, tr, o.maxW) : [s]));
  const widths = lines.map(l => measure(l, weight, size, tr));
  const lhPx = size * (o.lh || 1.3);
  return { ...o, k: 'text', weight, tr, lines, widths, w: Math.max(0, ...widths), lhPx, last: o.y + (lines.length - 1) * lhPx };
}
function moveText(it, y) { it.y = y; it.last = y + (it.lines.length - 1) * it.lhPx; return it; }

/* ------------------------------------------------------------------ page layouts */
function pageCtx(k, compact) {
  const { bw: pw, panelTop: pt, panelH: ph, portrait, S } = L;
  const c = { k, compact, pw, pt, ph, portrait, items: [], bottom: 0, footTop: Infinity };
  if (!portrait) Object.assign(c, {
    x0: pw * .062, eb: Math.max(11 * S, 11), fs: Math.max(11 * S, 11),
    hs: Math.min(pw * .078, ph * .2) * k, ss: clamp(19 * S, 14.5, 21) * Math.min(1, k + .08),
    sm: clamp(14 * S, 12, 15.5) * Math.min(1, k + .1), ebY: pt + ph * .135, footY: pt + ph * .925,
    pillH: Math.max(40 * S, 36), pillFs: clamp(15 * S, 13.5, 16),
  });
  else Object.assign(c, {
    x0: Math.max(pw * .075, 18), eb: 10.5, fs: 10.5,
    hs: Math.min(pw * .118, ph * .075) * k, ss: clamp(pw * .042, 13.5, 17) * Math.min(1, k + .08),
    sm: clamp(pw * .034, 11.5, 14) * Math.min(1, k + .1), ebY: pt + ph * .075, footY: pt + ph * .955,
    pillH: 38, pillFs: 14,
  });
  c.x1 = pw - c.x0;
  c.add = (it, flow = true) => {
    c.items.push(it);
    if (flow) c.bottom = Math.max(c.bottom, it.k === 'text' ? it.last + it.size * .3 : it.y + (it.h || 0));
    return it;
  };
  c.eyebrow = (str, y = c.ebY, x = c.x0, maxW = c.x1 - x) =>
    c.add(txt({ str: str.toUpperCase(), x, y, size: c.eb, weight: 500, tr: .2, lh: 1.65, color: wa(.38), maxW }));
  c.headline = (lines, y, x = c.x0, size = c.hs, maxW = c.x1 - x) =>
    c.add(txt({ lines, x, y, size, weight: 500, tr: -.045, lh: .97, grad: ['#dcdce0', '#bdbdc3'], maxW }));
  c.para = (str, y, maxW, o = {}) =>
    c.add(txt({ str, x: o.x ?? c.x0, y, size: o.size ?? c.ss, color: o.color ?? wa(.55), lh: o.lh ?? 1.5, maxW }));
  c.buttons = (top, list, x0 = c.x0) => {
    let x = x0, y = top, bottom = top + c.pillH;
    for (const b of list) {
      const id = 'b' + (++uid);
      if (b.pill) {
        const lw = measure(b.pill, 500, c.pillFs, -.005);
        const w = Math.max(116 * L.S, lw + c.pillFs * 2.8);
        if (x > x0 && x + w > c.x1) { x = x0; y += c.pillH + 12; }
        c.add({ k: 'pill', x, y, w, h: c.pillH, label: b.pill, lw, size: c.pillFs, id, href: b.href, ext: b.ext });
        x += w + c.pillFs * 1.9;
      } else {
        const lw = measure(b.link, 500, c.pillFs, 0);
        if (x > x0 && x + lw > c.x1) { x = x0; y += c.pillH + 4; }
        c.add(txt({ str: b.link, x, y: y + c.pillH / 2 + c.pillFs * .35, size: c.pillFs, weight: 500, color: wa(.86), hover: '#fff', underline: true, id, href: b.href, ext: b.ext }));
        x += lw + c.pillFs * 2.1;
      }
      bottom = y + c.pillH;
    }
    return bottom;
  };
  c.foot = (l, r, o = {}) => {
    const mk = (str, x, align, href, wrapIt) => c.add(txt({
      str, x, y: c.footY, size: c.fs, tr: .02, color: href ? wa(.5) : wa(.34), hover: href ? wa(.95) : null,
      align, id: href ? 'f' + (++uid) : null, href, maxW: wrapIt ? c.x1 - c.x0 : null,
    }), false);
    let list;
    if (!c.portrait || o.row) list = [mk(l, c.x0, 'left', o.lh), mk(r, c.x1, 'right', o.rh)];
    else {
      const b = mk(l, c.x0, 'left', o.lh, true), a = mk(r, c.x0, 'left', o.rh, true);
      moveText(b, c.footY - (b.lines.length - 1) * b.lhPx);
      moveText(a, b.y - b.size * 1.9 - (a.lines.length - 1) * a.lhPx);
      list = [a, b];
    }
    c.footTop = Math.min(...list.map(i => i.y - i.size));
  };
  c.fits = () => c.bottom + c.fs * 1.2 <= c.footTop;
  return c;
}

function homePage(c, t, lang) {
  const h = t.home;
  const e = c.eyebrow(h.eyebrow, c.ebY, c.x0, c.portrait ? c.x1 - c.x0 : c.pw * .6);
  const hl = c.headline(t.nameLines, e.last + c.hs * 1.16);
  const sub = c.para(h.sub, hl.last + c.hs * (c.portrait ? .95 : .6), c.portrait ? c.x1 - c.x0 : c.pw * .46);
  const bb = c.buttons(sub.last + c.ss * 1.4, [{ pill: h.cta, href: '#/work' }, { link: h.link, href: '#/skills' }]);
  if (!(c.portrait && c.compact)) {
    const P0 = PROJECTS[0], href = '#/p/' + P0.id;
    const fx = c.portrait ? c.x0 : c.pw * .655, fw = c.x1 - fx;
    const fe = c.eyebrow(h.featEyebrow, c.portrait ? bb + c.ss * 2.6 : c.pt + c.ph * .6, fx, fw);
    const ft = c.add(txt({ str: P0[lang].title, x: fx, y: fe.last + c.ss * 1.9, size: c.ss * 1.32, weight: 500, tr: -.02, color: wa(.92), hover: '#fff', id: 'feat', href, maxW: fw }));
    const fd = c.para(h.featText, ft.last + c.sm * 1.75, fw, { x: fx, size: c.sm, color: wa(.5) });
    c.add(txt({ str: h.featLink, x: fx, y: fd.last + c.sm * 2.2, size: c.sm, weight: 500, color: wa(.82), hover: '#fff', underline: true, id: 'feat2', href }));
  }
  c.foot(h.footL, h.footR);
}

function projectRows(c, lang, x0, x1, y0, y1, twoLine) {
  const n = PROJECTS.length, rh = (y1 - y0) / n;
  if (rh < c.sm * 3.3) c.bottom = 1e9; // not enough room: force a smaller layout
  const ts = clamp(rh * (twoLine ? .27 : .3), 14, 24);
  PROJECTS.forEach((p, i) => {
    const y = y0 + i * rh, id = 'row' + i, P = p[lang];
    c.add({ k: 'rule', x: x0, y, w: x1 - x0, h: 1, color: wa(.1) }, false);
    c.add({ k: 'area', x: x0, y, w: x1 - x0, h: rh, id, href: '#/p/' + p.id, label: P.title }, false);
    const nw = c.eb * 3.4;
    const year = txt({ str: p.year, x: x1, y: 0, size: c.sm, color: wa(.38), align: 'right' });
    const single = !twoLine && nw + measure(P.title, 500, ts, -.02) + measure(P.kind, 400, c.sm, 0) + year.w + 90 < x1 - x0;
    const tb = single ? y + rh / 2 + ts * .35 : y + rh * .44 + ts * .12;
    c.add(txt({ str: String(i + 1).padStart(2, '0'), x: x0, y: tb, size: c.eb, weight: 500, tr: .1, color: wa(.38), hover: wa(.85), id }));
    c.add(txt({ str: P.title, x: x0 + nw, y: tb, size: ts, weight: 500, tr: -.02, color: wa(.86), hover: '#fff', hoverText: '  →', id }));
    c.add(moveText(year, tb));
    if (single) c.add(txt({ str: P.kind, x: x1 - year.w - 28, y: tb, size: c.sm, color: wa(.45), align: 'right', id }));
    else c.add(txt({ str: P.kind, x: x0 + nw, y: tb + ts * .5 + c.sm * 1.1, size: c.sm, color: wa(.45), id }));
  });
  c.add({ k: 'rule', x: x0, y: y1, w: x1 - x0, h: 1, color: wa(.1) }, false);
}

function workPage(c, t, lang) {
  const w = t.work;
  if (!c.portrait) {
    const colW = c.pw * .3, hs = Math.min(c.pw * .062, c.ph * .17) * c.k;
    const e = c.eyebrow(w.eyebrow, c.ebY, c.x0, colW);
    const hl = c.headline(w.lines, e.last + hs * 1.16, c.x0, hs, colW + c.pw * .06);
    c.para(w.sub, hl.last + hs * .6, colW, { size: c.sm * 1.05, color: wa(.5), lh: 1.55 });
    projectRows(c, lang, c.pw * .43, c.x1, c.ebY - c.eb * 1.2, c.footY - c.fs * 2.6, false);
  } else {
    const e = c.eyebrow(w.eyebrow);
    const hl = c.headline(w.lines, e.last + c.hs * 1.16);
    const sub = c.compact ? hl : c.para(w.sub, hl.last + c.hs * .6, c.x1 - c.x0, { size: c.sm, color: wa(.5) });
    projectRows(c, lang, c.x0, c.x1, sub.last + c.sm * 1.6, c.footY - c.fs * 3.4, true);
  }
  c.foot(w.footL, w.footR, { lh: '#/', rh: '#/p/' + PROJECTS[0].id });
}

function skillGroups(c, list, x, y, x1) {
  for (const g of list) {
    const lab = c.add(txt({ str: g.t, x, y, size: c.sm * 1.02, weight: 500, color: wa(.92), maxW: x1 - x }));
    const val = c.add(txt({ str: g.d, x, y: lab.last + c.sm * 1.55, size: c.sm * .96, color: wa(.55), lh: 1.5, maxW: x1 - x }));
    y = val.last + c.sm * (c.portrait ? 2.1 : 2.5) * c.k;
  }
}

function skillsPage(c, t) {
  const s = t.skills;
  if (!c.portrait) {
    const colW = c.pw * .34, hs = Math.min(c.pw * .062, c.ph * .17) * c.k;
    const e = c.eyebrow(s.eyebrow, c.ebY, c.x0, colW);
    const hl = c.headline(s.lines, e.last + hs * 1.16, c.x0, hs, colW + c.pw * .06);
    const ab = c.para(s.about, hl.last + hs * .6, colW, { size: c.sm * 1.04, lh: 1.6 });
    c.buttons(ab.last + c.sm * 1.2, [{ link: s.link, href: '#/skills/more' }]);
    skillGroups(c, s.groups, c.pw * .565, c.ebY, c.x1);
  } else {
    const e = c.eyebrow(s.eyebrow);
    const hl = c.headline(s.lines, e.last + c.hs * 1.16);
    let y = hl.last + c.hs * .5;
    if (!c.compact) y = c.para(s.about, y, c.x1 - c.x0, { size: c.sm }).last + c.sm * .5;
    const bb = c.buttons(y, [{ link: s.link, href: '#/skills/more' }]);
    skillGroups(c, s.groups, c.x0, bb + c.sm * 2, c.x1);
  }
  c.foot(s.footL, s.footR);
}

function contactPage(c, t) {
  const s = t.contact;
  const colW = c.portrait ? c.x1 - c.x0 : c.pw * .38;
  const hs = c.portrait ? c.hs : Math.min(c.pw * .07, c.ph * .19) * c.k;
  const e = c.eyebrow(s.eyebrow, c.ebY, c.x0, colW);
  const hl = c.headline(s.lines, e.last + hs * 1.16, c.x0, hs, c.portrait ? colW : colW + c.pw * .08);
  const sub = c.para(s.sub, hl.last + hs * .6, colW);
  const bb = c.buttons(sub.last + c.ss * 1.4, [{ pill: s.cta, href: 'mailto:' + PROFILE.email }, { link: s.link, href: PROFILE.cv, ext: true }]);
  const x = c.portrait ? c.x0 : c.pw * .56;
  let y = c.portrait ? bb + c.ss * 2.4 : c.ebY;
  const vs = c.portrait ? c.ss * 1.02 : clamp(c.ss * 1.25, 17, 26) * Math.min(1, c.k + .1);
  for (const r of contactRows()) {
    const lab = c.eyebrow(r.label, y, x, c.x1 - x);
    const v = c.add(txt({ str: r.value, x, y: lab.last + vs * 1.45, size: vs, weight: 500, tr: -.015, color: wa(.9), hover: '#fff', underline: true, id: 'c' + (++uid), href: r.href, ext: r.ext, maxW: c.x1 - x }));
    y = v.last + vs * (c.portrait ? 1.7 : 2.2) * c.k;
  }
  c.foot(s.footL, s.footR);
}

function projectPage(c, t, lang, idx) {
  const p = PROJECTS[idx], P = p[lang], tp = t.proj, n = PROJECTS.length;
  const num = String(idx + 1).padStart(2, '0');
  const wide = c.portrait ? c.x1 - c.x0 : c.pw * .62;
  if (!c.portrait) c.add(txt({ str: num, x: c.x1, y: c.pt + c.ph * .46, size: c.ph * .4, weight: 600, tr: -.06, color: wa(.05), align: 'right', decor: true }), false);
  const e = c.eyebrow(`${tp.project} ${num} / ${String(n).padStart(2, '0')} — ${P.kind} — ${p.year}`, c.ebY, c.x0, wide);
  const ts = (c.portrait ? Math.min(c.pw * .1, c.ph * .062) : Math.min(c.pw * .058, c.ph * .15)) * c.k;
  const ti = c.headline([P.title], e.last + ts * 1.2, c.x0, ts, wide);
  const tg = c.para(P.tagline, ti.last + ts * (c.portrait ? .95 : .62),c.portrait ? c.x1 - c.x0 : c.pw * .5);
  const colW = c.portrait ? (c.x1 - c.x0) / p.metrics.length : Math.min(c.pw * .19, (c.x1 - c.x0) / 3);
  const ms = (c.portrait ? Math.min(c.pw * .066, 26) : Math.min(c.pw * .034, c.ph * .075)) * c.k;
  const my = tg.last + c.ss * (c.portrait ? 1.5 : 2.1) + ms;
  let mb = my;
  p.metrics.forEach((m, i) => {
    const x = c.x0 + i * colW, v = metricValue(m, lang);
    const size = Math.min(ms, ms * (colW - 14) / measure(v, 500, ms, -.03));
    c.add(txt({ str: v, x, y: my, size, weight: 500, tr: -.03, grad: ['#ececf0', '#b3b3ba'] }));
    mb = Math.max(mb, c.add(txt({ str: m[lang], x, y: my + c.sm * 1.85, size: c.sm * .95, color: wa(.45), lh: 1.4, maxW: colW - 16 })).last);
  });
  const st = c.para(p.stack, mb + c.sm * 2.9,c.portrait ? c.x1 - c.x0 : c.pw * .58, { size: c.sm * .95, color: wa(.4) });
  const btns = [];
  if (p.demo) btns.push({ pill: tp.demo, href: p.demo, ext: true });
  else if (p.repo) btns.push({ pill: 'GitHub', href: p.repo, ext: true });
  if (p.demo && p.repo) btns.push({ link: tp.github, href: p.repo, ext: true });
  btns.push(btns.length ? { link: tp.case, href: `#/p/${p.id}/case` } : { pill: tp.case, href: `#/p/${p.id}/case` });
  c.buttons(st.last + c.ss * 1.8, btns);
  const prev = PROJECTS[(idx - 1 + n) % n], next = PROJECTS[(idx + 1) % n];
  c.foot(c.portrait ? tp.prev : '← ' + prev[lang].title, c.portrait ? tp.next : next[lang].title + ' →',
    { lh: '#/p/' + prev.id, rh: '#/p/' + next.id, row: true });
}

function navItems(items, route, lang) {
  const t = T[lang], { bw, navH, phone } = L, cy = navH / 2;
  const nx = phone ? 16 : Math.max(bw * .022, 20);
  const m = clamp(navH * .28, 16, 24);
  items.push({ k: 'mark', x: nx, y: cy - m / 2, s: m, id: 'nav-home', href: '#/', label: t.fullName });
  const nsz = clamp(navH * .19, 13, 17), lsz = clamp(navH * .17, 12.5, 15);
  if (!phone) items.push(txt({ str: t.short, x: nx + m + 12, y: cy + nsz * .35, size: nsz, weight: 500, tr: -.01, color: wa(.92), hover: '#fff', id: 'nav-home', href: '#/' }));
  const links = [['work', '#/work'], ['skills', '#/skills'], ['contact', '#/contact']];
  const ws = links.map(([k]) => measure(t.nav[k], 400, lsz, 0));
  const g = phone ? lsz * 1.25 : lsz * 2.4;
  const total = ws.reduce((a, b) => a + b, 0) + g * (links.length - 1);
  let lx = phone ? nx + m + 14 : bw / 2 - total / 2;
  const active = route.page.startsWith('p:') ? 'work' : route.page;
  links.forEach(([k, href], i) => {
    items.push(txt({ str: t.nav[k], x: lx, y: cy + lsz * .35, size: lsz, color: active === k ? wa(.95) : wa(.6), hover: wa(.97), id: 'nav-' + k, href }));
    if (active === k) items.push({ k: 'dot', x: lx + ws[i] / 2, y: cy + lsz * 1.15, r: 1.7 });
    lx += ws[i] + g;
  });
  let rx = bw - nx;
  if (!phone) {
    const cv = txt({ str: t.nav.cv, x: rx, y: cy + lsz * .35, size: lsz, weight: 500, color: wa(.92), hover: '#fff', align: 'right', id: 'nav-cv', href: PROFILE.cv, ext: true });
    items.push(cv);
    rx -= cv.w + lsz * 2.2;
  }
  for (const [code, label] of [['ru', 'RU'], [null, '/'], ['en', 'EN']]) {
    const it = txt({
      str: label, x: rx, y: cy + lsz * .35, size: lsz, weight: 500, tr: .04, align: 'right',
      color: code === null ? wa(.25) : code === lang ? wa(.95) : wa(.45),
      hover: code && code !== lang ? wa(.95) : null, id: code && code !== lang ? 'lang-' + code : null,
      act: code && code !== lang ? 'lang:' + code : null, aria: code === 'ru' ? 'Русский' : code === 'en' ? 'English' : null,
    });
    items.push(it);
    rx -= it.w + lsz * .45;
  }
}

function fillPage(c, route, lang) {
  const t = T[lang];
  if (route.page === 'work') workPage(c, t, lang);
  else if (route.page === 'skills') skillsPage(c, t);
  else if (route.page === 'contact') contactPage(c, t);
  else if (route.page.startsWith('p:')) projectPage(c, t, lang, PROJECTS.findIndex(p => p.id === route.page.slice(2)));
  else homePage(c, t, lang);
}

function buildLayout(route, lang) {
  let c = null;
  search: for (const compact of [false, true]) {
    for (const k of [1, .93, .86, .8, .74, .68, .62]) {
      c = pageCtx(k, compact);
      fillPage(c, route, lang);
      if (c.fits()) break search;
    }
  }
  const items = [];
  navItems(items, route, lang);
  return items.concat(c.items);
}

/* ------------------------------------------------------------------ canvas printing */
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawItems(ctx, items, hover) {
  ctx.textBaseline = 'alphabetic';
  for (const it of items) {
    const hov = it.id && it.id === hover;
    if (it.k === 'text') {
      setFont(ctx, it.weight, it.size, it.tr);
      if (it.grad) {
        const g = ctx.createLinearGradient(0, it.y - it.size * .8, 0, it.last + it.size * .2);
        g.addColorStop(0, it.grad[0]); g.addColorStop(1, it.grad[1]);
        ctx.fillStyle = g;
      } else ctx.fillStyle = hov && it.hover ? it.hover : it.color;
      it.lines.forEach((ln, i) => {
        const x = it.align === 'right' ? it.x - it.widths[i] : it.x, y = it.y + i * it.lhPx;
        ctx.fillText(hov && it.hoverText && i === it.lines.length - 1 ? ln + it.hoverText : ln, x, y);
        if (hov && it.underline) ctx.fillRect(x, y + it.size * .2, it.widths[i] - (it.tr || 0) * it.size, Math.max(1, it.size * .07));
      });
    } else if (it.k === 'pill') {
      ctx.fillStyle = hov ? '#36d67e' : '#ececef';
      rrect(ctx, it.x, it.y, it.w, it.h, 6); ctx.fill();
      setFont(ctx, 500, it.size, -.005);
      ctx.fillStyle = '#0b0b0d';
      ctx.fillText(it.label, it.x + (it.w - it.lw) / 2, it.y + it.h / 2 + it.size * .35);
    } else if (it.k === 'mark') {
      const { x, y, s } = it;
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, hov ? '#ffffff' : '#ececf0'); g.addColorStop(1, '#8b8b95');
      ctx.save();
      rrect(ctx, x, y, s, s, s * .24); ctx.fillStyle = g; ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = Math.max(1.5, s * .09);
      ctx.beginPath(); ctx.moveTo(x + s * .16, y + s + 1); ctx.lineTo(x + s + 1, y + s * .28); ctx.stroke();
      ctx.restore();
    } else if (it.k === 'rule') {
      ctx.fillStyle = it.color; ctx.fillRect(it.x, it.y, it.w, it.h);
    } else if (it.k === 'dot') {
      ctx.fillStyle = wa(.75); ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ shards */
function makeDrift() {
  const d = {};
  for (const k of Object.keys(BASE)) d[k] = { px: 10 + Math.random() * 10, py: 10 + Math.random() * 10, ax: Math.random() * 6.283, ay: Math.random() * 6.283 };
  return d;
}

function patternPts(t, drift, amt, mirror) {
  const P = { TL: [0, 0], TR: [1, 0], BR: [1, 1], BL: [0, 1] };
  let pu = -9, pv = -9;
  if (amt > .001) {
    const a = ptr.bx / L.bw, b = (ptr.by - L.panelTop) / L.panelH;
    [pu, pv] = L.portrait ? [b, a] : [a, b];
    if (mirror) pu = 1 - pu;
  }
  for (const k in BASE) {
    const [bx, by] = BASE[k], d = drift[k], jn = k[0] === 'J';
    let x = bx + .03 * Math.sin(t * 2 * Math.PI / d.px + d.ax);
    let y = by + (jn ? .05 * Math.sin(t * 2 * Math.PI / d.py + d.ay) : 0);
    const dx = x - pu, dy = y - pv, dist = Math.hypot(dx, dy);
    if (dist < .6 && dist > 1e-4) {
      const f = .05 * (1 - dist / .6) ** 2 * amt;
      x += dx / dist * f;
      if (jn) y += dy / dist * f;
    }
    P[k] = [clamp(x, .03, .97), jn ? clamp(y, .05, .95) : y];
  }
  return P;
}

function toBlock([x, y], mirror) {
  if (mirror) x = 1 - x;
  return L.portrait ? [y * L.bw, L.panelTop + x * L.panelH] : [x * L.bw, L.panelTop + y * L.panelH];
}

class Piece {
  constructor(slab, isNav) {
    this.slab = slab; this.isNav = isNav;
    this.mat = makeGlassMaterial(1, .55);
    this.pmat = new THREE.MeshBasicMaterial({ map: slab.tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.glass = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.print = new THREE.Mesh(new THREE.BufferGeometry(), this.pmat);
    this.print.renderOrder = 2;
    this.glass.userData.piece = this;
    this.group = new THREE.Group();
    this.group.add(this.glass, this.print);
    slab.group.add(this.group);
    this.rest = new THREE.Vector3();
    this.lift = 0; this.liftV = 0; this.rx = 0; this.rxV = 0; this.ry = 0; this.ryV = 0; this.h = 0;
  }

  setPoly(poly) {
    const ins = insetPoly(poly, L.gap / 2 + L.bevel);
    let cx = 0, cy = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of ins) { cx += x; cy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    cx /= ins.length; cy /= ins.length;
    this.cbx = cx; this.cby = cy; this.hw = Math.max(20, (x1 - x0) / 2); this.hh = Math.max(20, (y1 - y0) / 2);
    const lx = cx - L.bw / 2, ly = L.bh / 2 - cy;
    this.rest.set(lx, ly, 0);
    const shape = roundedShape(ins.map(([x, y]) => [x - cx, cy - y]), L.radius);
    const g = new THREE.ExtrudeGeometry(shape, this.slab.extrude);
    const pg = new THREE.ShapeGeometry(shape, 5);
    const pos = pg.attributes.position, uv = pg.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + lx + L.bw / 2) / L.bw, (pos.getY(i) + ly + L.bh / 2) / L.bh);
    uv.needsUpdate = true;
    this.glass.geometry.dispose(); this.print.geometry.dispose();
    this.glass.geometry = g; this.print.geometry = pg;
    this.print.position.z = L.zF + .6;
  }

  initFlight(order) {
    const S = L.S;
    let dx = this.rest.x, dy = this.rest.y;
    if (Math.hypot(dx, dy) < 1) { dx = Math.random() - .5; dy = Math.random() - .5; }
    const a = Math.atan2(dy, dx) + (Math.random() - .5) * .7;
    const sp = (1250 + 650 * Math.random()) * S * (L.phone ? 1.6 : 1);
    this.v = new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp * .75 - (200 + 300 * Math.random()) * S, (420 + 380 * Math.random()) * S);
    this.axis = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
    this.ang = (2.0 + 1.6 * Math.random()) * (Math.random() < .5 ? -1 : 1);
    this.delay = this.isNav ? 0 : .05 + order * .03 + Math.random() * .012;
  }

  update(dt, t) {
    const sl = this.slab, S = L.S;
    let p = 0;
    if (sl.state === 'out') p = easeInCubic(clamp((t - sl.t0 - this.delay) / DUR, 0, 1));
    else if (sl.state === 'in') p = 1 - easeOutBack(clamp((t - sl.t0 - this.delay) / DUR, 0, 1));
    else if (sl.state === 'gone') p = 1;

    // hover: spring lift toward the camera, tip so the edge nearest the pointer dips away
    const hov = sl.state === 'rest' && sl.hoverPiece === this;
    const tl = hov ? (this.isNav ? 32 : 50) * S : 0;
    let trx = 0, tryy = 0;
    if (hov) {
      const mY = Math.min(.24, 90 * S / this.hw), mX = Math.min(.24, 90 * S / this.hh);
      tryy = clamp((ptr.bx - this.cbx) / this.hw, -1, 1) * mY;
      trx = clamp((ptr.by - this.cby) / this.hh, -1, 1) * mX;
    }
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.liftV += (170 * (tl - this.lift) - 19 * this.liftV) * h; this.lift += this.liftV * h;
      this.rxV += (170 * (trx - this.rx) - 19 * this.rxV) * h; this.rx += this.rxV * h;
      this.ryV += (170 * (tryy - this.ry) - 19 * this.ryV) * h; this.ry += this.ryV * h;
    }
    this.h += ((hov ? 1 : 0) - this.h) * (1 - Math.exp(-dt / .12));
    this.mat.iridescence = .55 + .45 * this.h;
    this.mat.envMapIntensity = 1 + .9 * this.h;

    const tau = p * T_PHYS, g = -2800 * S * (L.phone ? 1.4 : 1);
    this.group.position.set(this.rest.x + this.v.x * tau, this.rest.y + this.v.y * tau + .5 * g * tau * tau, this.v.z * tau + this.lift);
    _q.setFromAxisAngle(this.axis, this.ang * p);
    _q2.setFromEuler(_e.set(this.rx, this.ry, 0));
    this.group.quaternion.copy(_q).multiply(_q2);
    const op = p > .72 ? clamp(1 - (p - .72) / .28, 0, 1) : 1;
    this.mat.opacity = op; this.pmat.opacity = op;
    this.group.visible = p < .999;
  }

  dispose() {
    this.glass.geometry.dispose(); this.print.geometry.dispose();
    this.mat.dispose(); this.pmat.dispose();
  }
}

class Slab {
  constructor(route, lang) {
    this.route = route; this.lang = lang;
    this.state = 'gone'; this.t0 = 0; this.endAt = 0; this.hover = null; this.hoverPiece = null;
    this.mirror = mirrorFor(route.page);
    this.items = buildLayout(route, lang);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(L.bw * L.dpr); this.canvas.height = Math.round(L.bh * L.dpr);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.draw();
    this.group = new THREE.Group();
    tilt.add(this.group);
    this.extrude = { depth: L.depth, bevelEnabled: true, bevelThickness: L.bevel, bevelSize: L.bevel, bevelSegments: 3, curveSegments: 5 };
    this.drift = makeDrift();
    this.nav = new Piece(this, true);
    this.cells = CELLS.map(() => new Piece(this, false));
    this.pieces = [this.nav, ...this.cells];
    this.glassMeshes = this.pieces.map(p => p.glass);
    this.nav.setPoly([[0, 0], [L.bw, 0], [L.bw, L.navH], [0, L.navH]]);
    this.lastBuild = -1;
    this.rebuild(clock(), 0);
    const order = [0, 1, 2, 3, 4].sort(() => Math.random() - .5);
    this.nav.initFlight(0);
    this.cells.forEach((p, i) => p.initFlight(order[i]));
    this.maxDelay = Math.max(...this.pieces.map(p => p.delay));
  }

  draw() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    drawItems(c, this.items, this.hover);
    this.tex.needsUpdate = true;
  }

  setHover(id) { if (id !== this.hover) { this.hover = id; this.draw(); } }

  rebuild(t, amt) {
    const pts = patternPts(t, this.drift, amt, this.mirror);
    CELLS.forEach((names, i) => this.cells[i].setPoly(names.map(k => toBlock(pts[k], this.mirror))));
  }

  shatter(t) {
    this.state = 'out'; this.t0 = t; this.endAt = t + this.maxDelay + DUR; this.hoverPiece = null;
    if (this.hover) this.setHover(null);
  }

  assemble(t) { this.state = 'in'; this.t0 = t; this.endAt = t + this.maxDelay + DUR; }

  update(dt, t) {
    if (this.state === 'out' && t >= this.endAt) this.state = 'gone';
    if (this.state === 'in' && t >= this.endAt) this.state = 'rest';
    if ((this.state === 'rest' || (this.state === 'in' && t > this.t0)) && t - this.lastBuild >= 1 / 45) {
      this.lastBuild = t;
      this.rebuild(t, U.uGlow.value);
    }
    for (const p of this.pieces) p.update(dt, t);
  }

  dispose() {
    for (const p of this.pieces) p.dispose();
    this.tex.dispose();
    tilt.remove(this.group);
  }
}

function mirrorFor(page) {
  if (page === 'work' || page === 'skills' || page === 'contact') return true;
  if (page.startsWith('p:')) return PROJECTS.findIndex(p => 'p:' + p.id === page) % 2 === 1;
  return false;
}

/* ------------------------------------------------------------------ DOM text layer */
function wire(el, it, slab) {
  if (it.href) {
    el.href = it.href;
    if (it.ext) { el.target = '_blank'; el.rel = 'noopener'; }
  } else el.type = 'button';
  const on = () => slab.setHover(it.id);
  const off = () => { if (slab.hover === it.id) slab.setHover(null); };
  el.addEventListener('pointerenter', on); el.addEventListener('pointerleave', off);
  el.addEventListener('focus', on); el.addEventListener('blur', off);
  if (it.act) el.addEventListener('click', e => { e.preventDefault(); doAct(it.act); });
}

function buildDOM(slab) {
  $ui.textContent = '';
  $ui.style.width = L.bw + 'px';
  $ui.style.height = L.bh + 'px';
  const areas = [];
  for (const it of slab.items) {
    if (it.k === 'area') { areas.push(it); continue; }
    if (it.k === 'rule' || it.k === 'dot' || it.decor) continue;
    const interactive = !!(it.href || it.act);
    let el;
    if (it.k === 'text') {
      el = document.createElement(it.href ? 'a' : it.act ? 'button' : 'span');
      el.className = 'tx';
      el.textContent = it.lines.join('\n');
      Object.assign(el.style, {
        left: (it.align === 'right' ? it.x - it.w : it.x) + 'px',
        top: (it.y - it.lhPx / 2 - MID * it.size) + 'px',
        width: Math.ceil(it.w + 2) + 'px',
        fontSize: it.size + 'px', fontWeight: it.weight, letterSpacing: it.tr + 'em', lineHeight: it.lhPx + 'px',
        textAlign: it.align || 'left',
      });
      if (it.aria) el.setAttribute('aria-label', it.aria);
      if (it.id && !interactive) el.style.pointerEvents = 'none';
    } else {
      el = document.createElement('a');
      el.className = 'hit';
      Object.assign(el.style, { left: it.x + 'px', top: it.y + 'px', width: (it.w || it.s) + 'px', height: (it.h || it.s) + 'px' });
      if (it.k === 'pill') el.textContent = it.label; else el.setAttribute('aria-label', it.label);
    }
    if (interactive) wire(el, it, slab);
    $ui.appendChild(el);
  }
  for (const it of areas) {
    const el = document.createElement('a');
    el.className = 'hit area';
    el.setAttribute('aria-label', it.label);
    Object.assign(el.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' });
    wire(el, it, slab);
    $ui.appendChild(el);
  }
}

function solve8(A, b) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

function updateHomography() {
  const { bw, bh, zF, W, H } = L;
  const src = [[0, 0], [bw, 0], [bw, bh], [0, bh]];
  const A = [], b = [];
  src.forEach(([x, y]) => {
    _v.set(x - bw / 2, bh / 2 - y, zF).applyMatrix4(tilt.matrixWorld).project(camera);
    const X = (_v.x + 1) / 2 * W, Y = (1 - _v.y) / 2 * H;
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  });
  const h = solve8(A, b);
  $ui.style.transform = `matrix3d(${[h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1].map(v => v.toFixed(8)).join(',')})`;
}

/* ------------------------------------------------------------------ reading view + "← Back" sliver */
function fillReader(route, lang) {
  const t = T[lang];
  let title, paras, links = [];
  if (route.page === 'skills') {
    ({ title, paras } = t.skills.reader);
    links = t.skills.reader.links.map(l => ({ label: l.label, href: PROFILE[l.key] }));
  } else {
    const p = PROJECTS.find(x => x.id === route.page.slice(2)), P = p[lang];
    title = `${P.title}: ${t.proj.how}`;
    paras = P.case;
    if (p.repo) links.push({ label: t.proj.github, href: p.repo });
    if (p.demo) links.push({ label: t.proj.demo + ' ↗', href: p.demo });
  }
  $reader.innerHTML = `<div class="col"><h2>${esc(title)}</h2>${paras.map(x => `<p><b>${esc(x.t)}</b> — ${esc(x.d)}</p>`).join('')}` +
    (links.length ? `<p class="rl">${links.map(l => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</p>` : '') + '</div>';
  $reader.scrollTop = 0;
  $back.textContent = t.back;
}

function makeSliver() {
  const mat = makeGlassMaterial(0, .35);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const g = new THREE.Group(), inner = new THREE.Group();
  inner.add(mesh); g.add(inner); scene.add(g);
  g.visible = false;
  return { g, inner, mesh, mat, sc: 0, from: 0, mode: 'hidden', t0: 0, hover: false, rx: .08, ry: -.16, c: [0, 0], hw: 1, hh: 1 };
}

function buildSliver() {
  const { W, H } = L;
  let pts, c, k;
  if (W < 860) { k = 1; pts = [[14, 30], [142, 12], [162, 70], [20, 76]]; c = [88, 47]; }
  else {
    k = W / 1918;
    pts = [[.147, .243], [.252, .169], [.287, .277], [.151, .258]].map(([x, y]) => [x * W, y * H]);
    c = [.219 * W, .238 * H];
  }
  const bev = 2.4 * k;
  const ins = insetPoly(pts, bev);
  let cx = 0, cy = 0;
  ins.forEach(([x, y]) => { cx += x; cy += y; });
  cx /= ins.length; cy /= ins.length;
  const xs = ins.map(p => p[0]), ys = ins.map(p => p[1]);
  sliver.hw = Math.max(...xs) - cx; sliver.hh = Math.max(...ys) - cy;
  const shape = roundedShape(ins.map(([x, y]) => [x - cx, cy - y]), 9 * k);
  sliver.mesh.geometry.dispose();
  sliver.mesh.geometry = new THREE.ExtrudeGeometry(shape, { depth: 11 * k, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 6 });
  sliver.g.position.set(cx - W / 2, H / 2 - cy, 0);
  sliver.c = [cx, cy];
  $back.style.left = c[0] + 'px';
  $back.style.top = c[1] + 'px';
}

function updateSliver(dt, t) {
  const s = sliver;
  let sc = 0;
  if (s.mode === 'in') sc = t < s.t0 ? 0 : easeOutBack(clamp((t - s.t0) / .55, 0, 1));
  else if (s.mode === 'out') {
    const u = clamp((t - s.t0) / .3, 0, 1);
    sc = s.from * (1 - easeInCubic(u));
    if (u >= 1) s.mode = 'hidden';
  }
  s.sc = sc;
  s.g.visible = sc > .002;
  s.g.scale.setScalar(Math.max(sc, .002));
  let trx = .08 + .03 * Math.sin(t * 2 * Math.PI), tryy = -.16 + .04 * Math.sin(t * 2 * Math.PI * .9 + 1.3);
  if (s.hover) {
    tryy += clamp((ptr.x - s.c[0]) / s.hw, -1, 1) * .14;
    trx += clamp((ptr.y - s.c[1]) / s.hh, -1, 1) * .14;
  }
  const a = 1 - Math.exp(-dt / .12);
  s.rx += (trx - s.rx) * a; s.ry += (tryy - s.ry) * a;
  s.inner.rotation.set(s.rx, s.ry, 0);
  $back.style.opacity = clamp(sc, 0, 1).toFixed(3);
  $back.classList.toggle('on', s.mode === 'in' && sc > .4);
}

/* ------------------------------------------------------------------ navigation */
function setUI(on) { $ui.classList.toggle('off', !on); }

function go(route, lang = state.lang) {
  const t = clock();
  if (t < busyUntil) { pending = { route, lang }; return; }
  document.title = pageTitle(route, lang);

  if (current && current.route.page === route.page && current.lang === lang) {
    if (route.reader && !readerOpen) {                       // shatter into the reading view
      readerOpen = true;
      fillReader(route, lang);
      current.shatter(t);
      setUI(false);
      $reader.classList.add('on');
      sliver.mode = 'in'; sliver.t0 = t + .3;
      busyUntil = t + .85;
    } else if (!route.reader && readerOpen) {                // fly the shards back
      readerOpen = false;
      $reader.classList.remove('on');
      sliver.mode = 'out'; sliver.t0 = t; sliver.from = sliver.sc;
      current.assemble(t + .1);
      busyUntil = current.endAt;
    }
    current.route = route;
    return;
  }

  const old = current;
  current = new Slab(route, lang);
  buildDOM(current);
  setUI(false);
  if (old) leaving.push(old);
  if (route.reader) {
    if (old && old.state !== 'gone') old.shatter(t);
    fillReader(route, lang);
    if (!readerOpen) {
      readerOpen = true;
      $reader.classList.add('on');
      sliver.mode = 'in'; sliver.t0 = t + .3;
    }
    busyUntil = t + .85;
  } else {
    let d = .15;
    if (readerOpen) {
      readerOpen = false;
      $reader.classList.remove('on');
      sliver.mode = 'out'; sliver.t0 = t; sliver.from = sliver.sc;
      d = .2;
    } else if (old) { old.shatter(t); d = .3; }
    current.assemble(t + d);
    busyUntil = current.endAt;
  }
}

function doAct(act) {
  if (act.startsWith('lang:')) {
    const l = act.slice(5);
    setLang(l);
    go(parseRoute(), l);
  }
}

/* ------------------------------------------------------------------ frame loop */
function frame() {
  const t = clock(), dt = Math.min(.05, t - lastT);
  lastT = t;

  const ty = ptr.inside ? (ptr.nx * 7 - 1.2) * DEG : -1.2 * DEG;
  const tx = ptr.inside ? (-ptr.ny * 5.5 + .8) * DEG : .8 * DEG;
  const a = 1 - Math.exp(-dt / .3);
  tiltY += (ty - tiltY) * a; tiltX += (tx - tiltX) * a;
  tilt.rotation.set(tiltX, tiltY, 0);
  tilt.updateMatrixWorld(true);

  ndc.set(ptr.nx, ptr.ny);
  ray.setFromCamera(ndc, camera);
  _n.set(0, 0, 1).applyQuaternion(tilt.quaternion);
  _v.set(0, 0, L.zF).applyMatrix4(tilt.matrixWorld);
  _plane.setFromNormalAndCoplanarPoint(_n, _v);
  if (ray.ray.intersectPlane(_plane, _hit)) {
    U.uPointer.value.copy(_hit);
    tilt.worldToLocal(_hit);
    ptr.bx = _hit.x + L.bw / 2; ptr.by = L.bh / 2 - _hit.y;
  }
  U.uGlow.value += ((ptr.inside && !readerOpen ? 1 : 0) - U.uGlow.value) * (1 - Math.exp(-dt / .25));

  if (current) {
    if (current.state === 'rest' && ptr.inside && !readerOpen) {
      const hit = ray.intersectObjects(current.glassMeshes, false)[0];
      current.hoverPiece = hit ? hit.object.userData.piece : null;
    } else current.hoverPiece = null;
    current.update(dt, t);
    if (current.state === 'rest' && $ui.classList.contains('off')) setUI(true);
  }
  for (let i = leaving.length - 1; i >= 0; i--) {
    const s = leaving[i];
    s.update(dt, t);
    if (s.state === 'gone') { s.dispose(); leaving.splice(i, 1); }
  }
  updateSliver(dt, t);
  updateHomography();
  if (pending && t >= busyUntil) { const p = pending; pending = null; go(p.route, p.lang); }
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ setup */
function onResize() {
  L = computeL();
  renderer.setSize(L.W, L.H);
  camera.aspect = L.W / L.H;
  camera.position.set(0, 0, (L.H / 2) / Math.tan(15 * DEG));
  camera.near = 10; camera.far = camera.position.z * 6;
  camera.updateProjectionMatrix();
  U.uS.value = L.S;
  buildSliver();
  if (current) {
    for (const s of leaving) s.dispose();
    leaving.length = 0;
    const { route, lang } = current;
    current.dispose();
    current = new Slab(route, lang);
    current.state = readerOpen ? 'gone' : 'rest';
    buildDOM(current);
    setUI(!readerOpen);
    busyUntil = 0;
  }
}

async function loadFonts() {
  if (!document.fonts) return;
  const want = ['400', '500', '600'].map(w => document.fonts.load(`${w} 24px Inter`, 'AaЯя→'));
  await Promise.race([Promise.all(want), new Promise(r => setTimeout(r, 3000))]).catch(() => {});
}

export async function start() {
  await loadFonts();
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(BG, 1);
  document.getElementById('gl').appendChild(renderer.domElement);
  document.body.classList.add('gl');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .42;
  const key = new THREE.DirectionalLight(0xe2eaff, 1.3);
  key.position.set(-1.2, 1.4, 1.1);
  scene.add(key);
  camera = new THREE.PerspectiveCamera(30, 1, 10, 10000);
  tilt = new THREE.Group();
  scene.add(tilt);
  sliver = makeSliver();
  onResize();

  addEventListener('pointermove', e => {
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.nx = e.clientX / L.W * 2 - 1; ptr.ny = -(e.clientY / L.H * 2 - 1);
    ptr.inside = true;
  }, { passive: true });
  addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { ptr.x = e.clientX; ptr.y = e.clientY; ptr.nx = e.clientX / L.W * 2 - 1; ptr.ny = -(e.clientY / L.H * 2 - 1); ptr.inside = true; } }, { passive: true });
  addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') setTimeout(() => { ptr.inside = false; }, 400); }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { ptr.inside = false; });
  addEventListener('blur', () => { ptr.inside = false; });
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(onResize, 120); });
  addEventListener('hashchange', () => go(parseRoute()));
  $back.addEventListener('click', () => { location.hash = baseHash(parseRoute()); });
  $back.addEventListener('pointerenter', () => { sliver.hover = true; });
  $back.addEventListener('pointerleave', () => { sliver.hover = false; });
  addEventListener('keydown', e => {
    const r = parseRoute();
    if (e.key === 'Escape' && r.reader) { location.hash = baseHash(r); return; }
    if (!r.reader && r.page.startsWith('p:') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const n = PROJECTS.length, i = PROJECTS.findIndex(p => 'p:' + p.id === r.page);
      location.hash = '#/p/' + PROJECTS[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n].id;
    }
  });

  lastT = clock();
  go(parseRoute());
  renderer.setAnimationLoop(frame);
}
