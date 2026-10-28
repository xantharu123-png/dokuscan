// Dokumenterkennung.
// 1. detectQuad: sucht im verkleinerten Bild das Blatt (schnell genug fürs Live-Kamerabild).
// 2. refineQuad: misst auf dem hochaufgelösten Foto jede Blattkante genau nach,
//    damit beim Zuschneiden kein Streifen vom Tisch übrig bleibt.

import {
  dist, orderQuad, polygonArea, isConvex, interiorAngles, maxCornerShift,
  intersectLines, insetQuad, clampQuad,
} from './geometry.js';

const MIN_AREA = 0.08;      // Blatt muss mindestens 8 % des Bildes füllen
const EDGE_CONTRAST = 14;   // Mindestkontrast entlang einer Blattkante (0–255)
const REFINE_SIDE = 2000;   // Auflösung (lange Seite) für die Feinmessung der Kanten
const MIN_GRADIENT = 10;
const EDGE_INSET = 1.5;     // Pixel, um die das Ergebnis nach innen rückt (Übergangssaum entfernen)

const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true });

const odd = (n) => Math.max(3, Math.round(n) | 1);

function drawScaled(source, srcW, srcH, maxSide) {
  const s = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * s));
  const h = Math.max(1, Math.round(srcH * s));
  if (work.width !== w || work.height !== h) {
    work.width = w;
    work.height = h;
  }
  workCtx.drawImage(source, 0, 0, w, h);
  return { sx: w / srcW, sy: h / srcH };
}

/**
 * Sucht das Dokument in `source` (Video, Canvas oder Bild mit Größe srcW × srcH).
 * `prev` ist das zuletzt erkannte Viereck – ähnliche Treffer werden bevorzugt, damit nichts flackert.
 * Rückgabe: { quad, score } in Quellkoordinaten oder null.
 */
export function detectQuad(cv, source, srcW, srcH, { maxSide = 400, prev = null } = {}) {
  const { sx, sy } = drawScaled(source, srcW, srcH, maxSide);
  const W = work.width, H = work.height;
  const mats = [];
  const keep = (m) => (mats.push(m), m);

  try {
    const rgba = keep(cv.imread(work));
    const rgb = keep(new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const gray = keep(new cv.Mat());
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const planes = new cv.MatVector();
    cv.split(hsv, planes);
    const sat = keep(planes.get(1));
    planes.delete();

    const blurG = keep(new cv.Mat());
    const blurS = keep(new cv.Mat());
    cv.GaussianBlur(gray, blurG, new cv.Size(5, 5), 0);
    cv.GaussianBlur(sat, blurS, new cv.Size(5, 5), 0);

    // Closing löscht dunkle Schrift auf dem Papier, Opening löscht bunte Details –
    // übrig bleiben die großen Flächen und damit die Blattkanten.
    const k = odd(Math.max(W, H) / 45);
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k)));
    const closedG = keep(new cv.Mat());
    const openS = keep(new cv.Mat());
    cv.morphologyEx(blurG, closedG, cv.MORPH_CLOSE, kernel);
    cv.morphologyEx(blurS, openS, cv.MORPH_OPEN, kernel);

    const candidates = [];
    const minArea = W * H * MIN_AREA;
    const edges = keep(new cv.Mat());
    const small = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    const fromCanny = (src, lo, hi) => {
      cv.Canny(src, edges, lo, hi);
      cv.dilate(edges, edges, small);
      collectQuads(cv, edges, minArea, candidates);
    };
    fromCanny(closedG, 30, 90);   // deutliche Helligkeitskanten
    fromCanny(closedG, 12, 36);   // schwache Kanten (helles Papier auf hellem Tisch)
    fromCanny(openS, 20, 60);     // Farbkanten (weißes Papier auf farbigem Untergrund)
    cv.threshold(closedG, edges, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    collectQuads(cv, edges, minArea, candidates);

    // Ab hier nur noch JavaScript – die Pixeldaten bleiben gültig.
    const G = { data: blurG.data, w: W, h: H };
    const S = { data: blurS.data, w: W, h: H };
    const prevSmall = prev ? prev.map((p) => ({ x: p.x * sx, y: p.y * sy })) : null;
    const diag = Math.hypot(W, H);

    let best = null;
    for (const pts of candidates) {
      const q = orderQuad(pts);
      let score = scoreQuad(q, G, S);
      if (score && prevSmall && maxCornerShift(q, prevSmall) < diag * 0.05) score *= 1.4;
      if (score > (best?.score ?? 0)) best = { q, score };
    }
    if (!best) return null;
    return { quad: best.q.map((p) => ({ x: p.x / sx, y: p.y / sy })), score: best.score };
  } finally {
    for (const m of mats) m.delete();
  }
}

