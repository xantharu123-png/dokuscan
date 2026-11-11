// Führt den Erkennungstest (test/detection.html, 12 künstliche Szenen) im unsichtbaren Chrome aus.
// Aufruf: node test/e2e/detection.mjs   (oder npm run test:detection)

import { runTest, BASE } from './lib.mjs';

await runTest('detection', async (s) => {
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1900, deviceScaleFactor: 1, mobile: false });
  await s.send('Page.navigate', { url: BASE + 'test/detection.html' });
  await s.waitFor(`Array.isArray(window.testSummary)`, 120000, 'Erkennungstest');
  const rows = await s.evaluate(`window.testSummary`);
  for (const r of rows) {
    const detail = r.refined === null ? 'nichts gefunden' : `Abweichung ${r.refined.toFixed(1)} px, Rand ${r.margin.toFixed(2)} px innen`;
    s.check(r.ok, `${r.name}: ${detail} (live ${r.tLive} ms, Foto ${r.tPhoto} ms)`);
    for (const t of r.top ?? []) s.note(t);
  }
  await s.screenshot('erkennung');
});
