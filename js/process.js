// Bildverarbeitung: Entzerren (Perspektive), Filter, Drehen, Kodieren.

import { dist } from './geometry.js';

const MAX_OUTPUT_SIDE = 3508;  // DIN A4 bei 300 dpi
const MAX_SOURCE_SIDE = 4096;  // iOS begrenzt die Canvas-Größe
const MAX_SOURCE_PIXELS = 16e6;
const JPEG_QUALITY = 0.88;

export const FILTERS = ['original', 'enhanced', 'gray', 'bw'];

/** Zielgröße des entzerrten Blatts. Nahe an DIN A gerundet, weil die Perspektive das Seitenverhältnis leicht verfälscht. */
export function outputSize(quad) {
  const [tl, tr, br, bl] = quad;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const r = h / w;
  if (Math.abs(r / Math.SQRT2 - 1) < 0.07) h = w * Math.SQRT2;
  else if (Math.abs(r * Math.SQRT2 - 1) < 0.07) w = h * Math.SQRT2;
  const s = Math.min(1, MAX_OUTPUT_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Schneidet das Blatt aus, entzerrt es, wendet Filter und Drehung an. Liefert { blob, width, height }. */
/**
 * Schneidet das Blatt aus, entzerrt es, wendet Filter und Drehung an. Liefert { blob, width, height }.
 * `overlays` sind Einblendungen wie die Unterschrift: { image, cx, cy, w, angle } – Mitte und Breite
 * als Anteil der ungedrehten Seite, Winkel in Grad. Sie werden nach dem Filter eingefügt und drehen
 * mit der Seite mit.
 */
export async function renderPage(cv, source, quad, filter, rotation = 0, overlays = []) {
  const rgb = warp(cv, source, quad);
  const result = applyFilter(cv, rgb, filter);
  rgb.delete();

  const canvas = matToCanvas(cv, result, rotation, overlays);
  result.delete();
  const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  const out = { blob, width: canvas.width, height: canvas.height };
  releaseCanvas(canvas);
  return out;
}

/** Schneidet das Viereck aus und entzerrt es, ohne Filter – als Canvas (z. B. für den Unterschrift-Ausschnitt). */
export function warpToCanvas(cv, source, quad) {
  const rgb = warp(cv, source, quad);
  const canvas = document.createElement('canvas');
  cv.imshow(canvas, rgb);
  rgb.delete();
  return canvas;
}

function warp(cv, source, quad) {
  const { w, h } = outputSize(quad);
  const src = cv.imread(source);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(from, to);
  const warped = new cv.Mat();
  cv.warpPerspective(src, warped, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
  src.delete(); from.delete(); to.delete(); M.delete();

  const rgb = new cv.Mat();
  cv.cvtColor(warped, rgb, cv.COLOR_RGBA2RGB);
  warped.delete();
  return rgb;
}

function applyFilter(cv, rgb, filter) {
  if (filter === 'original') return rgb.clone();
  const enhanced = evenOutLighting(cv, rgb);
  if (filter === 'enhanced') return enhanced;

  const gray = new cv.Mat();
  cv.cvtColor(enhanced, gray, cv.COLOR_RGB2GRAY);
  enhanced.delete();
  if (filter === 'gray') return gray;

  // Lokaler Schwellwert für feine Schrift, globaler Schwellwert füllt große dunkle Flächen
  // (fette Überschriften, Balken), die lokal sonst hohl würden.
  const bw = new cv.Mat();
  const block = Math.min(61, Math.max(15, Math.round(Math.max(gray.cols, gray.rows) / 70) | 1));
  cv.adaptiveThreshold(gray, bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 12);
  const solid = new cv.Mat();
  const t = cv.threshold(gray, solid, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  if (t > 170) cv.threshold(gray, solid, 170, 255, cv.THRESH_BINARY);
  cv.bitwise_and(bw, solid, bw);
  solid.delete();
  gray.delete();
  return bw;
}

/**
 * Entfernt Schatten und Farbstich: Die Papierfarbe wird grob geschätzt (Schrift weggefiltert)
 * und jeder Pixel durch sie geteilt. Papier wird so überall weiß, Schrift und Farben bleiben.
 */
function evenOutLighting(cv, rgb) {
  const small = new cv.Mat();
  const sw = Math.max(8, Math.round(rgb.cols / 8)), sh = Math.max(8, Math.round(rgb.rows / 8));
  cv.resize(rgb, small, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  cv.dilate(small, small, kernel, new cv.Point(-1, -1), 2);
  kernel.delete();
  cv.GaussianBlur(small, small, new cv.Size(0, 0), 3);

  const paper = new cv.Mat();
  cv.resize(small, paper, rgb.size(), 0, 0, cv.INTER_LINEAR);
  small.delete();
  const out = new cv.Mat();
  cv.divide(rgb, paper, out, 255);
  paper.delete();
  out.convertTo(out, -1, 1.12, -30);
  return out;
}

function matToCanvas(cv, mat, rotation, overlays) {
  const flat = document.createElement('canvas');
  cv.imshow(flat, mat);
  drawOverlays(flat, overlays);
  if (!rotation) return flat;

  const turned = document.createElement('canvas');
  const swap = rotation % 180 !== 0;
  turned.width = swap ? flat.height : flat.width;
  turned.height = swap ? flat.width : flat.height;
  const ctx = turned.getContext('2d');
  ctx.translate(turned.width / 2, turned.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(flat, -flat.width / 2, -flat.height / 2);
  releaseCanvas(flat);
  return turned;
}

function drawOverlays(canvas, overlays) {
  const ctx = canvas.getContext('2d');
  for (const o of overlays) {
    const w = o.w * canvas.width, h = (w * o.image.height) / o.image.width;
    ctx.save();
    ctx.translate(o.cx * canvas.width, o.cy * canvas.height);
    ctx.rotate((o.angle * Math.PI) / 180);
    ctx.drawImage(o.image, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht gespeichert werden'))), type, quality)
  );
}

/** iOS gibt Canvas-Speicher erst frei, wenn die Größe auf 0 gesetzt wird. */
export function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

/** Lädt ein Bild (Datei oder Blob) in ein Canvas, verkleinert auf eine Größe, die iOS sicher verarbeiten kann. */
export async function loadImageCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.min(1, MAX_SOURCE_SIDE / Math.max(iw, ih), Math.sqrt(MAX_SOURCE_PIXELS / (iw * ih)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(iw * s);
    canvas.height = Math.round(ih * s);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
