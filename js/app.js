// DokuScan – Steuerung der Oberfläche: Kamera → Seiten → PDF.

import { loadCv } from './cv-loader.js';
import { Camera, QuadTracker } from './camera.js';
import { detectQuad, findDocument, autoCorners } from './detect.js';
import { renderPage, warpToCanvas, canvasToBlob, releaseCanvas, loadImageCanvas } from './process.js';
import { defaultQuad } from './geometry.js';
import { openEditor } from './editor.js';
import { buildPdf, canShareFile, shareFile } from './pdf.js';
import { INKS, loadSignature, saveSignature, deleteSignature, recolor, extractSignature, openSignaturePad } from './signature.js';
import { openPlacement, toPageFrame, toViewFrame } from './placement.js';

const $ = (id) => document.getElementById(id);
const DETECT_INTERVAL = 100; // ms zwischen zwei Erkennungen im Livebild
const SOURCE_QUALITY = 0.92;

const ICON = (path) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS = {
  left: ICON('<path d="M15 18l-6-6 6-6"/>'),
  right: ICON('<path d="M9 18l6-6-6-6"/>'),
  crop: ICON('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
  rotate: ICON('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  delete: ICON('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  sign: ICON('<path d="M3 21c3-1 4-4 6-4s1 3 3 3 3-3 5-3"/><path d="M14.5 4.5l5 5L11 18H6v-5z"/>'),
};

const state = {
  // Seite: { id, source: Blob, quad, rotation, signature: { image, cx, cy, w, angle } | null,
  //          result: { blob, url, width, height } }
  pages: [],
  filter: readPref('filter', 'enhanced'),
  auto: readPref('auto', 'true') === 'true',
  liveCamera: readPref('live', 'true') === 'true', // false = iPhone-Kamera über die Fotoauswahl
  ink: readPref('ink', 'blau'),
  signature: null, // gespeicherte Unterschrift (Canvas)
  view: 'loading',
};

let cv = null;
let nextId = 1;
let loopId = 0;
let lastDetect = 0;
let detectCost = 0; // gleitender Mittelwert der Erkennungsdauer (ms)
let capturing = false;
let pdfFile = null;
let pdfUrl = null;
let wakeLock = null;
let toastTimer = 0;

const video = $('video');
const overlay = $('overlay');
const overlayCtx = overlay.getContext('2d');
const camera = new Camera(video);
const tracker = new QuadTracker();

// ---------- Einstellungen ----------

function readPref(key, fallback) {
  try {
    return localStorage.getItem('dokuscan.' + key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem('dokuscan.' + key, String(value));
  } catch {
    // Privater Modus o. Ä. – Einstellung gilt dann nur bis zum Schließen.
  }
}

// ---------- Ansichten ----------

function showView(name) {
  for (const v of ['loading', 'camera', 'review']) $('view-' + v).classList.toggle('is-active', v === name);
  state.view = name;
  if (name === 'camera') {
    enterCamera();
  } else {
    stopLoop();
    camera.pause(); // Zugriff behalten: iOS würde beim Wiedereinschalten erneut um Erlaubnis fragen
  }
  if (name === 'review') renderReview();
}

// ---------- Kamera und Live-Erkennung ----------

/**
 * Kamera-Ansicht je nach Modus: Live-Kamera mit Erkennung (iOS fragt pro App-Start einmal nach
 * der Erlaubnis) oder iPhone-Kamera über die Fotoauswahl (keine Nachfrage, kein Live-Rahmen).
 */
function enterCamera() {
  $('view-camera').classList.toggle('system-camera', !state.liveCamera);
  $('cam-off').hidden = state.liveCamera;
  if (state.liveCamera) {
    startCamera();
  } else {
    stopLoop();
    camera.stop();
    tracker.reset();
    $('cam-error').hidden = true;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    $('hint').textContent = 'iPhone-Kamera';
  }
}

function setLiveCamera(on) {
  state.liveCamera = on;
  writePref('live', on);
  enterCamera();
}

async function startCamera() {
  $('cam-error').hidden = true;
  try {
    await camera.start();
    startLoop();
    keepAwake();
  } catch (err) {
    showCameraError(err);
  }
}

function showCameraError(err) {
  let text;
  if (err.name === 'NotAllowedError') {
    text = 'Der Kamerazugriff wurde nicht erlaubt. Erlaube ihn in den Safari-Einstellungen unter „Kamera“ und tippe dann auf „Erneut versuchen“.';
  } else if (err.name === 'InsecureContext') {
    text = 'Die Kamera funktioniert nur, wenn die App über https:// geöffnet wird.';
  } else if (err.name === 'NotFoundError') {
    text = 'Es wurde keine Kamera gefunden.';
  } else {
    text = `Die Kamera konnte nicht gestartet werden (${err.message}).`;
  }
  $('cam-error-text').textContent = text + ' Du kannst stattdessen ein vorhandenes Foto auswählen.';
  $('cam-error').hidden = false;
}

async function keepAwake() {
  try {
    if (!wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    // Nicht unterstützt – Bildschirm darf dann wie gewohnt ausgehen.
  }
}

function startLoop() {
  if (!loopId) loopId = requestAnimationFrame(tick);
}

function stopLoop() {
  cancelAnimationFrame(loopId);
  loopId = 0;
}

function tick(now) {
  loopId = requestAnimationFrame(tick);
  // Auf langsamen Geräten seltener erkennen, damit Bild und Bedienung flüssig bleiben.
  if (camera.ready && !capturing && now - lastDetect >= Math.max(DETECT_INTERVAL, detectCost * 2.5)) {
    lastDetect = now;
    let found = null;
    try {
      const t0 = performance.now();
      found = detectQuad(cv, video, camera.width, camera.height, { prev: tracker.quad, thorough: true });
      detectCost = detectCost * 0.8 + (performance.now() - t0) * 0.2;
    } catch (err) {
      console.error(err);
    }
    tracker.update(found?.quad ?? null, now, Math.hypot(camera.width, camera.height));
    if (state.auto && tracker.progress(now) >= 1) capture();
  }
  drawOverlay(now);
}

function drawOverlay(now) {
  const box = overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(box.width * dpr), ch = Math.round(box.height * dpr);
  if (overlay.width !== cw || overlay.height !== ch) {
    overlay.width = cw;
    overlay.height = ch;
  }
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayCtx.clearRect(0, 0, box.width, box.height);

  const progress = state.auto ? tracker.progress(now) : 0;
  $('btn-shutter').style.setProperty('--p', progress.toFixed(3));
  updateHint();

  const q = tracker.quad;
  if (!q || !camera.ready) return;
  // Das Video wird mit object-fit: contain dargestellt – gleiche Abbildung für die Markierung.
  const s = Math.min(box.width / camera.width, box.height / camera.height);
  const ox = (box.width - camera.width * s) / 2, oy = (box.height - camera.height * s) / 2;
  overlayCtx.beginPath();
  q.forEach((p, i) => {
    const x = ox + p.x * s, y = oy + p.y * s;
    if (i) overlayCtx.lineTo(x, y);
    else overlayCtx.moveTo(x, y);
  });
  overlayCtx.closePath();
  overlayCtx.fillStyle = `rgba(52, 211, 153, ${0.12 + 0.2 * progress})`;
  overlayCtx.fill();
  overlayCtx.lineWidth = 3;
  overlayCtx.lineJoin = 'round';
  overlayCtx.strokeStyle = '#34d399';
  overlayCtx.stroke();
}

function updateHint() {
  let text;
  if (capturing) text = 'Seite wird verarbeitet …';
  else if (tracker.captured) text = 'Erfasst ✓ – nächste Seite hinlegen';
  else if (!tracker.quad) text = 'Dokument ins Bild halten';
  else if (state.auto) text = 'Ruhig halten …';
  else text = 'Auslöser drücken';
  if ($('hint').textContent !== text) $('hint').textContent = text;
}

function updateAutoButton() {
  const b = $('btn-auto');
  b.classList.toggle('is-on', state.auto);
  b.setAttribute('aria-pressed', String(state.auto));
  b.textContent = state.auto ? 'Auto' : 'Manuell';
}

async function capture() {
  if (capturing || !camera.ready) return;
  capturing = true;
  tracker.markCaptured();
  flash();
  const hint = tracker.quad;
  const frame = camera.grab();
  $('btn-pages').classList.add('is-busy');
  try {
    await nextPaint(); // Blitz zuerst zeigen, dann rechnen
    await addPage(frame, hint);
  } catch (err) {
    console.error(err);
    toast('Aufnahme fehlgeschlagen: ' + err.message);
  } finally {
    capturing = false;
    $('btn-pages').classList.remove('is-busy');
  }
}

function flash() {
  const f = $('flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

// ---------- Seiten ----------

/** Erkennt das Dokument im Foto, schneidet es zu und fügt es als Seite an. */
async function addPage(canvas, hint) {
  let quad = findDocument(cv, canvas, hint);
  if (!quad) {
    hideBusy();
    toast('Kein Dokument erkannt – bitte die Ecken setzen.');
    quad = await openEditor({
      image: canvas,
      quad: defaultQuad(canvas.width, canvas.height),
      onAuto: (corners) => autoDetect(canvas, corners),
    });
    if (!quad) {
      releaseCanvas(canvas);
      return null;
    }
  }
  const page = { id: nextId++, quad, rotation: 0, source: null, signature: null, result: null };
  page.source = await canvasToBlob(canvas, 'image/jpeg', SOURCE_QUALITY);
  await renderInto(page, canvas);
  releaseCanvas(canvas);
  state.pages.push(page);
  updateCameraBar();
  return page;
}

/** „Automatisch“ im Editor: Blatt nahe den aktuellen Ecken suchen oder die Ecken an die Kanten anlegen. */
function autoDetect(canvas, corners) {
  const q = autoCorners(cv, canvas, corners);
  if (!q) toast('Keine Blattkante gefunden – bitte die Ecken von Hand setzen.');
  return q;
}

async function renderInto(page, sourceCanvas = null) {
  const canvas = sourceCanvas ?? (await loadImageCanvas(page.source));
  try {
    const overlays = page.signature ? [page.signature] : [];
    const result = await renderPage(cv, canvas, page.quad, state.filter, page.rotation, overlays);
    if (page.result) URL.revokeObjectURL(page.result.url);
    page.result = { ...result, url: URL.createObjectURL(result.blob) };
  } finally {
    if (!sourceCanvas) releaseCanvas(canvas);
  }
}

async function editPage(page) {
  await busy('Bild wird geladen …');
  const canvas = await loadImageCanvas(page.source);
  hideBusy();
  try {
    const quad = await openEditor({ image: canvas, quad: page.quad, onAuto: (corners) => autoDetect(canvas, corners) });
    if (!quad) return;
    page.quad = quad;
    await busy('Seite wird neu berechnet …');
    await renderInto(page, canvas);
  } finally {
    hideBusy();
    releaseCanvas(canvas);
  }
  renderReview();
  updateCameraBar();
}

function updateCameraBar() {
  const n = state.pages.length;
  $('page-count').textContent = String(n);
  $('page-count').hidden = n === 0;
  $('btn-pages').disabled = n === 0;
  $('btn-done').disabled = n === 0;
  const last = state.pages[n - 1];
  if (last) $('last-thumb').src = last.result.url;
  else $('last-thumb').removeAttribute('src');
}

function renderReview() {
  const n = state.pages.length;
  $('review-title').textContent = n === 1 ? '1 Seite' : `${n} Seiten`;
  $('btn-make-pdf').disabled = n === 0;
  if (!$('file-name').value) $('file-name').value = defaultName();
  for (const b of document.querySelectorAll('[data-filter]')) {
    b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter));
  }
  const grid = $('pages-grid');
  if (!n) {
    grid.innerHTML = '<p class="empty-note">Noch keine Seiten. Tippe auf „‹ Kamera“, um ein Dokument zu scannen.</p>';
    return;
  }
  grid.replaceChildren(...state.pages.map((p, i) => pageCard(p, i, n)));
}

function pageCard(page, i, n) {
  const fig = document.createElement('figure');
  fig.className = 'page-card';
  fig.dataset.id = String(page.id);
  fig.innerHTML = `
    <div class="page-top">
      <button class="page-thumb" data-act="crop" aria-label="Seite ${i + 1} zuschneiden"><img alt="" src="${page.result.url}"></button>
      <span class="page-no">${i + 1}</span>
      <button class="page-move left" data-act="left" aria-label="Nach vorne" ${i === 0 ? 'disabled' : ''}>${ICONS.left}</button>
      <button class="page-move right" data-act="right" aria-label="Nach hinten" ${i === n - 1 ? 'disabled' : ''}>${ICONS.right}</button>
    </div>
    <div class="page-actions">
      <button data-act="crop" aria-label="Zuschneiden">${ICONS.crop}</button>
      <button data-act="sign" aria-label="Unterschreiben">${ICONS.sign}</button>
      <button data-act="rotate" aria-label="Drehen">${ICONS.rotate}</button>
      <button data-act="delete" aria-label="Löschen">${ICONS.delete}</button>
    </div>`;
  return fig;
}

// ---------- Unterschrift ----------

/**
 * Verwaltung der gespeicherten Unterschrift (hochladen, zeichnen, Farbe, löschen).
 * Mit `forSigning` schließt sie, sobald eine Unterschrift vorliegt. Liefert die aktuelle Unterschrift.
 */
function manageSignature(forSigning = false) {
  const sheet = $('signature-sheet');
  return new Promise((resolve) => {
    const refresh = () => {
      const has = !!state.signature;
      $('sig-preview-img').hidden = !has;
      $('sig-empty').hidden = has;
      if (has) $('sig-preview-img').src = state.signature.toDataURL('image/png');
      $('sig-delete').hidden = !has;
      for (const b of sheet.querySelectorAll('[data-ink]')) b.setAttribute('aria-pressed', String(b.dataset.ink === state.ink));
    };
    const close = () => {
      sheet.hidden = true;
      resolve(state.signature);
    };
    const adopt = (canvas) => {
      if (canvas) {
        state.signature = canvas;
        if (!saveSignature(canvas)) toast('Die Unterschrift konnte nicht dauerhaft gespeichert werden.');
        refresh();
        if (forSigning) return close();
      }
      sheet.hidden = false;
    };

    $('sig-file').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      sheet.hidden = true;
      adopt(await signatureFromPhoto(file));
    };
    $('sig-draw').onclick = async () => {
      sheet.hidden = true;
      adopt(await openSignaturePad(INKS[state.ink]));
    };
    $('sig-delete').onclick = () => {
      if (!confirm('Gespeicherte Unterschrift löschen?')) return;
      deleteSignature();
      state.signature = null;
      refresh();
    };
    for (const b of sheet.querySelectorAll('[data-ink]')) {
      b.onclick = () => {
        state.ink = b.dataset.ink;
        writePref('ink', state.ink);
        if (state.signature) {
          state.signature = recolor(state.signature, INKS[state.ink]);
          saveSignature(state.signature);
        }
        refresh();
      };
    }
    $('sig-close').onclick = close;

    refresh();
    sheet.hidden = false;
  });
}

/** Foto → Bereich wählen → Unterschrift freistellen. */
async function signatureFromPhoto(file) {
  await busy('Foto wird geladen …');
  let canvas;
  try {
    canvas = await loadImageCanvas(file);
  } catch {
    hideBusy();
    toast('Das Foto konnte nicht gelesen werden.');
    return null;
  }
  hideBusy();
  try {
    const quad = await openEditor({ image: canvas, quad: defaultQuad(canvas.width, canvas.height, 0.05), title: 'Unterschrift auswählen' });
    if (!quad) return null;
    await busy('Unterschrift wird freigestellt …');
    const flat = warpToCanvas(cv, canvas, quad);
    const signature = extractSignature(cv, flat, INKS[state.ink]);
    releaseCanvas(flat);
    if (!signature) toast('Keine Unterschrift erkannt – wähle den Bereich enger oder nutze ein helleres Foto.');
    return signature;
  } finally {
    hideBusy();
    releaseCanvas(canvas);
  }
}

/** Unterschrift auf einer Seite platzieren, verschieben oder entfernen. */
async function signPage(page) {
  const existing = page.signature;
  const signature = existing?.image ?? state.signature ?? (await manageSignature(true));
  if (!signature) return;

  // Seitenbild ohne Unterschrift als Hintergrund für den Editor
  await busy('Seite wird vorbereitet …');
  let plain;
  try {
    const source = await loadImageCanvas(page.source);
    plain = await renderPage(cv, source, page.quad, state.filter, page.rotation);
    releaseCanvas(source);
  } finally {
    hideBusy();
  }
  const { width, height } = plain;
  const url = URL.createObjectURL(plain.blob);
  const start = existing ? toViewFrame(existing, page.rotation, width, height) : { u: 0.7, v: 0.85, fw: 0.32 };
  const result = await openPlacement({ pageUrl: url, signature, placement: start, canRemove: !!existing });
  URL.revokeObjectURL(url);
  if (!result) return;

  page.signature = result === 'remove' ? null : { image: signature, ...toPageFrame(result, page.rotation, width, height) };
  await busy('Unterschrift wird eingefügt …');
  try {
    await renderInto(page);
  } finally {
    hideBusy();
  }
  renderReview();
  updateCameraBar();
}

async function onPageAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const id = Number(btn.closest('.page-card').dataset.id);
  const index = state.pages.findIndex((p) => p.id === id);
  const page = state.pages[index];
  const act = btn.dataset.act;

  if (act === 'left' || act === 'right') {
    const j = index + (act === 'left' ? -1 : 1);
    [state.pages[index], state.pages[j]] = [state.pages[j], state.pages[index]];
    renderReview();
  } else if (act === 'rotate') {
    page.rotation = (page.rotation + 90) % 360;
    await busy('Seite wird gedreht …');
    try {
      await renderInto(page);
    } finally {
      hideBusy();
    }
    renderReview();
    updateCameraBar();
  } else if (act === 'delete') {
    if (!confirm(`Seite ${index + 1} löschen?`)) return;
    URL.revokeObjectURL(page.result.url);
    state.pages.splice(index, 1);
    renderReview();
    updateCameraBar();
  } else if (act === 'crop') {
    await editPage(page);
  } else if (act === 'sign') {
    await signPage(page);
  }
}

async function onFilter(e) {
  const filter = e.target.closest('[data-filter]')?.dataset.filter;
  if (!filter || filter === state.filter) return;
  state.filter = filter;
  writePref('filter', filter);
  renderReview();
  try {
    for (const [i, page] of state.pages.entries()) {
      await busy(`Filter wird angewendet (${i + 1}/${state.pages.length}) …`);
      await renderInto(page);
    }
  } finally {
    hideBusy();
  }
  renderReview();
  updateCameraBar();
}

/** Fotos übernehmen. Mit `stay` bleibt die Kamera-Ansicht offen (nächste Seite fotografieren). */
async function onImport(e, { stay = false } = {}) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  stopLoop();
  let added = 0;
  for (const [i, file] of files.entries()) {
    await busy(files.length > 1 ? `Foto ${i + 1} von ${files.length} wird verarbeitet …` : 'Foto wird verarbeitet …');
    try {
      const canvas = await loadImageCanvas(file);
      if (await addPage(canvas, null)) added++;
    } catch (err) {
      console.error(err);
      toast(`„${file.name}“ konnte nicht gelesen werden.`);
    }
  }
  hideBusy();
  if (added && stay) toast(`Seite ${state.pages.length} hinzugefügt`);
  if (added && !stay) showView('review');
  else if (state.view === 'camera' && state.liveCamera) startLoop();
}

// ---------- PDF ----------

function defaultName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function fileName() {
  const clean = $('file-name').value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '').trim();
  return clean || defaultName();
}

