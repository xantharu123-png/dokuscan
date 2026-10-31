// Hilfsfunktionen für Vierecke.
// Ein Viereck (quad) ist immer ein Array aus 4 Punkten {x, y} in der Reihenfolge
// oben-links, oben-rechts, unten-rechts, unten-links (im Uhrzeigersinn auf dem Bildschirm).

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Bringt 4 beliebige Punkte in die Reihenfolge oben-links, oben-rechts, unten-rechts, unten-links. */
export function orderQuad(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  }
  return [0, 1, 2, 3].map((i) => ({ x: sorted[(start + i) % 4].x, y: sorted[(start + i) % 4].y }));
}

export function polygonArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i], n = q[(i + 1) % q.length];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Innenwinkel in Grad, einer pro Ecke. */
export function interiorAngles(q) {
  return q.map((p, i) => {
    const prev = q[(i + 3) % 4], next = q[(i + 1) % 4];
    const ax = prev.x - p.x, ay = prev.y - p.y, bx = next.x - p.x, by = next.y - p.y;
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

export const scaleQuad = (q, s) => q.map((p) => ({ x: p.x * s, y: p.y * s }));

export const lerpQuad = (a, b, t) =>
  a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t }));

export const maxCornerShift = (a, b) => Math.max(...a.map((p, i) => dist(p, b[i])));

export function clampQuad(q, w, h) {
  return q.map((p) => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) }));
}

/** Rechteck mit Rand (Anteil der Bildgröße) als Startwert, wenn nichts erkannt wurde. */
export function defaultQuad(w, h, margin = 0.08) {
  const mx = w * margin, my = h * margin;
  return [
    { x: mx, y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx, y: h - my },
  ];
}

/** Abstand eines Punkts zum Rand des Vierecks – positiv innerhalb, negativ außerhalb. */
export function insideDistance(p, q) {
  return Math.min(...q.map((a, i) => {
    const b = q[(i + 1) % 4];
    return ((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / dist(a, b);
  }));
}

/** Liegt `inner` (bis auf `tol` Pixel) vollständig in `outer`? */
export const encloses = (outer, inner, tol) => inner.every((p) => insideDistance(p, outer) >= -tol);

/** Schnittpunkt zweier Geraden (Punkt p, Richtung u). */
export function intersectLines(p1, u1, p2, u2) {
  const cross = u1.x * u2.y - u1.y * u2.x;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((p2.x - p1.x) * u2.y - (p2.y - p1.y) * u2.x) / cross;
  return { x: p1.x + u1.x * t, y: p1.y + u1.y * t };
}

/** Schiebt jede Kante um d Pixel nach innen. */
export function insetQuad(q, d) {
  const lines = q.map((a, i) => {
    const b = q[(i + 1) % 4];
    const len = dist(a, b);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // Bei dieser Eckreihenfolge zeigt (-u.y, u.x) ins Innere.
    return { p: { x: a.x - u.y * d, y: a.y + u.x * d }, u };
  });
  return q.map((p, i) => {
    const l1 = lines[(i + 3) % 4], l2 = lines[i];
    return intersectLines(l1.p, l1.u, l2.p, l2.u) ?? { ...p };
  });
}
