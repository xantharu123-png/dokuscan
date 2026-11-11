// Gemeinsame Hilfen für die Ende-zu-Ende-Tests.
// Startet bei Bedarf den lokalen Server (tools/serve.mjs), öffnet ein unsichtbares Chrome und
// steuert es über das DevTools-Protokoll. Jede Prüfung meldet ✓ oder ✗; bei einem ✗, einem
// Fehler oder einer Ausnahme in der Seite endet der Test mit Exit-Code 1.
//
// Voraussetzungen: Node 22+ (eingebautes WebSocket), Google Chrome oder Microsoft Edge.
// Chrome-Pfad notfalls über die Umgebungsvariable CHROME angeben, Port über PORT (Standard 8765).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT ?? 8765);
export const BASE = `http://localhost:${PORT}/`;
const BROWSERS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Simulierte Kamera: Canvas-Video mit einem Blatt Papier auf einem Holztisch.
 * Steuerbar über window.__cam (hide, empty, quad, shake); window.__gum zählt Kamerazugriffe.
 */
export const CAMERA_STUB = `(() => {
  if (!navigator.mediaDevices) return;
  const W = 1080, H = 1920;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  let frame = 0;
  window.__cam = { hide: false, empty: false, quad: [[180,330],[910,360],[960,1560],[120,1530]], shake: 0 };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function draw() {
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 80; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,230,200,0.07)' : 'rgba(40,20,0,0.12)'; ctx.fillRect(0, (i * 97) % H, W, 5 + (i * 7) % 18); }
    const s = window.__cam;
    if (!s.hide && !s.empty) {
      const dx = Math.sin(frame / 7) * s.shake, dy = Math.cos(frame / 5) * s.shake;
      const q = s.quad.map(([x, y]) => [x + dx, y + dy]);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
      ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
      ctx.fillStyle = '#f6f4ee'; ctx.fill(); ctx.restore();
      ctx.fillStyle = '#2a2a2a';
      for (let r = 0; r < 30; r++) {
        const v = 0.12 + r * 0.026; const len = r % 6 === 5 ? 0.5 : 0.84;
        const l0 = lerp(q[0], q[3], v), r0 = lerp(q[1], q[2], v), l1 = lerp(q[0], q[3], v + 0.01), r1 = lerp(q[1], q[2], v + 0.01);
        const a = lerp(l0, r0, 0.08), b = lerp(l0, r0, 0.08 + len), d = lerp(l1, r1, 0.08), e = lerp(l1, r1, 0.08 + len);
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...e); ctx.lineTo(...d); ctx.closePath(); ctx.fill();
      }
    }
    frame++;
  }
  setInterval(draw, 33); draw();
  navigator.mediaDevices.getUserMedia = async () => { window.__gum = (window.__gum || 0) + 1; return c.captureStream(30); };
})();`;

async function serverUp() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}

/** Startet Server (falls nötig) und Chrome. `name` bestimmt den Ausgabeordner test/e2e/output/<name>. */
async function startSession(name) {
  const out = join(ROOT, 'test/e2e/output', name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  let server = null;
  if (!(await serverUp())) {
    server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs')], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });
    for (let i = 0; i < 50 && !(await serverUp()); i++) await sleep(100);
  }

  const browser = BROWSERS.find((p) => p && existsSync(p));
  if (!browser) throw new Error('Kein Chrome oder Edge gefunden – Pfad über die Umgebungsvariable CHROME angeben.');
  const debugPort = 9300 + Math.floor(Math.random() * 600);
  const profile = join(tmpdir(), `dokuscan-e2e-${name}-${process.pid}`);
  const chrome = spawn(browser, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = [];
  for (let i = 0; i < 100 && !targets.length; i++) {
    try { targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).filter((t) => t.type === 'page'); } catch {}
    if (!targets.length) await sleep(200);
  }
  if (!targets.length) throw new Error('Chrome ist nicht erreichbar.');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));

  let id = 0;
  const pending = new Map();
  const report = [];
  const pageErrors = [];
  let failures = 0;
  let shot = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });

  const s = {
    out,
    report,
    pageErrors,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    async evaluate(expression) {
      const r = await s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expression, timeout = 30000, label = expression) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await s.evaluate(expression).catch(() => false)) return;
        await sleep(150);
      }
      throw new Error('Zeitüberschreitung beim Warten auf: ' + label);
    },
    async screenshot(label) {
      const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, `${String(++shot).padStart(2, '0')}-${label}.png`), Buffer.from(data, 'base64'));
    },
    click: (sel) => s.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('fehlt: ${sel}'); el.click(); return true; })()`),
    text: (sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent`),
    box: (sel) => s.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`),
    mouse: (type, x, y) => s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' }),
    async drag(x0, y0, x1, y1, steps = 10) {
      await s.mouse('mousePressed', x0, y0);
      for (let k = 1; k <= steps; k++) await s.mouse('mouseMoved', x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
      await s.mouse('mouseReleased', x1, y1);
    },
    /** Legt eine Datei in ein <input type="file"> (wie eine Auswahl durch die Nutzerin / den Nutzer). */
    async setFiles(selector, path) {
      const { root } = await s.send('DOM.getDocument');
      const { nodeId } = await s.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      await s.send('DOM.setFileInputFiles', { nodeId, files: [process.platform === 'win32' ? path.replace(/\//g, '\\') : path] });
    },
    /** Erzeugt in der Seite ein Bild (Canvas-Code `draw(x, c)`) und speichert es als JPEG in den Ausgabeordner. */
    async makeJpeg(fileName, width, height, draw) {
      const b64 = await s.evaluate(`(async () => {
        const c = document.createElement('canvas'); c.width = ${width}; c.height = ${height}; const x = c.getContext('2d');
        (${draw})(x, c);
        const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); const u = new Uint8Array(await b.arrayBuffer());
        let t = ''; for (let i = 0; i < u.length; i++) t += String.fromCharCode(u[i]); return btoa(t);
      })()`);
      const path = join(out, fileName);
      writeFileSync(path, Buffer.from(b64, 'base64'));
      return path;
    },
    check(ok, message) {
      report.push(`${ok ? '✓' : '✗'} ${message}`);
      if (!ok) failures++;
    },
    note: (message) => report.push(`  ${message}`),
    get failures() { return failures; },
    async close() {
      ws.close();
      chrome.kill();
      server?.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };

  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('DOM.enable');
  return s;
}

/** Führt einen Test aus, druckt den Bericht und setzt den Exit-Code. */
export async function runTest(name, fn) {
  const s = await startSession(name);
  let crashed = false;
  try {
    await fn(s);
  } catch (err) {
    crashed = true;
    s.report.push('✗ FEHLER: ' + err.message);
    try { await s.screenshot('fehler'); } catch {}
  } finally {
    await s.close();
  }
  const errors = s.pageErrors.filter((e) => !/getUserMedia|NotAllowedError|NotFoundError/.test(e));
  console.log(`\n=== ${name} ===\n` + s.report.join('\n'));
  if (errors.length) console.log('\nFehler in der Seite:\n' + errors.join('\n'));
  console.log(`\nScreenshots: ${s.out}`);
  const failed = crashed || s.failures > 0 || errors.length > 0;
  console.log(failed ? '\nERGEBNIS: FEHLGESCHLAGEN' : '\nERGEBNIS: BESTANDEN');
  process.exitCode = failed ? 1 : 0;
}
