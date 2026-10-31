// Unterschrift: speichern (nur auf diesem Gerät), umfärben, aus einem Foto freistellen, mit dem Finger zeichnen.
// Eine Unterschrift ist ein Canvas mit durchsichtigem Hintergrund, nur die Tinte ist sichtbar.

const STORAGE_KEY = 'dokuscan.signature';
const MAX_WIDTH = 1200;
const PAPER_LEVEL = 215; // ab dieser Helligkeit (nach Ausgleich der Beleuchtung) ist es Papier
const INK_LEVEL = 110;   // ab dieser Dunkelheit ist es volle Tinte

export const INKS = { blau: '#1d3f9a', schwarz: '#15171c' };

/** Gespeicherte Unterschrift als Canvas oder null. */
export async function loadSignature() {
  let url = null;
  try {
    url = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!url) return null;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

/** Speichert die Unterschrift dauerhaft auf dem Gerät. Gibt false zurück, wenn das nicht möglich war. */
export function saveSignature(canvas) {
  try {
    localStorage.setItem(STORAGE_KEY, canvas.toDataURL('image/png'));
    navigator.storage?.persist?.().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function deleteSignature() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nichts gespeichert oder Speicher nicht verfügbar
  }
}

/** Neue Unterschrift in anderer Tintenfarbe (Form und Deckkraft bleiben). */
export function recolor(canvas, ink) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/**
 * Stellt eine Unterschrift aus einem Foto frei: Beleuchtung ausgleichen, Tinte vom Papier trennen,
 * auf die Tinte zuschneiden und einfärben. Liefert ein Canvas oder null, wenn keine Tinte gefunden wurde.
 */
export function extractSignature(cv, canvas, ink) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  // Papierhelligkeit grob schätzen (dünne Tintenstriche verschwinden durch Dilatation) und herausrechnen.
  const small = new cv.Mat();
  const sw = Math.max(8, Math.round(gray.cols / 8)), sh = Math.max(8, Math.round(gray.rows / 8));
  cv.resize(gray, small, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  cv.dilate(small, small, kernel, new cv.Point(-1, -1), 2);
  kernel.delete();
  cv.GaussianBlur(small, small, new cv.Size(0, 0), 3);
  const paper = new cv.Mat();
  cv.resize(small, paper, gray.size(), 0, 0, cv.INTER_LINEAR);
  small.delete();
  const norm = new cv.Mat();
  cv.divide(gray, paper, norm, 255);
  gray.delete();
  paper.delete();

  const W = norm.cols, H = norm.rows, v = norm.data;
  const alpha = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = Math.min(1, Math.max(0, (PAPER_LEVEL - v[i]) / (PAPER_LEVEL - INK_LEVEL)));
    if (a >= 0.15) alpha[i] = Math.round(a * 255);
  }
  norm.delete();
  removeSpecks(cv, alpha, W, H);

  const rows = new Uint32Array(H), cols = new Uint32Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] > 90) { rows[y]++; cols[x]++; }
    }
  }

  // Zuschnitt auf die Tinte; einzelne Staubpunkte zählen nicht.
  const minRow = Math.max(2, W * 0.002), minCol = Math.max(2, H * 0.004);
  const y0 = rows.findIndex((n) => n >= minRow), y1 = H - 1 - [...rows].reverse().findIndex((n) => n >= minRow);
  const x0 = cols.findIndex((n) => n >= minCol), x1 = W - 1 - [...cols].reverse().findIndex((n) => n >= minCol);
  if (y0 < 0 || x0 < 0 || y1 - y0 < 8 || x1 - x0 < 16) return null;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  const bx = Math.max(0, x0 - m), by = Math.max(0, y0 - m);
  const bw = Math.min(W, x1 + m + 1) - bx, bh = Math.min(H, y1 + m + 1) - by;

  const full = document.createElement('canvas');
  full.width = bw;
  full.height = bh;
  const fctx = full.getContext('2d');
  const img = fctx.createImageData(bw, bh);
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(ink.slice(k, k + 2), 16));
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = (y * bw + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = alpha[(by + y) * W + bx + x];
    }
  }
  fctx.putImageData(img, 0, 0);
  return limitWidth(full);
}

