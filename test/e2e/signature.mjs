// Test der Unterschrift-Funktion mit simulierter Kamera: zeichnen, Farbe wechseln, Foto hochladen
// und freistellen, auf einer Seite platzieren, verschieben, Größe ändern, mitdrehen, entfernen,
// Filterwechsel, PDF, dauerhaft gespeichert nach Neuladen.
// Aufruf: node test/e2e/signature.mjs   (oder npm run test:signature)

import { runTest, BASE, CAMERA_STUB, sleep } from './lib.mjs';

/** Zählt blaue Tintenpixel im Bild der ersten Seitenkarte (optional nur in einem Bereich, Anteile 0..1). */
const inkIn = (area = [0, 0, 1, 1]) => `(async () => {
  const img = document.querySelector('.page-card img'); await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const [a, b, w, h] = ${JSON.stringify(area)};
  const d = x.getImageData(Math.round(a * c.width), Math.round(b * c.height), Math.round(w * c.width), Math.round(h * c.height)).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 50 && d[i + 2] > 90) n++;
  return n;
})()`;
const placementOpen = `!document.getElementById('sig-place').hidden && document.getElementById('sp-box').getBoundingClientRect().width > 0`;
const placementClosed = `document.getElementById('sig-place').hidden && document.getElementById('busy').hidden`;

