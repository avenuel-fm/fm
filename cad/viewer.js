// c:\avenuel\avenuel-fm-apps\fm\cad\viewer.js
// 뷰포트: 캔버스 그리기, 이동·확대, 레이어 켜기/끄기(가시성) 지원
import {catColor, adapt} from './layers.js';

const FONTSTACK = '"Malgun Gothic","맑은 고딕","Noto Sans KR",system-ui,sans-serif';
const BG = {dark: '#0B0F13', light: '#FFFFFF'};

export class Viewer {
  constructor(canvas, {onCursor} = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onCursor = onCursor || (() => {});
    this.scene = null;
    this.hover = null;
    this.mode = 'cat'; // 'cat' (분류색) or 'orig' (원본색)
    this.theme = 'light';
    this.hiddenLayers = new Set(); // 레이어 켜기/끄기
    this.view = {cx: 0, cy: 0, s: 1};
    this.W = 0; this.H = 0; this.dpr = 1; this.raf = 0;

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bind();
    this.resize();
  }

  setScene(scene, keepView) {
    this.scene = scene;
    this.hover = null;
    this.hiddenLayers.clear();
    if (!keepView) this.fit();
    this.schedule();
  }

  toggleLayer(layerKey, visible) {
    if (visible) {
      this.hiddenLayers.delete(layerKey);
    } else {
      this.hiddenLayers.add(layerKey);
    }
    this.schedule();
  }

  fit() {
    if (!this.scene) return;
    const [x0, y0, x1, y1] = this.scene.box;
    const w = Math.max(x1 - x0, 1e-6);
    const h = Math.max(y1 - y0, 1e-6);
    Object.assign(this.view, {
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      s: Math.min(this.W / w, this.H / h) * 0.92 || 1
    });
    this.schedule();
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.W = r.width;
    this.H = r.height;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.schedule();
  }

  schedule() {
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.draw();
      });
    }
  }

  draw() {
    const {ctx, W, H, scene, view} = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG[this.theme] || '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    if (!scene) return;

    const {cx, cy, s} = view, hw = W / 2, hh = H / 2;
    const vx0 = cx - hw / s, vx1 = cx + hw / s, vy0 = cy - hh / s, vy1 = cy + hh / s;
    const buckets = new Map(), texts = [], minD = 0.6 / s;
    const hidden = this.hiddenLayers;

    for (const p of scene.prims) {
      if (hidden.has(p.lk)) continue; // 레이어 꺼짐 시 건너뜀
      if (p.x1 < vx0 || p.x0 > vx1 || p.y1 < vy0 || p.y0 > vy1) continue;
      if (p.t !== 't' && p.x1 - p.x0 < minD && p.y1 - p.y0 < minD) continue;

      const L = scene.layers.get(p.lk);
      const color = this.mode === 'cat'
        ? catColor(L ? L.cat : 'etc', this.theme)
        : adapt(p.oc, this.theme);

      let b = buckets.get(color);
      if (!b) buckets.set(color, b = []);
      b.push(p);
    }

    ctx.lineJoin = 'round';
    for (const [color, arr] of buckets) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      let hasS = false;

      for (const p of arr) {
        if (p.t === 't') { texts.push([p, color]); continue; }
        if (p.t === 's') { hasS = true; continue; }
        const a = p.p;
        ctx.moveTo((a[0] - cx) * s + hw, hh - (a[1] - cy) * s);
        for (let i = 2; i < a.length; i += 2) {
          ctx.lineTo((a[i] - cx) * s + hw, hh - (a[i + 1] - cy) * s);
        }
        if (p.closed) ctx.closePath();
      }
      ctx.stroke();

      if (hasS) {
        ctx.beginPath();
        for (const p of arr) {
          if (p.t === 's') {
            const a = p.p;
            ctx.moveTo((a[0] - cx) * s + hw, hh - (a[1] - cy) * s);
            for (let i = 2; i < a.length; i += 2) {
              ctx.lineTo((a[i] - cx) * s + hw, hh - (a[i + 1] - cy) * s);
            }
            ctx.closePath();
          }
        }
        ctx.fill();
      }
    }

    let drawn = 0;
    for (const [p, color] of texts) {
      const px = p.h * s;
      if (px < 3 || px > 3000) continue;
      if (++drawn > 4000) break;

      ctx.fillStyle = color;
      ctx.save();
      ctx.translate((p.x - cx) * s + hw, hh - (p.y - cy) * s);
      ctx.rotate(-p.a);
      ctx.font = `${px}px ${FONTSTACK}`;
      ctx.textAlign = ['left', 'center', 'right'][p.ax] || 'left';

      if (p.mt) {
        ctx.textBaseline = 'top';
        const n = p.lines.length, lh = px * 1.4;
        const sh = p.ay === 'top' ? 0 : p.ay === 'middle' ? n * lh / 2 : n * lh;
        p.lines.forEach((l, i) => ctx.fillText(l, 0, i * lh - sh));
      } else {
        ctx.textBaseline = p.ay || 'alphabetic';
        ctx.fillText(p.lines[0], 0, 0);
      }
      ctx.restore();
    }
  }

  zoomAt(mx, my, k) {
    const v = this.view;
    const wx = v.cx + (mx - this.W / 2) / v.s;
    const wy = v.cy - (my - this.H / 2) / v.s;
    v.s *= k;
    v.cx = wx - (mx - this.W / 2) / v.s;
    v.cy = wy + (my - this.H / 2) / v.s;
    this.schedule();
  }

  bind() {
    const cv = this.cv, ptrs = new Map();
    let lastPinch = 0;

    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      lastPinch = 0;
    });

    const removePtr = e => ptrs.delete(e.pointerId);
    cv.addEventListener('pointerup', removePtr);
    cv.addEventListener('pointercancel', removePtr);

    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top, v = this.view;
      this.onCursor(v.cx + (mx - this.W / 2) / v.s, v.cy - (my - this.H / 2) / v.s);

      const prev = ptrs.get(e.pointerId);
      if (!prev) return;

      if (ptrs.size === 1) {
        v.cx -= (e.clientX - prev[0]) / v.s;
        v.cy += (e.clientY - prev[1]) / v.s;
        ptrs.set(e.pointerId, [e.clientX, e.clientY]);
        this.schedule();
      } else if (ptrs.size === 2) {
        ptrs.set(e.pointerId, [e.clientX, e.clientY]);
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (lastPinch) {
          this.zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, d / lastPinch);
        }
        lastPinch = d;
      }
    });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0015, -e.deltaY));
    }, {passive: false});
  }
}
