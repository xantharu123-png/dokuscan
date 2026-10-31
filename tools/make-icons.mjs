// Erzeugt die App-Icons (PNG) aus der Vorlage icons/icon.svg.
// Zum Rendern wird das installierte Google Chrome (oder Microsoft Edge) verwendet.
// Aufruf im Projektordner:  node tools/make-icons.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS = fileURLToPath(new URL('../icons/', import.meta.url));
const SIZES = { 'icon-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180 };
const BROWSERS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];

const browser = BROWSERS.find((p) => p && existsSync(p));
if (!browser) throw new Error('Kein Chrome oder Edge gefunden – Pfad über die Umgebungsvariable CHROME angeben.');

const svg = readFileSync(join(ICONS, 'icon.svg'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'dokuscan-icons-'));
try {
  for (const [name, size] of Object.entries(SIZES)) {
    const page = join(tmp, `${size}.html`);
    writeFileSync(page, `<!doctype html><style>html,body{margin:0;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--user-data-dir=${join(tmp, 'profile')}`, `--window-size=${size},${size}`,
      `--screenshot=${join(ICONS, name)}`, 'file:///' + page.replace(/\\/g, '/'),
    ], { stdio: 'ignore' });
    const png = readFileSync(join(ICONS, name));
    console.log(`icons/${name} (${png.readUInt32BE(16)}×${png.readUInt32BE(20)})`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