await runTest('signature', async (s) => {
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s.send('Page.addScriptToEvaluateOnNewDocument', { source: CAMERA_STUB });
  await s.send('Page.navigate', { url: BASE });
  await s.waitFor(`document.getElementById('view-camera').classList.contains('is-active')`, 30000, 'Kamera-Ansicht');
  await s.waitFor(`document.getElementById('page-count').textContent === '1'`, 15000, 'automatische Aufnahme');
  await s.click('#btn-done');
  await s.waitFor(`document.querySelectorAll('.page-card img').length === 1`, 10000, 'Übersicht');
  await sleep(400);
  s.check((await s.evaluate(inkIn())) === 0, 'Gescannte Seite enthält noch keine blaue Tinte');

  // 1. Mit dem Finger zeichnen
  await s.click('#btn-signature');
  await s.waitFor(`!document.getElementById('signature-sheet').hidden`, 5000, 'Unterschrift-Verwaltung');
  await sleep(200);
  await s.screenshot('verwaltung-leer');
  s.check(await s.evaluate(`!document.getElementById('sig-empty').hidden`), 'Ohne gespeicherte Unterschrift: Hinweis „Noch keine Unterschrift“');
  await s.click('#sig-draw');
  await s.waitFor(`!document.getElementById('sig-pad').hidden`, 5000, 'Zeichenfeld');
  await sleep(300);
  const pad = await s.box('#pad-canvas');
  const cx = pad.x + pad.w * 0.2, cy = pad.y + pad.h * 0.6;
  await s.mouse('mousePressed', cx, cy);
  for (let k = 0; k <= 60; k++) {
    const t = k / 60;
    await s.mouse('mouseMoved', cx + t * pad.w * 0.6, cy - Math.sin(t * Math.PI * 5) * pad.h * 0.15 - t * 20);
  }
  await s.mouse('mouseReleased', cx + pad.w * 0.6, cy - 20);
  await s.drag(cx + pad.w * 0.1, cy + 25, cx + pad.w * 0.55, cy + 15, 12);
  await s.screenshot('zeichenfeld');
  await s.click('#pad-done');
  await s.waitFor(`!document.getElementById('signature-sheet').hidden && !document.getElementById('sig-preview-img').hidden`, 5000, 'Vorschau');
  await sleep(200);
  await s.screenshot('unterschrift-gezeichnet');
  const stored = await s.evaluate(`(localStorage.getItem('dokuscan.signature') || '').length`);
  s.check(stored > 1000, `Gezeichnete Unterschrift dauerhaft gespeichert (${stored} Zeichen in localStorage)`);

  // 2. Farbe wechseln
  await s.click('[data-ink="schwarz"]');
  await sleep(200);
  const colors = await s.evaluate(`(async () => { const i = document.getElementById('sig-preview-img'); await i.decode(); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let blue = 0, dark = 0; for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 128) { if (d[k + 2] > d[k] + 50) blue++; else dark++; } return { blue, dark }; })()`);
  s.check(colors.blue === 0 && colors.dark > 1000, `Farbe Schwarz: ${colors.blue} blaue, ${colors.dark} schwarze Pixel`);
  await s.click('[data-ink="blau"]');
  await sleep(200);

  // 3. Foto hochladen: blaue Unterschrift auf ungleichmäßig beleuchtetem Papier mit Staubpunkten
  const photo = await s.makeJpeg('unterschrift-foto.jpg', 2400, 1600, `(x) => {
    const g = x.createLinearGradient(0, 0, 2400, 1600); g.addColorStop(0, '#f2f0ea'); g.addColorStop(1, '#c9c6bf');
    x.fillStyle = g; x.fillRect(0, 0, 2400, 1600);
    x.strokeStyle = '#2b3f86'; x.lineWidth = 9; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(700, 900);
    for (let t = 0; t <= 1; t += 0.01) x.lineTo(700 + t * 1000, 900 - Math.sin(t * Math.PI * 6) * 120 * (1 - t * 0.5) - t * 80);
    x.stroke();
    x.beginPath(); x.moveTo(760, 1010); x.bezierCurveTo(1100, 960, 1400, 1040, 1700, 980); x.stroke();
    for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(80,80,80,.5)'; x.fillRect((i * 557) % 2400, (i * 331) % 1600, 3, 3); }
  }`);
  await s.setFiles('#sig-file', photo);
  await s.waitFor(`!document.getElementById('editor').hidden`, 10000, 'Bereichsauswahl');
  await sleep(400);
  s.check((await s.text('#ed-title')) === 'Unterschrift auswählen' && (await s.evaluate(`document.getElementById('ed-auto').hidden`)),
    'Bereichsauswahl mit eigenem Titel, ohne „Automatisch“');
  await s.screenshot('bereich-waehlen');
  await s.click('#ed-done');
  await s.waitFor(`!document.getElementById('signature-sheet').hidden && document.getElementById('busy').hidden`, 15000, 'Freistellen');
  await sleep(300);
  await s.screenshot('unterschrift-hochgeladen');
  const [sw, sh] = await s.evaluate(`(async () => { const i = document.getElementById('sig-preview-img'); await i.decode(); return [i.naturalWidth, i.naturalHeight]; })()`);
  s.check(sw > 900 && sw < 1200 && sh < 500, `Foto freigestellt und eng zugeschnitten: ${sw}×${sh} px (Foto 2400×1600, Schriftzug ~1000 px breit)`);
  await s.click('#sig-close');

  // 4. Platzieren, verschieben, Größe ändern
  await s.evaluate(`document.querySelector('.page-card [data-act=sign]').click(), true`);
  await s.waitFor(placementOpen, 15000, 'Platzieren');
  await sleep(300);
  await s.screenshot('platzieren');
  const b1 = await s.box('#sp-box');
  await s.drag(b1.x + b1.w / 2, b1.y + b1.h / 2, b1.x + b1.w / 2 - 120, b1.y + b1.h / 2 - 40);
  const b2 = await s.box('#sp-box');
  const handle = await s.box('.sig-handle');
  await s.drag(handle.x + handle.w / 2, handle.y + handle.h / 2, handle.x + handle.w / 2 + 40, handle.y + handle.h / 2 + 10);
  const b3 = await s.box('#sp-box');
  s.check(b2.x < b1.x - 100 && b3.w > b2.w + 40, `Verschieben (x ${b1.x.toFixed(0)} → ${b2.x.toFixed(0)}) und Größe ändern (Breite ${b2.w.toFixed(0)} → ${b3.w.toFixed(0)})`);
  await s.screenshot('platzieren-verschoben');
  await s.click('#sp-done');
  await s.waitFor(placementClosed, 15000, 'Einfügen');
  await sleep(500);
  await s.screenshot('seite-unterschrieben');
  const total = await s.evaluate(inkIn()), lower = await s.evaluate(inkIn([0, 0.5, 1, 0.5]));
  s.check(total > 1000 && lower === total, `Unterschrift eingefügt (${total} blaue Pixel, alle in der unteren Hälfte)`);

  // 5. Seite drehen → Unterschrift dreht mit (unten wird links)
  await s.evaluate(`document.querySelector('.page-card [data-act=rotate]').click(), true`);
  await sleep(200);
  await s.waitFor(`document.getElementById('busy').hidden`, 15000, 'Drehen');
  await sleep(400);
  const rotTotal = await s.evaluate(inkIn()), left = await s.evaluate(inkIn([0, 0, 0.5, 1]));
  s.check(rotTotal > 1000 && left === rotTotal, `Nach Drehung um 90° liegt die Unterschrift links (${left}/${rotTotal})`);
  await s.screenshot('seite-gedreht');

  // 6. Entfernen und erneut einfügen
  await s.evaluate(`document.querySelector('.page-card [data-act=sign]').click(), true`);
  await s.waitFor(placementOpen, 15000, 'Platzieren 2');
  await sleep(300);
  s.check(await s.evaluate(`!document.getElementById('sp-remove').hidden`), 'Bei vorhandener Unterschrift gibt es „Entfernen“');
  await s.click('#sp-remove');
  await s.waitFor(placementClosed, 15000, 'Entfernen');
  await sleep(400);
  s.check((await s.evaluate(inkIn())) === 0, 'Nach „Entfernen“ ist keine Tinte mehr auf der Seite');
  await s.evaluate(`document.querySelector('.page-card [data-act=sign]').click(), true`);
  await s.waitFor(placementOpen, 15000, 'Platzieren 3');
  await s.click('#sp-done');
  await s.waitFor(placementClosed, 15000, 'Wieder einfügen');
  await sleep(400);
  s.check((await s.evaluate(inkIn())) > 1000, 'Wieder eingefügt');

  // 7. Filter wechseln → Unterschrift bleibt (farbig)
  await s.click('[data-filter="bw"]');
  await sleep(200);
  await s.waitFor(`document.getElementById('busy').hidden`, 20000, 'Filter');
  await sleep(400);
  s.check((await s.evaluate(inkIn())) > 1000, 'Bei Filter S/W bleibt die blaue Unterschrift erhalten');
  await s.screenshot('seite-sw');

  // 8. PDF
  await s.click('#btn-make-pdf');
  await s.waitFor(`!document.getElementById('export-sheet').hidden`, 20000, 'PDF');
  s.check((await s.text('#export-info')).includes('1 Seite'), 'PDF mit unterschriebener Seite erstellt');
  await s.click('#btn-sheet-close');

  // 9. Neu laden: Unterschrift bleibt gespeichert
  await s.send('Page.reload');
  await s.waitFor(`document.getElementById('view-camera').classList.contains('is-active')`, 30000, 'Neuladen');
  await s.waitFor(`document.getElementById('page-count').textContent === '1'`, 15000, 'Aufnahme nach Neuladen');
  await s.click('#btn-done');
  await sleep(300);
  await s.click('#btn-signature');
  await s.waitFor(`!document.getElementById('signature-sheet').hidden`, 5000, 'Verwaltung nach Neuladen');
  await sleep(300);
  s.check(await s.evaluate(`!document.getElementById('sig-preview-img').hidden`), 'Nach dem Neuladen ist die Unterschrift noch gespeichert');
  await s.screenshot('nach-neuladen');
});
