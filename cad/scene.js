// c:\avenuel\avenuel-fm-apps\fm\cad\scene.js
// DXF 엔티티를 화면용 렌더링 도형(선·문자·원·호·폴리라인)으로 펼치는 경량 모듈
import {aci, classify} from './layers.js';
import {uni} from './dxf.js';

const mul = (P, Q) => [
  P[0]*Q[0]+P[2]*Q[1], P[1]*Q[0]+P[3]*Q[1],
  P[0]*Q[2]+P[2]*Q[3], P[1]*Q[2]+P[3]*Q[3],
  P[0]*Q[4]+P[2]*Q[5]+P[4], P[1]*Q[4]+P[3]*Q[5]+P[5]
];
const FLIP = [-1, 0, 0, 1, 0, 0];
const f1 = (o, c, d) => (o[c] ? o[c][0] : d);

function cleanText(s) {
  return String(s)
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function cleanMText(s) {
  s = cleanText(s).replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003');
  s = s.replace(/\\P/g, '\n').replace(/\\[fF][^;]*;/g, '').replace(/\\[HWQTACc][^;]*;/g, '')
    .replace(/\\S([^;]*);/g, (m, a) => a.replace(/[\^#]/g, '/')).replace(/\\[LlOoKk]/g, '').replace(/\\~/g, ' ').replace(/[{}]/g, '');
  return s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
}

function arcPts(cx, cy, r, a0, a1, out) {
  let sw = a1 - a0; if (sw <= 0) sw += 2 * Math.PI;
  const n = Math.max(6, Math.ceil(sw / (2 * Math.PI) * 96));
  for (let i = 0; i <= n; i++) {
    const a = a0 + sw * i / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
}

function bulgeSeg(x1, y1, x2, y2, b, out) {
  const dx = x2 - x1, dy = y2 - y1;
  if (!b || !(dx || dy)) { out.push(x2, y2); return; }
  const k = (1 - b * b) / (2 * b), cx = (x1 + x2) / 2 - dy / 2 * k, cy = (y1 + y2) / 2 + dx / 2 * k;
  const r = Math.hypot(x1 - cx, y1 - cy), a1 = Math.atan2(y1 - cy, x1 - cx), th = 4 * Math.atan(b);
  const n = Math.max(2, Math.ceil(Math.abs(th) / (2 * Math.PI) * 96));
  for (let i = 1; i < n; i++) {
    const a = a1 + th * i / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  out.push(x2, y2);
}

function deBoor(k, t, deg, P, kn) {
  const d = [];
  for (let j = 0; j <= deg; j++) d.push([P[j + k - deg][0], P[j + k - deg][1]]);
  for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
    const den = kn[j + 1 + k - r] - kn[j + k - deg], a = den === 0 ? 0 : (t - kn[j + k - deg]) / den;
    d[j][0] = (1 - a) * d[j - 1][0] + a * d[j][0];
    d[j][1] = (1 - a) * d[j - 1][1] + a * d[j][1];
  }
  return d[deg];
}

export class Scene {
  constructor(doc) {
    this.doc = doc;
    this.prims = [];
    this.layers = new Map();

    for (const r of doc.layerRecs) {
      const o = doc.read(r.s, r.e), name = String(f1(o, 2, ''));
      if (!name) continue;
      const col = f1(o, 62, 7), flags = f1(o, 70, 0);
      this.layers.set(name.toUpperCase(), {
        name: uni(name), key: name.toUpperCase(), count: 0,
        aci: Math.abs(col) || 7, hidden: col < 0 || (flags & 1) === 1,
        off: col < 0, frozen: (flags & 1) === 1, cat: classify(uni(name))
      });
    }

    const count = g => {
      const nm = doc.layerOf(g);
      const k = nm.toUpperCase();
      let L = this.layers.get(k);
      if (!L) {
        L = {name: uni(nm), key: k, count: 0, aci: 7, hidden: false, cat: classify(uni(nm))};
        this.layers.set(k, L);
      }
      L.count++;
    };

    doc.ents.forEach(count);
    for (const b of doc.blocks.values()) b.ents.forEach(count);

    for (const g of doc.ents) {
      if (this.prims.length > 2500000) break;
      this.emit(g, [1, 0, 0, 1, 0, 0], {layer: null, bc: null}, 0);
    }
    this.bbox();
  }

  layerHex(k) {
    const L = this.layers.get(k);
    return aci(L ? L.aci : 7);
  }

  colorOf(o, lk, ctx) {
    if (o[62] === undefined && o[420]) return '#' + (o[420][0] & 0xFFFFFF).toString(16).padStart(6, '0');
    const c = f1(o, 62, 256);
    if (c === 256) return this.layerHex(lk);
    if (c === 0) return ctx.bc || this.layerHex(lk);
    return aci(Math.abs(c));
  }

  addPoly(a, closed, M, lk, col) {
    if (a.length < 4) return;
    const n = a.length, p = new Float64Array(n);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const x = M[0]*a[i] + M[2]*a[i+1] + M[4], y = M[1]*a[i] + M[3]*a[i+1] + M[5];
      p[i] = x; p[i+1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!isFinite(x0 + y0 + x1 + y1)) return;
    this.prims.push({t: 'p', p, closed, lk, oc: col, x0, y0, x1, y1});
  }

  addSolid(a, M, lk, col) {
    const n = a.length, p = new Float64Array(n);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const x = M[0]*a[i] + M[2]*a[i+1] + M[4], y = M[1]*a[i] + M[3]*a[i+1] + M[5];
      p[i] = x; p[i+1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!isFinite(x0 + y0 + x1 + y1)) return;
    this.prims.push({t: 's', p, lk, oc: col, x0, y0, x1, y1});
  }

  addText(lines, x, y, h, ang, ax, ay, mt, M, lk, col) {
    const X = M[0]*x + M[2]*y + M[4], Y = M[1]*x + M[3]*y + M[5];
    const H = h * Math.hypot(M[2], M[3]), A = ang + Math.atan2(M[1], M[0]);
    if (!(H > 0) || !isFinite(X + Y)) return;
    const ext = H * (Math.max(...lines.map(l => l.length)) * .8 + lines.length + 1);
    this.prims.push({t: 't', lines, x: X, y: Y, h: H, a: A, ax, ay, mt, lk, oc: col, x0: X - ext, y0: Y - ext, x1: X + ext, y1: Y + ext});
  }

  emit(g, M, ctx, depth) {
    if (depth > 12) return;
    const doc = this.doc, o = doc.read(g.s, g.he);
    const lk = (f1(o, 8, ctx.layer || '0')).toUpperCase();
    const col = this.colorOf(o, lk, ctx);
    const Me = f1(o, 230, 1) < 0 ? mul(M, FLIP) : M;

    switch (g.t) {
      case 'LINE':
        this.addPoly([f1(o, 10, 0), f1(o, 20, 0), f1(o, 11, 0), f1(o, 21, 0)], false, Me, lk, col);
        break;
      case 'LWPOLYLINE': {
        const xs = o[10] || [], ys = o[20] || [], bs = o[42] || [];
        const out = [];
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i], y = ys[i];
          if (i > 0 && bs[i - 1]) bulgeSeg(xs[i - 1], ys[i - 1], x, y, bs[i - 1], out);
          else out.push(x, y);
        }
        if (f1(o, 70, 0) & 1) {
          if (bs[xs.length - 1]) bulgeSeg(xs[xs.length - 1], ys[xs.length - 1], xs[0], ys[0], bs[xs.length - 1], out);
          else out.push(xs[0], ys[0]);
        }
        this.addPoly(out, (f1(o, 70, 0) & 1) === 1, Me, lk, col);
        break;
      }
      case 'POLYLINE': {
        const out = [];
        for (const k of g.kids) {
          if (k.t === 'VERTEX') {
            const vo = doc.read(k.s, k.e);
            out.push(f1(vo, 10, 0), f1(vo, 20, 0));
          }
        }
        if (out.length >= 4) this.addPoly(out, (f1(o, 70, 0) & 1) === 1, Me, lk, col);
        break;
      }
      case 'CIRCLE': {
        const cx = f1(o, 10, 0), cy = f1(o, 20, 0), r = f1(o, 40, 0);
        if (r > 0) {
          const out = [];
          arcPts(cx, cy, r, 0, Math.PI * 2, out);
          this.addPoly(out, true, Me, lk, col);
        }
        break;
      }
      case 'ARC': {
        const cx = f1(o, 10, 0), cy = f1(o, 20, 0), r = f1(o, 40, 0);
        const a0 = f1(o, 50, 0) * Math.PI / 180, a1 = f1(o, 51, 0) * Math.PI / 180;
        if (r > 0) {
          const out = [];
          arcPts(cx, cy, r, a0, a1, out);
          this.addPoly(out, false, Me, lk, col);
        }
        break;
      }
      case 'ELLIPSE': {
        const cx = f1(o, 10, 0), cy = f1(o, 20, 0), mx = f1(o, 11, 0), my = f1(o, 21, 0);
        const ratio = f1(o, 40, 1), t0 = f1(o, 41, 0), t1 = f1(o, 42, Math.PI * 2);
        const R = Math.hypot(mx, my), rot = Math.atan2(my, mx);
        if (R > 0) {
          const out = [];
          let sw = t1 - t0; if (sw <= 0) sw += 2 * Math.PI;
          const n = Math.max(8, Math.ceil(sw / (2 * Math.PI) * 96));
          for (let i = 0; i <= n; i++) {
            const t = t0 + sw * i / n;
            const px = R * Math.cos(t), py = R * ratio * Math.sin(t);
            out.push(cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot));
          }
          this.addPoly(out, Math.abs(sw - Math.PI * 2) < 1e-4, Me, lk, col);
        }
        break;
      }
      case 'SPLINE': {
        const deg = f1(o, 71, 3), kn = o[40] || [], ctrl = [];
        const cxs = o[10] || [], cys = o[20] || [];
        for (let i = 0; i < cxs.length; i++) ctrl.push([cxs[i], cys[i]]);
        if (ctrl.length > deg && kn.length >= ctrl.length + deg + 1) {
          const out = [], tMin = kn[deg], tMax = kn[kn.length - 1 - deg], steps = Math.max(16, ctrl.length * 8);
          for (let i = 0; i <= steps; i++) {
            const t = tMin + (tMax - tMin) * i / steps;
            let k = deg;
            while (k < kn.length - 2 - deg && kn[k + 1] <= t) k++;
            const pt = deBoor(k, t, deg, ctrl, kn);
            out.push(pt[0], pt[1]);
          }
          this.addPoly(out, false, Me, lk, col);
        }
        break;
      }
      case 'SOLID':
      case 'TRACE': {
        const xs = [f1(o, 10, 0), f1(o, 11, 0), f1(o, 13, 0), f1(o, 12, 0)];
        const ys = [f1(o, 20, 0), f1(o, 21, 0), f1(o, 23, 0), f1(o, 22, 0)];
        this.addSolid([xs[0], ys[0], xs[1], ys[1], xs[2], ys[2], xs[3], ys[3]], Me, lk, col);
        break;
      }
      case 'TEXT': {
        const s = cleanText(f1(o, 1, ''));
        if (s) {
          const x = f1(o, 10, 0), y = f1(o, 20, 0), h = f1(o, 40, 2.5);
          const ang = f1(o, 50, 0) * Math.PI / 180;
          const hAlign = f1(o, 72, 0), vAlign = f1(o, 73, 0);
          const ax = hAlign === 1 ? 1 : hAlign === 2 ? 2 : 0;
          const ay = vAlign === 1 ? 'bottom' : vAlign === 2 ? 'middle' : vAlign === 3 ? 'top' : 'alphabetic';
          this.addText([s], x, y, h, ang, ax, ay, false, Me, lk, col);
        }
        break;
      }
      case 'MTEXT': {
        const raw = (o[3] || []).join('') + f1(o, 1, '');
        const s = cleanMText(raw);
        if (s) {
          const x = f1(o, 10, 0), y = f1(o, 20, 0), h = f1(o, 40, 2.5);
          const ang = f1(o, 50, 0) * Math.PI / 180;
          const at = f1(o, 71, 1);
          const ax = (at - 1) % 3, ay = at <= 3 ? 'top' : at <= 6 ? 'middle' : 'bottom';
          this.addText(s.split('\n'), x, y, h, ang, ax, ay, true, Me, lk, col);
        }
        break;
      }
      case 'INSERT': {
        const bname = String(f1(o, 2, '')).toUpperCase();
        const blk = doc.blocks.get(bname);
        if (!blk) break;
        const ix = f1(o, 10, 0), iy = f1(o, 20, 0);
        const sx = f1(o, 41, 1), sy = f1(o, 42, 1);
        const rot = f1(o, 50, 0) * Math.PI / 180;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const [bx, by] = blk.base;
        const T = [
          sx * cos, sx * sin,
          -sy * sin, sy * cos,
          ix - (bx * sx * cos - by * sy * sin),
          iy - (bx * sx * sin + by * sy * cos)
        ];
        const nextM = mul(Me, T);
        const nextCtx = {layer: lk, bc: col};
        for (const bg of blk.ents) this.emit(bg, nextM, nextCtx, depth + 1);
        break;
      }
    }
  }

  bbox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.prims) {
      if (p.x0 < x0) x0 = p.x0;
      if (p.x1 > x1) x1 = p.x1;
      if (p.y0 < y0) y0 = p.y0;
      if (p.y1 > y1) y1 = p.y1;
    }
    if (!isFinite(x0 + y0 + x1 + y1)) {
      x0 = 0; y0 = 0; x1 = 1000; y1 = 1000;
    }
    this.box = [x0, y0, x1, y1];
  }
}
