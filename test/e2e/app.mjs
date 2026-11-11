// Gesamttest der App mit simulierter Kamera: Live-Erkennung, automatische Aufnahme,
// Editor, Filter, Drehen, Sortieren, PDF-Export und Foto-Import.
// Aufruf: node test/e2e/app.mjs   (oder npm run test:app)

import { runTest, BASE, CAMERA_STUB, sleep } from './lib.mjs';

const cardImgSize = (i) => `(() => { const im = document.querySelectorAll('.page-card img')[${i}]; return [im.naturalWidth, im.naturalHeight]; })()`;

await runTest('app', async (s) => {
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s.send('Page.addScriptToEvaluateOnNewDocument', { source: CAMERA_STUB });
  await s.send('Page.navigate', { url: BASE });

  await s.waitFor(`document.getElementById('view-camera').classList.contains('is-active')`, 30000, 'Kamera-Ansicht');
  s.check(true, 'OpenCV geladen, Kamera-Ansicht aktiv');

  // Manueller Modus: Blatt wird erkannt, aber nicht ausgelöst
  await s.click('#btn-auto');
  await s.waitFor(`document.getElementById('hint').textContent.includes('Auslöser')`, 15000, 'Erkennung im manuellen Modus');
  await sleep(500);
  await s.screenshot('kamera-erkannt');
  s.check(true, `Live-Erkennung zeigt das Blatt (Hinweis „${await s.text('#hint')}“)`);

  // Automatik an → automatische Aufnahme
  await s.click('#btn-auto');
  await s.waitFor(`document.getElementById('page-count').textContent === '1'`, 15000, 'automatische Aufnahme 1');
  s.check(true, 'Automatische Aufnahme: Seite 1');
  await sleep(2500);
  s.check((await s.text('#page-count')) === '1', 'Keine Doppelaufnahme, solange dasselbe Blatt liegt');

  // Blattwechsel: kurz weg, dann gedreht an anderer Stelle
  await s.evaluate(`window.__cam.hide = true, true`);
  await sleep(1200);
  await s.evaluate(`window.__cam.quad = [[330,250],[1000,470],[700,1640],[60,1420]], window.__cam.hide = false, true`);
  await s.waitFor(`document.getElementById('page-count').textContent === '2'`, 15000, 'automatische Aufnahme 2');
  s.check(true, 'Automatische Aufnahme: Seite 2 (gedrehtes Blatt)');

  // Manuelle Aufnahme ohne Blatt → Ecken-Editor; Abbrechen fügt nichts hinzu
  await s.evaluate(`document.getElementById('btn-auto').click(), window.__cam.empty = true, true`);
  await sleep(800);
  await s.click('#btn-shutter');
  await s.waitFor(`!document.getElementById('editor').hidden`, 10000, 'Editor bei leerem Bild');
  await s.screenshot('editor-ohne-dokument');
  await s.click('#ed-cancel');
  await sleep(300);
  s.check((await s.text('#page-count')) === '2', 'Ohne Blatt öffnet der Editor; Abbrechen fügt keine Seite hinzu');
  await s.evaluate(`window.__cam.empty = false, true`);

  // Übersicht
  await s.click('#btn-done');
  await s.waitFor(`document.getElementById('view-review').classList.contains('is-active') && document.querySelectorAll('.page-card img').length === 2`, 10000, 'Übersicht');
  await sleep(600);
  await s.screenshot('uebersicht');
  s.check((await s.text('#review-title')) === '2 Seiten', 'Übersicht zeigt 2 Seiten');
  s.check(await s.evaluate(`!document.getElementById('video').srcObject`), 'Kamera ist in der Übersicht ausgeschaltet');

  // Filter S/W und zurück
  await s.click('[data-filter="bw"]');
  await sleep(200);
  await s.waitFor(`document.getElementById('busy').hidden`, 20000, 'Filter S/W');
  await sleep(400);
  await s.screenshot('uebersicht-sw');
  s.check(await s.evaluate(`document.querySelector('[data-filter="bw"]').getAttribute('aria-pressed') === 'true'`), 'Filter S/W angewendet');
  await s.click('[data-filter="enhanced"]');
  await sleep(200);
  await s.waitFor(`document.getElementById('busy').hidden`, 20000, 'Filter Verbessert');

  // Drehen und nach vorne schieben
  const before = await s.evaluate(cardImgSize(1));
  await s.evaluate(`document.querySelectorAll('.page-card')[1].querySelector('[data-act=rotate]').click(), true`);
  await sleep(200);
  await s.waitFor(`document.getElementById('busy').hidden`, 20000, 'Drehen');
  await sleep(400);
  const after = await s.evaluate(cardImgSize(1));
  s.check(before[0] === after[1] && before[1] === after[0], `Drehen tauscht Breite und Höhe (${before} → ${after})`);
  await s.evaluate(`document.querySelectorAll('.page-card')[1].querySelector('[data-act=left]').click(), true`);
  await sleep(300);
  const first = await s.evaluate(cardImgSize(0));
  s.check(first[0] > first[1], 'Nach vorne schieben: gedrehte Seite steht jetzt an erster Stelle');
  for (let k = 0; k < 3; k++) {
    await s.evaluate(`document.querySelectorAll('.page-card')[0].querySelector('[data-act=rotate]').click(), true`);
    await sleep(200);
    await s.waitFor(`document.getElementById('busy').hidden`, 20000, 'Zurückdrehen');
  }

  // Ecken-Editor: Griff oben links ziehen (Lupe), „Automatisch“, „Fertig“
  await s.evaluate(`document.querySelectorAll('.page-card')[0].querySelector('.page-thumb').click(), true`);
  await s.waitFor(`!document.getElementById('editor').hidden`, 10000, 'Editor');
  await sleep(500);
  const canvasBox = await s.box('#ed-canvas');
  const handle = await s.evaluate(`(() => {
    const c = document.getElementById('ed-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const dpr = c.width / c.getBoundingClientRect().width; let best = null;
    for (let y = 0; y < c.height / 2; y += 2) for (let x = 0; x < c.width / 2; x += 2) {
      const i = (y * c.width + x) * 4;
      if (Math.abs(d[i] - 52) < 30 && Math.abs(d[i + 1] - 211) < 30 && Math.abs(d[i + 2] - 153) < 30) { const s = x + y; if (!best || s < best.s) best = { s, x: x / dpr, y: y / dpr }; }
    }
    return best;
  })()`);
  s.check(!!handle, 'Editor zeigt grüne Eckgriffe');
  if (handle) {
    const x0 = canvasBox.x + handle.x + 6, y0 = canvasBox.y + handle.y + 6;
    await s.mouse('mousePressed', x0, y0);
    for (let k = 1; k <= 8; k++) await s.mouse('mouseMoved', x0 + k * 4, y0 + k * 3);
    await sleep(100);
    await s.screenshot('editor-lupe');
    await s.mouse('mouseReleased', x0 + 32, y0 + 24);
  }
  await s.click('#ed-auto');
  await sleep(300);
  await s.click('#ed-done');
  await s.waitFor(`document.getElementById('editor').hidden && document.getElementById('busy').hidden`, 20000, 'Editor geschlossen');
  s.check(true, 'Editor: Ecke ziehen, „Automatisch“ und „Fertig“ funktionieren');

  // PDF
  await s.evaluate(`document.getElementById('file-name').value = 'Testscan Rechnung', true`);
  await s.click('#btn-make-pdf');
  await s.waitFor(`!document.getElementById('export-sheet').hidden`, 20000, 'PDF');
  await sleep(300);
  await s.screenshot('export');
  const info = await s.text('#export-info');
  s.check(info.startsWith('Testscan Rechnung.pdf · 2 Seiten'), `Export-Hinweis: ${info}`);
  const pdfB64 = await s.evaluate(`(async () => { const b = await (await fetch(document.getElementById('btn-download').href)).arrayBuffer(); let t = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i++) t += String.fromCharCode(u[i]); return btoa(t); })()`);
  const pdf = Buffer.from(pdfB64, 'base64');
  const pages = (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
  s.check(pdf.subarray(0, 5).toString() === '%PDF-' && pages === 2, `PDF ist gültig und hat ${pages} Seiten`);
  await s.click('#btn-sheet-close');

  // Foto-Import (12-MP-Foto, schräges Blatt auf blauem Tisch)
  const photo = await s.makeJpeg('import-foto.jpg', 3024, 4032, `(x, c) => {
    x.fillStyle = '#2d5a9e'; x.fillRect(0, 0, c.width, c.height);
    x.save(); x.translate(1512, 2016); x.rotate(-0.12); x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = 60;
    x.fillStyle = '#f8f8f8'; x.fillRect(-1050, -1485, 2100, 2970); x.shadowBlur = 0; x.fillStyle = '#222';
    for (let r = 0; r < 40; r++) x.fillRect(-900, -1300 + r * 64, r % 7 === 6 ? 900 : 1800, 22);
    x.restore();
  }`);
  await s.click('#btn-back');
  await s.waitFor(`document.getElementById('view-camera').classList.contains('is-active')`, 5000, 'Kamera-Ansicht');
  await s.setFiles('#file-input', photo);
  await s.waitFor(`document.getElementById('view-review').classList.contains('is-active') && document.querySelectorAll('.page-card').length === 3`, 30000, 'Import');
  await sleep(500);
  await s.screenshot('uebersicht-mit-import');
  s.check((await s.text('#review-title')) === '3 Seiten', 'Foto-Import: Blatt erkannt und als Seite 3 übernommen');

  s.note(`Kamerazugriffe insgesamt: ${await s.evaluate('window.__gum || 0')}`);
});
