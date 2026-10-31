// Dokumenterkennung.
// 1. detectQuad: sucht im verkleinerten Bild das Blatt (schnell genug fürs Live-Kamerabild).
// 2. refineQuad: misst auf dem hochaufgelösten Foto jede Blattkante genau nach,
//    damit beim Zuschneiden kein Streifen vom Tisch übrig bleibt.

import {
  dist, orderQuad, polygonArea, isConvex, interiorAngles, maxCornerShift,
  intersectLines, insetQuad, clampQuad, encloses,
} from './geometry.js';

const MIN_AREA = 0.08;      // Blatt muss mindestens 8 % des Bildes füllen
const EDGE_CONTRAST = 14;   // deutlicher Kontrastsprung entlang einer Blattkante (0–255)
const WEAK_CONTRAST = 5;    // schwacher Sprung – zählt nur, wenn er genau quer zur Kante verläuft
const REFINE_SIDE = 2000;   // Auflösung (lange Seite) für die Feinmessung der Kanten
const MIN_GRADIENT = 5;
const EDGE_INSET = 1.5;     // Pixel, um die das Ergebnis nach innen rückt (Übergangssaum entfernen)
const ENCLOSING = 1.18;     // so viel größer muss ein umschließendes Viereck sein (Schatten unterm Blatt bleibt darunter)

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
 * `thorough` lässt die empfindliche Stufe immer laufen (Fotos); sonst nur, wenn die strenge nichts
 * findet – das hält die Live-Erkennung schnell.
 * Rückgabe: { quad, score } in Quellkoordinaten oder null.
 * Ist `debug` ein Array, landen dort alle geprüften Kandidaten mit Bewertung (für test/photo.html).
 */
export function detectQuad(cv, source, srcW, srcH, { maxSide = 400, prev = null, thorough = false, debug = null } = {}) {
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
    const fromCanny = (src, lo, hi, from, out) => {
      cv.Canny(src, edges, lo, hi);
      cv.dilate(edges, edges, small);
      collectQuads(cv, edges, minArea, out, from);
    };
    fromCanny(closedG, 30, 90, 'canny-stark', candidates);    // deutliche Helligkeitskanten
    fromCanny(closedG, 12, 36, 'canny-schwach', candidates);  // schwache Kanten
    fromCanny(openS, 20, 60, 'canny-farbe', candidates);      // Farbkanten (weißes Papier auf farbigem Untergrund)
    cv.threshold(closedG, edges, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    collectQuads(cv, edges, minArea, candidates, 'otsu');

    // Pixeldaten erst nach allen OpenCV-Schritten holen (wächst der Speicher, werden alte Ansichten ungültig).
    const views = () => ({ G: { data: blurG.data, w: W, h: H }, S: { data: blurS.data, w: W, h: H } });
    let { G, S } = views();
    const prevSmall = prev ? prev.map((p) => ({ x: p.x * sx, y: p.y * sy })) : null;
    const diag = Math.hypot(W, H);
    const rate = (list, weak, keepBest) => {
      for (const { pts, from } of list) {
        const q = orderQuad(pts);
        const rating = rateQuad(q, G, S, weak);
        debug?.push({ ...rating, from, mode: weak ? 'empfindlich' : 'streng', quad: q.map((p) => ({ x: p.x / sx, y: p.y / sy })) });
        if (!rating.score) continue;
        const bonus = prevSmall && maxCornerShift(q, prevSmall) < diag * 0.05 ? 1.4 : 1;
        keepBest({ q, score: rating.score * bonus, area: rating.area });
      }
    };

    // Zwei Stufen: Die strenge Bewertung (nur deutliche Kanten) ist bewährt und entscheidet, wenn sie
    // etwas findet. Die empfindliche Bewertung (auch schwache Kanten, zusätzliche Kandidaten) springt
    // ein, wenn die strenge nichts findet – oder wenn sie ein deutlich größeres Viereck findet, das
    // das strenge Ergebnis umschließt (Blatt statt nur Textblock).
    let strict = null;
    rate(candidates, false, (c) => { if (c.score > (strict?.score ?? 0)) strict = c; });

    const sensitive = [];
    if (thorough || !strict) {
      // Lokale Kontrastverstärkung macht schwache Kanten sichtbar (weißes Papier auf hellem Tisch).
      const boosted = keep(new cv.Mat());
      const clahe = new cv.CLAHE(3, new cv.Size(8, 8));
      clahe.apply(closedG, boosted);
      clahe.delete();
      const extra = [];
      fromCanny(boosted, 20, 60, 'kontrast', extra);
      cv.Canny(boosted, edges, 10, 30);             // sehr schwache Kanten – nur als gerade Linien verwertbar
      collectLineQuads(cv, edges, W, H, extra);
      ({ G, S } = views());
      rate([...candidates, ...extra], true, (c) => sensitive.push(c));
    }
    const loose = outermost(sensitive, diag * 0.01);
    let best = strict;
    if (loose && (!best || (loose.area >= best.area * ENCLOSING && encloses(loose.q, best.q, diag * 0.01)))) best = loose;
    if (!best) return null;
    return { quad: best.q.map((p) => ({ x: p.x / sx, y: p.y / sy })), score: best.score };
  } finally {
    for (const m of mats) m.delete();
  }
}