/**
 * Entfernt kleine, isolierte Flecken (Staub, Papierfasern): Nur zusammenhängende Striche ab einer
 * Mindestgröße bleiben – samt ihrem weichen Rand.
 */
function removeSpecks(cv, alpha, W, H) {
  const mask = new cv.Mat(H, W, cv.CV_8UC1);
  let m = mask.data;
  for (let i = 0; i < W * H; i++) m[i] = alpha[i] > 90 ? 255 : 0;
  const labels = new cv.Mat(), stats = new cv.Mat(), centroids = new cv.Mat();
  const n = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8, cv.CV_32S);
  const minArea = Math.max(30, W * H * 0.00005);
  const keep = new Uint8Array(n);
  for (let l = 1; l < n; l++) keep[l] = stats.intAt(l, cv.CC_STAT_AREA) >= minArea ? 1 : 0;
  const lab = labels.data32S;
  m = mask.data; // nach OpenCV-Aufrufen neu holen – der Speicher kann gewachsen sein
  for (let i = 0; i < W * H; i++) m[i] = keep[lab[i]] ? 255 : 0;
  labels.delete(); stats.delete(); centroids.delete();

  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.dilate(mask, mask, kernel);
  kernel.delete();
  m = mask.data;
  for (let i = 0; i < W * H; i++) if (!m[i]) alpha[i] = 0;
  mask.delete();
}

function limitWidth(canvas) {
  if (canvas.width <= MAX_WIDTH) return canvas;
  const out = document.createElement('canvas');
  out.width = MAX_WIDTH;
  out.height = Math.round((canvas.height * MAX_WIDTH) / canvas.width);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  canvas.width = canvas.height = 0;
  return out;
}

/** Zeichenfeld: Unterschrift mit dem Finger. Liefert das zugeschnittene Canvas oder null bei Abbruch. */
export function openSignaturePad(ink) {
  const root = document.getElementById('sig-pad');
  const canvas = document.getElementById('pad-canvas');
  const ctx = canvas.getContext('2d');
  let dpr = 1, last = null, box = null;

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    box = null;
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  }

  function grow(p) {
    const pad = 4 * dpr;
    box = box
      ? { x0: Math.min(box.x0, p.x - pad), y0: Math.min(box.y0, p.y - pad), x1: Math.max(box.x1, p.x + pad), y1: Math.max(box.y1, p.y + pad) }
      : { x0: p.x - pad, y0: p.y - pad, x1: p.x + pad, y1: p.y + pad };
  }

  function onDown(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    last = { ...point(e), mid: null };
    ctx.lineWidth = 3.2 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    grow(last);
  }

  function onMove(e) {
    if (!last) return;
    e.preventDefault();
    const p = point(e);
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    // Geglättete Linie: Kurve über den letzten Punkt bis zur Mitte des neuen Abschnitts
    ctx.beginPath();
    ctx.moveTo(last.mid?.x ?? last.x, last.mid?.y ?? last.y);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();
    last = { ...p, mid };
    grow(p);
  }

  function onUp() {
    last = null;
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

    function crop() {
      if (!box) return null;
      const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
      const x1 = Math.min(canvas.width, Math.ceil(box.x1)), y1 = Math.min(canvas.height, Math.ceil(box.y1));
      if (x1 - x0 < 10 || y1 - y0 < 4) return null;
      const out = document.createElement('canvas');
      out.width = x1 - x0;
      out.height = y1 - y0;
      out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return limitWidth(out);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    document.getElementById('pad-cancel').onclick = () => finish(null);
    document.getElementById('pad-done').onclick = () => finish(crop());
    document.getElementById('pad-clear').onclick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      box = null;
    };

    root.hidden = false;
    observer.observe(canvas);
  });
}