function collectQuads(cv, binary, minArea, out) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const big = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area >= minArea) big.push({ i, area });
    c.delete();
  }
  big.sort((a, b) => b.area - a.area);

  for (const { i } of big.slice(0, 5)) {
    const contour = contours.get(i);
    const hull = new cv.Mat();
    cv.convexHull(contour, hull, false, true);
    for (const shape of [contour, hull]) {
      const peri = cv.arcLength(shape, true);
      for (const eps of [0.015, 0.03, 0.05]) {
        const approx = new cv.Mat();
        cv.approxPolyDP(shape, approx, eps * peri, true);
        const found = approx.rows === 4;
        if (found) {
          const d = approx.data32S;
          out.push([0, 1, 2, 3].map((j) => ({ x: d[j * 2], y: d[j * 2 + 1] })));
        }
        approx.delete();
        if (found) break;
      }
    }
    hull.delete();
    contour.delete();
  }
  contours.delete();
  hierarchy.delete();
}

/** Bewertet ein Viereck: groß, rechtwinklig und auf allen vier Seiten von echten Kanten gestützt. */
function scoreQuad(q, G, S) {
  if (!isConvex(q)) return 0;
  const area = polygonArea(q) / (G.w * G.h);
  if (area < MIN_AREA || area > 0.97) return 0;
  if (interiorAngles(q).some((a) => a < 45 || a > 135)) return 0;

  let sum = 0, min = 1;
  for (let i = 0; i < 4; i++) {
    const s = edgeSupport(q[i], q[(i + 1) % 4], G, S);
    sum += s;
    min = Math.min(min, s);
  }
  if (min < 0.45) return 0;
  const avg = sum / 4;
  return Math.sqrt(area) * avg * avg * min;
}

/** Anteil der Punkte entlang einer Seite, an denen tatsächlich ein Kontrastsprung liegt. */
function edgeSupport(a, b, G, S) {
  const len = dist(a, b);
  if (len < 10) return 0;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const N = 28;
  let hits = 0;
  for (let k = 0; k < N; k++) {
    const t = 0.06 + (0.88 * k) / (N - 1);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    let best = 0;
    for (let s = -2; s <= 2; s++) {
      const px = x + nx * s, py = y + ny * s;
      best = Math.max(best, contrast(G, px, py, nx, ny), contrast(S, px, py, nx, ny));
    }
    if (best >= EDGE_CONTRAST) hits++;
  }
  return hits / N;
}

function contrast(img, x, y, nx, ny) {
  const x1 = Math.round(x + nx * 3), y1 = Math.round(y + ny * 3);
  const x2 = Math.round(x - nx * 3), y2 = Math.round(y - ny * 3);
  const maxX = img.w - 2, maxY = img.h - 2;
  if (x1 < 1 || y1 < 1 || x2 < 1 || y2 < 1 || x1 > maxX || x2 > maxX || y1 > maxY || y2 > maxY) return 0;
  return Math.abs(img.data[y1 * img.w + x1] - img.data[y2 * img.w + x2]);
}

/**
 * Sucht das Dokument in einem fertigen Foto (Canvas) und liefert genaue Ecken.
 * `hint` ist das Viereck aus dem Livebild und dient als Rückfallwert.
 */
export function findDocument(cv, canvas, hint = null) {
  const found = detectQuad(cv, canvas, canvas.width, canvas.height, { maxSide: 640, prev: hint });
  const rough = found?.quad ?? hint;
  return rough ? refineQuad(cv, canvas, rough) : null;
}