function collectQuads(cv, binary, minArea, out, from) {
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
          out.push({ from, pts: [0, 1, 2, 3].map((j) => ({ x: d[j * 2], y: d[j * 2 + 1] })) });
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

/**
 * Sucht gerade Linien im Kantenbild und bildet aus je zwei fast parallelen Paaren Vierecke.
 * Hilft, wenn die Blattkante durch Schatten oder Gegenstände unterbrochen ist und daher keine
 * geschlossene Kontur entsteht.
 */
function collectLineQuads(cv, edges, W, H, out) {
  const segments = new cv.Mat();
  const minLen = Math.min(W, H) * 0.2;
  cv.HoughLinesP(edges, segments, 1, Math.PI / 180, Math.round(minLen / 2), minLen, minLen * 0.3);

  // Teilstücke derselben Geraden zusammenfassen; Gewicht = gesamte gefundene Länge
  const diag = Math.hypot(W, H);
  const lines = [];
  const d = segments.data32S;
  for (let i = 0; i < segments.rows; i++) {
    const x1 = d[i * 4], y1 = d[i * 4 + 1], x2 = d[i * 4 + 2], y2 = d[i * 4 + 3];
    let theta = Math.atan2(y2 - y1, x2 - x1);
    if (theta < 0) theta += Math.PI;
    if (theta >= Math.PI) theta -= Math.PI;
    const line = { theta, rho: -x1 * Math.sin(theta) + y1 * Math.cos(theta), weight: Math.hypot(x2 - x1, y2 - y1), p: { x: x1, y: y1 }, u: { x: Math.cos(theta), y: Math.sin(theta) } };
    const same = lines.find((l) => angleBetween(l, line) < 0.05 && lineGap(l, line) < diag * 0.015);
    if (same) same.weight += line.weight;
    else lines.push(line);
  }
  segments.delete();

  const top = lines.sort((a, b) => b.weight - a.weight).slice(0, 16);
  const pairs = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      if (angleBetween(top[i], top[j]) < 0.45 && lineGap(top[i], top[j]) > minLen) pairs.push([top[i], top[j]]);
    }
  }
  const inside = (p) => p && p.x > -0.02 * W && p.x < 1.02 * W && p.y > -0.02 * H && p.y < 1.02 * H;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i], [c, e] = pairs[j];
      if (angleBetween(a, c) < Math.PI / 4) continue;
      const pts = [cross(a, c), cross(c, b), cross(b, e), cross(e, a)];
      if (pts.every(inside)) out.push({ from: 'linien', pts });
    }
  }
}

/** Winkel zwischen zwei Geraden (0 … π/2), Richtung egal. */
function angleBetween(a, b) {
  const t = Math.abs(a.theta - b.theta);
  return Math.min(t, Math.PI - t);
}

/** Abstand zweier fast paralleler Geraden. */
function lineGap(a, b) {
  const flipped = Math.abs(a.theta - b.theta) > Math.PI / 2;
  return Math.abs(a.rho - (flipped ? -b.rho : b.rho));
}

const cross = (a, b) => intersectLines(a.p, a.u, b.p, b.u);

/** Bestbewerteter Kandidat – oder ein deutlich größerer, der ihn umschließt (Blatt statt Textblock). */
function outermost(list, tol) {
  let best = list.reduce((a, b) => (b.score > (a?.score ?? 0) ? b : a), null);
  for (let changed = true; best && changed; ) {
    changed = false;
    for (const c of list) {
      if (c.score >= best.score * 0.5 && c.area >= best.area * ENCLOSING && encloses(c.q, best.q, tol)) {
        best = c;
        changed = true;
        break;
      }
    }
  }
  return best;
}