function formatSize(bytes) {
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1).replace('.', ',')} MB`;
}

async function makePdf() {
  if (!state.pages.length) return;
  const name = fileName();
  await busy('PDF wird erstellt …');
  try {
    const blob = await buildPdf(state.pages.map((p) => p.result), name);
    pdfFile = new File([blob], name + '.pdf', { type: 'application/pdf' });
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(pdfFile);
    const n = state.pages.length;
    $('export-info').textContent = `${pdfFile.name} · ${n === 1 ? '1 Seite' : n + ' Seiten'} · ${formatSize(blob.size)}`;
    $('btn-download').href = pdfUrl;
    $('btn-download').download = pdfFile.name;
    $('btn-share').hidden = !canShareFile(pdfFile);
    $('export-sheet').hidden = false;
  } catch (err) {
    console.error(err);
    toast('PDF konnte nicht erstellt werden: ' + err.message);
  } finally {
    hideBusy();
  }
}

async function onShare() {
  try {
    await shareFile(pdfFile);
  } catch (err) {
    toast('Teilen nicht möglich – nutze „Herunterladen“.');
  }
}

function startNewScan() {
  for (const p of state.pages) URL.revokeObjectURL(p.result.url);
  state.pages = [];
  $('file-name').value = '';
  $('export-sheet').hidden = true;
  tracker.reset();
  updateCameraBar();
  showView('camera');
}

// ---------- Rückmeldungen ----------

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Zeigt die Warteanzeige und wartet, bis sie wirklich gezeichnet ist (danach blockiert die Rechnung). */
async function busy(text) {
  $('busy-text').textContent = text;
  $('busy').hidden = false;
  await nextPaint();
}

function hideBusy() {
  $('busy').hidden = true;
}

function toast(text, ms = 3200) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Start ----------

function bindEvents() {
  $('btn-shutter').addEventListener('click', () => capture());
  $('btn-auto').addEventListener('click', () => {
    state.auto = !state.auto;
    writePref('auto', state.auto);
    updateAutoButton();
  });
  $('btn-pages').addEventListener('click', () => showView('review'));
  $('btn-done').addEventListener('click', () => showView('review'));
  $('btn-retry').addEventListener('click', () => startCamera());
  $('file-input').addEventListener('change', onImport);
  $('photo-input').addEventListener('change', (e) => onImport(e, { stay: true }));
  $('btn-live-off').addEventListener('click', () => setLiveCamera(false));
  $('btn-live-on').addEventListener('click', () => setLiveCamera(true));
  $('btn-error-system').addEventListener('click', () => setLiveCamera(false));
  $('btn-back').addEventListener('click', () => showView('camera'));
  $('pages-grid').addEventListener('click', onPageAction);
  document.querySelector('.filter-bar').addEventListener('click', onFilter);
  $('btn-make-pdf').addEventListener('click', makePdf);
  $('btn-share').addEventListener('click', onShare);
  $('btn-new').addEventListener('click', () => {
    if (confirm('Alle Seiten verwerfen und neu beginnen?')) startNewScan();
  });
  $('btn-sheet-close').addEventListener('click', () => { $('export-sheet').hidden = true; });
  $('btn-signature').addEventListener('click', () => manageSignature());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
      camera.pause();
    } else if (state.view === 'camera' && state.liveCamera) {
      startCamera();
    }
  });
}

async function init() {
  bindEvents();
  updateAutoButton();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  loadSignature().then((s) => { state.signature = s; });
  try {
    cv = await loadCv();
  } catch (err) {
    console.error(err);
    $('loading-text').textContent = 'Die Bilderkennung konnte nicht geladen werden. Bitte Internetverbindung prüfen und die App neu öffnen.';
    document.querySelector('#view-loading .spinner').hidden = true;
    return;
  }
  showView('camera');
}

init();
