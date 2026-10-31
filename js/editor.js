// Vollbild-Editor zum Verschieben der vier Ecken. Beim Ziehen zeigt eine Lupe die Stelle vergrößert.

import { defaultQuad, isConvex } from './geometry.js';

const HIT_RADIUS = 44;   // Trefferradius für Griffe (CSS-Pixel)
const LOUPE_RADIUS = 62;
const LOUPE_ZOOM = 3;
const COLOR_OK = '#34d399';
const COLOR_BAD = '#ff6b6b';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Öffnet den Editor für `image` (Canvas) mit Startviereck `quad`.
 * `onAuto(corners)` liefert ein automatisch erkanntes Viereck (ausgehend von den aktuellen Ecken) oder null;
 * ohne `onAuto` gibt es keinen Knopf „Automatisch“.
 * Rückgabe: Promise mit dem neuen Viereck oder null bei Abbruch.
 */
export function openEditor({ image, quad, onAuto, title = 'Ecken anpassen' }) {
  const root = document.getElementById('editor');
  const stage = document.getElementById('ed-stage');
  const canvas = document.getElementById('ed-canvas');
  const ctx = canvas.getContext('2d');
  const btnDone = document.getElementById('ed-done');

  let corners = quad.map((p) => ({ ...p }));
  let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
  let drag = null;

  const toScreen = (p) => ({ x: view.ox + p.x * view.s, y: view.oy + p.y * view.s });
  const toImage = (x, y) => ({
    x: clamp((x - view.ox) / view.s, 0, image.width),
    y: clamp((y - view.oy) / view.s, 0, image.height),
  });
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function layout() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const pad = 28;
    const s = Math.min((r.width - 2 * pad) / image.width, (r.height - 2 * pad) / image.height);
    view = { s, ox: (r.width - image.width * s) / 2, oy: (r.height - image.height * s) / 2, w: r.width, h: r.height, dpr };
    draw();
  }

  function tracePath(pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function draw() {
    const ok = isConvex(corners);
    const color = ok ? COLOR_OK : COLOR_BAD;
    btnDone.disabled = !ok;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.drawImage(image, view.ox, view.oy, image.width * view.s, image.height * view.s);

    const pts = corners.map(toScreen);
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, image.width * view.s, image.height * view.s);
    tracePath(pts);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill('evenodd');

    ctx.beginPath();
    tracePath(pts);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();

    pts.forEach((p, i) => {
      const m = midpoint(p, pts[(i + 1) % 4]);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    });
    pts.forEach((p, i) => {
      const active = drag?.kind === 'corner' && drag.i === i;
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? 16 : 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.stroke();
    });

    if (drag) drawLoupe(drag.p, color);
  }

  function drawLoupe(target, color) {
    const c = toScreen(target);
    const R = LOUPE_RADIUS;
    let ly = c.y - 110;
    if (ly - R < 8) ly = c.y + 110;
    const lx = clamp(c.x, R + 8, view.w - R - 8);
    const z = view.s * LOUPE_ZOOM;
    const map = (p) => ({ x: lx + (p.x - target.x) * z, y: ly + (p.y - target.y) * z });

    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(lx - R, ly - R, 2 * R, 2 * R);
    ctx.drawImage(image, lx - target.x * z, ly - target.y * z, image.width * z, image.height * z);
    ctx.beginPath();
    tracePath(corners.map(map));
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx - 10, ly); ctx.lineTo(lx + 10, ly);
    ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly + 10);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(lx, ly, R, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    const { x, y } = pointer(e);
    let best = null, bestD = HIT_RADIUS;
    corners.forEach((p, i) => {
      const s = toScreen(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = { kind: 'corner', i, s }; }
    });
    // Seitenmitten nur, wenn keine Ecke näher liegt – damit wird eine ganze Kante verschoben.
    corners.forEach((p, i) => {
      const s = toScreen(midpoint(p, corners[(i + 1) % 4]));
      const d = Math.hypot(s.x - x, s.y - y) + 8;
      if (d < bestD) { bestD = d; best = { kind: 'edge', i, s }; }
    });
    if (!best) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const a = corners[best.i], b = corners[(best.i + 1) % 4];
    drag = {
      ...best,
      id: e.pointerId,
      dx: best.s.x - x,
      dy: best.s.y - y,
      start: toImage(best.s.x, best.s.y),
      a0: { ...a },
      b0: { ...b },
      p: best.kind === 'corner' ? { ...a } : midpoint(a, b),
    };
    draw();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const { x, y } = pointer(e);
    const p = toImage(x + drag.dx, y + drag.dy);
    if (drag.kind === 'corner') {
      corners[drag.i] = p;
      drag.p = p;
    } else {
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      const ia = drag.i, ib = (drag.i + 1) % 4;
      corners[ia] = { x: clamp(drag.a0.x + dx, 0, image.width), y: clamp(drag.a0.y + dy, 0, image.height) };
      corners[ib] = { x: clamp(drag.b0.x + dx, 0, image.width), y: clamp(drag.b0.y + dy, 0, image.height) };
      drag.p = midpoint(corners[ia], corners[ib]);
    }
    draw();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    draw();
  }

  return new Promise((resolve) => {
    const observer = new ResizeObserver(layout);

    function finish(result) {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      root.hidden = true;
      canvas.width = canvas.height = 0;
      resolve(result);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    btnDone.onclick = () => isConvex(corners) && finish(corners);
    document.getElementById('ed-cancel').onclick = () => finish(null);
    document.getElementById('ed-full').onclick = () => {
      corners = defaultQuad(image.width, image.height, 0);
      draw();
    };
    const autoBtn = document.getElementById('ed-auto');
    autoBtn.hidden = !onAuto;
    autoBtn.onclick = () => {
      const q = onAuto?.(corners);
      if (q) {
        corners = q;
        draw();
      }
    };
    document.getElementById('ed-title').textContent = title;

    root.hidden = false;
    observer.observe(stage);
  });
}