/** Verschiebt jede Seite des Vierecks auf die stärkste Kante in ihrer Nähe und schneidet die Seiten neu. */
export function refineQuad(cv, canvas, quad) {
  const W = canvas.width, H = canvas.height;
  const { sx, sy } = drawScaled(canvas, W, H, REFINE_SIDE);
  const w = work.width, h = work.height;

  const rgba = cv.imread(work);
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  rgba.delete();
  cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);

  try {
    const img = { data: gray.data, w, h };
    const start = quad.map((p) => ({ x: p.x * sx, y: p.y * sy }));
    const R = Math.max(6, Math.round(Math.max(w, h) * 0.009));
    const lines = start.map((a, i) => fitEdge(img, a, start[(i + 1) % 4], R));

    let refined = start.map((p, i) => {
      const l1 = lines[(i + 3) % 4] ?? sideLine(start, (i + 3) % 4);
      const l2 = lines[i] ?? sideLine(start, i);
      const c = intersectLines(l1.p, l1.u, l2.p, l2.u);
      return c && dist(c, p) < R * 2.5 ? c : { ...p };
    });
    if (!isConvex(refined)) refined = start;
    refined = insetQuad(refined, EDGE_INSET);
    return clampQuad(refined.map((p) => ({ x: p.x / sx, y: p.y / sy })), W, H);
  } finally {
    gray.delete();
  }
}

function sideLine(q, i) {
  const a = q[i], b = q[(i + 1) % 4];
  const len = dist(a, b);
  return { p: a, u: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
}

/** Sucht entlang einer Seite quer zur Kante den stärksten Helligkeitssprung und legt eine Gerade hindurch. */
function fitEdge(img, a, b, R) {
  const len = dist(a, b);
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const n = Math.max(16, Math.min(120, Math.round(len / 8)));
  const pos = [], neg = [];
  let posSum = 0, negSum = 0;

  for (let k = 0; k < n; k++) {
    const t = 0.1 + (0.8 * k) / (n - 1);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    let bestP = 0, sP = 0, bestN = 0, sN = 0;
    for (let s = -R; s <= R; s += 0.5) {
      const g = sample(img, x + nx * (s + 1), y + ny * (s + 1)) - sample(img, x + nx * (s - 1), y + ny * (s - 1));
      if (g > bestP) { bestP = g; sP = s; }
      if (-g > bestN) { bestN = -g; sN = s; }
    }
    if (bestP >= MIN_GRADIENT) { pos.push({ x: x + nx * sP, y: y + ny * sP }); posSum += bestP; }
    if (bestN >= MIN_GRADIENT) { neg.push({ x: x + nx * sN, y: y + ny * sN }); negSum += bestN; }
  }

  // Entlang einer echten Blattkante ist der Sprung überall gleich gerichtet (z. B. Tisch dunkel → Papier hell).
  const pts = posSum >= negSum ? pos : neg;
  if (pts.length < n * 0.35) return null;
  return fitLineRansac(pts);
}

function sample(img, x, y) {
  if (x < 0 || y < 0 || x >= img.w - 1 || y >= img.h - 1) return NaN;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i = y0 * img.w + x0, d = img.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + img.w] * (1 - fx) + d[i + img.w + 1] * fx) * fy;
}

/** Robuste Geradenanpassung: Ausreißer (Schrift, Schatten, Finger) werden ignoriert. */
function fitLineRansac(pts) {
  const half = pts.length >> 1;
  let bestInliers = null;
  for (let i = 0; i < half; i++) {
    const a = pts[i], b = pts[i + half];
    const len = dist(a, b);
    if (len < 1) continue;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const inliers = pts.filter((p) => Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny) <= 1.5);
    if (!bestInliers || inliers.length > bestInliers.length) bestInliers = inliers;
  }
  if (!bestInliers || bestInliers.length < Math.max(6, pts.length * 0.4)) return null;
  return fitLine(bestInliers);
}

function fitLine(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, u: { x: Math.cos(theta), y: Math.sin(theta) } };
}