/**
 * Bewertet ein Viereck: groß, rechtwinklig und auf allen vier Seiten von echten Kanten gestützt.
 * `weak` zählt auch schwache Kanten und verlangt dafür zusätzlich saubere Ecken.
 * Rückgabe: { score, reason?, area?, support? } – score 0 heißt verworfen, reason sagt warum.
 */
function rateQuad(q, G, S, weak) {
  if (!isConvex(q)) return { score: 0, reason: 'nicht konvex' };
  const area = polygonArea(q) / (G.w * G.h);
  if (area < MIN_AREA || area > 0.97) return { score: 0, reason: 'Fläche', area };
  if (interiorAngles(q).some((a) => a < 45 || a > 135)) return { score: 0, reason: 'Winkel', area };

  const support = [0, 1, 2, 3].map((i) => edgeSupport(q[i], q[(i + 1) % 4], G, S, weak));
  const min = Math.min(...support);
  if (min < 0.45) return { score: 0, reason: 'Kanten', area, support };
  if (weak && solidCorners(q, G, S) < 3) return { score: 0, reason: 'Ecken', area, support };
  const avg = support.reduce((a, b) => a + b) / 4;
  return { score: Math.sqrt(area) * avg * avg * min, area, support };
}

/** Anteil der Punkte entlang einer Seite, an denen tatsächlich eine Kante liegt. */
function edgeSupport(a, b, G, S, weak) {
  const len = dist(a, b);
  if (len < 10) return 0;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const N = 28;
  let hits = 0;
  for (let k = 0; k < N; k++) {
    const t = 0.06 + (0.88 * k) / (N - 1);
    if (edgeAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, nx, ny, G, S, weak)) hits++;
  }
  return hits / N;
}

/**
 * Zählt die Ecken, an denen beide angrenzenden Seiten direkt an der Ecke eine Kante haben.
 * So fallen Vierecke durch, die über das Blatt hinausragen (z. B. bis zu einer Holzmaserung).
 */
function solidCorners(q, G, S) {
  let solid = 0;
  for (let i = 0; i < 4; i++) {
    const c = q[i];
    const ok = [q[(i + 3) % 4], q[(i + 1) % 4]].every((o) => {
      const len = dist(c, o);
      const ux = (o.x - c.x) / len, uy = (o.y - c.y) / len;
      let hits = 0;
      for (const d of [3, 6, 9, 12, 15]) if (edgeAt(c.x + ux * d, c.y + uy * d, -uy, ux, G, S, true)) hits++;
      return hits >= 2;
    });
    if (ok) solid++;
  }
  return solid;
}

/**
 * Liegt an dieser Stelle eine Kante quer zur Richtung (nx, ny)? Ein deutlicher Sprung zählt immer;
 * mit `weak` auch ein schwacher, sofern sein Verlauf genau quer zur Seite zeigt – zufälliges
 * Rauschen und Holzmaserung erfüllen das selten.
 */
function edgeAt(x, y, nx, ny, G, S, weak) {
  for (let s = -2; s <= 2; s++) {
    const px = x + nx * s, py = y + ny * s;
    const c = Math.max(contrast(G, px, py, nx, ny), contrast(S, px, py, nx, ny));
    if (c >= EDGE_CONTRAST || (weak && c >= WEAK_CONTRAST && alignedGradient(G, px, py, nx, ny))) return true;
  }
  return false;
}

function contrast(img, x, y, nx, ny) {
  const x1 = Math.round(x + nx * 3), y1 = Math.round(y + ny * 3);
  const x2 = Math.round(x - nx * 3), y2 = Math.round(y - ny * 3);
  const maxX = img.w - 2, maxY = img.h - 2;
  if (x1 < 1 || y1 < 1 || x2 < 1 || y2 < 1 || x1 > maxX || x2 > maxX || y1 > maxY || y2 > maxY) return 0;
  return Math.abs(img.data[y1 * img.w + x1] - img.data[y2 * img.w + x2]);
}

/** Zeigt der Helligkeitsverlauf an dieser Stelle (bis auf ±25°) quer zur Seite? */
function alignedGradient(img, x, y, nx, ny) {
  const xi = Math.round(x), yi = Math.round(y), w = img.w;
  if (xi < 2 || yi < 2 || xi >= w - 2 || yi >= img.h - 2) return false;
  const d = img.data, i = yi * w + xi;
  const gx = d[i + 2] - d[i - 2], gy = d[i + 2 * w] - d[i - 2 * w];
  const mag = Math.hypot(gx, gy);
  return mag > 0 && Math.abs(gx * nx + gy * ny) / mag >= 0.9;
}

/**
 * Sucht das Dokument in einem fertigen Foto (Canvas) und liefert genaue Ecken.
 * `hint` ist das Viereck aus dem Livebild und dient als Rückfallwert.
 */
export function findDocument(cv, canvas, hint = null) {
  const found = detectQuad(cv, canvas, canvas.width, canvas.height, { maxSide: 640, prev: hint, thorough: true });
  const rough = found?.quad ?? hint;
  return rough ? refineQuad(cv, canvas, rough).quad : null;
}

/**
 * Für „Automatisch“ im Editor: sucht das Blatt bevorzugt nahe den aktuellen Ecken.
 * Findet die Suche nichts, werden die aktuellen Ecken an die nächstgelegenen Kanten angelegt –
 * sofern mindestens drei Seiten eine Kante gefunden haben. Sonst null.
 */
export function autoCorners(cv, canvas, current) {
  const found = detectQuad(cv, canvas, canvas.width, canvas.height, { maxSide: 640, prev: current, thorough: true });
  if (found) return refineQuad(cv, canvas, found.quad).quad;
  const snapped = refineQuad(cv, canvas, current);
  return snapped.fitted >= 3 ? snapped.quad : null;
}

/**
 * Verschiebt jede Seite des Vierecks auf die stärkste Kante in ihrer Nähe und schneidet die Seiten neu.
 * Rückgabe: { quad, fitted } – fitted = Anzahl Seiten, an denen eine Kante gefunden wurde.
 */
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
    return {
      quad: clampQuad(refined.map((p) => ({ x: p.x / sx, y: p.y / sy })), W, H),
      fitted: lines.filter(Boolean).length,
    };
  } finally {
    gray.delete();
  }
}

function sideLine(q, i) {
  const a = q[i], b = q[(i + 1) % 4];
  const len = dist(a, b);
  return { p: a, u: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
}

/**
 * Sucht entlang einer Seite quer zur Kante den stärksten Helligkeitssprung und legt eine Gerade hindurch.
 * Der Sprung wird über 4 Pixel gemessen (auch weiche Übergänge von Papier zu hellem Tisch zählen)
 * und über drei Punkte längs der Kante gemittelt – das dämpft Rauschen. Die Kantenlage ist der
 * Schwerpunkt des Spitzenbereichs und damit trotz breiter Messung genau.
 */
function fitEdge(img, a, b, R) {
  const len = dist(a, b);
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const nx = -uy, ny = ux;
  const n = Math.max(16, Math.min(120, Math.round(len / 8)));
  const pos = [], neg = [];
  let posSum = 0, negSum = 0;
  const step = (x, y, s) => {
    let g = 0;
    for (const t of [-1.5, 0, 1.5]) {
      const cx = x + ux * t, cy = y + uy * t;
      g += sample(img, cx + nx * (s + 2), cy + ny * (s + 2)) - sample(img, cx + nx * (s - 2), cy + ny * (s - 2));
    }
    return g / 3;
  };
  const offsets = [];
  for (let s = -R; s <= R; s += 0.5) offsets.push(s);

  for (let k = 0; k < n; k++) {
    const t = 0.1 + (0.8 * k) / (n - 1);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const g = offsets.map((s) => step(x, y, s));
    const p = peak(g, offsets, 1), q = peak(g, offsets, -1);
    if (p.value >= MIN_GRADIENT) { pos.push({ x: x + nx * p.s, y: y + ny * p.s }); posSum += p.value; }
    if (q.value >= MIN_GRADIENT) { neg.push({ x: x + nx * q.s, y: y + ny * q.s }); negSum += q.value; }
  }

  // Entlang einer echten Blattkante ist der Sprung überall gleich gerichtet (z. B. Tisch dunkel → Papier hell).
  const pts = posSum >= negSum ? pos : neg;
  if (pts.length < n * 0.35) return null;
  return fitLineRansac(pts);
}

/** Stärkste Stelle mit Vorzeichen `sign` und Lage als Schwerpunkt aller Werte ab 70 % der Spitze. */
function peak(g, offsets, sign) {
  let best = -1, value = 0;
  g.forEach((v, i) => { if (sign * v > value) { value = sign * v; best = i; } });
  if (best < 0) return { value: 0, s: 0 };
  let sum = 0, weight = 0;
  for (const dir of [-1, 1]) {
    for (let i = dir < 0 ? best : best + 1; i >= 0 && i < g.length && sign * g[i] >= value * 0.7; i += dir) {
      sum += offsets[i] * sign * g[i];
      weight += sign * g[i];
    }
  }
  return { value, s: sum / weight };
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
