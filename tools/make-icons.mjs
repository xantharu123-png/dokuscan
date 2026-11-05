// Erzeugt die App-Icons (PNG) aus der Vorlage icons/icon.svg – für die Web-App und,
// falls vorhanden, für die iPhone-App (App-Symbol und Startbildschirm).
// Zum Rendern wird das installierte Google Chrome (oder Microsoft Edge) verwendet.
// Aufruf im Projektordner:  node tools/make-icons.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IOS_ASSETS = join(ROOT, 'ios/App/App/Assets.xcassets');
const BACKGROUND = '#0b0d10';
const BROWSERS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];

// Ziel → { Größe, Symbolgröße auf der Fläche (Startbildschirm: kleines Symbol mittig) }
const TARGETS = {
  'icons/icon-512.png': { size: 512 },
  'icons/icon-192.png': { size: 192 },
  'icons/apple-touch-icon.png': { size: 180 },
};
if (existsSync(IOS_ASSETS)) {
  TARGETS['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'] = { size: 1024 };
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    TARGETS[`ios/App/App/Assets.xcassets/Splash.imageset/${f}`] = { size: 2732, icon: 360 };
  }
}

const browser = BROWSERS.find((p) => p && existsSync(p));
if (!browser) throw new Error('Kein Chrome oder Edge gefunden – Pfad über die Umgebungsvariable CHROME angeben.');

const svg = readFileSync(join(ROOT, 'icons/icon.svg'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'dokuscan-icons-'));
try {
  for (const [target, { size, icon = size }] of Object.entries(TARGETS)) {
    const page = join(tmp, `${size}-${icon}.html`);
    const radius = icon < size ? Math.round(icon * 0.2237) : 0; // iOS-Eckenrundung nur beim Startbildschirm-Symbol
    writeFileSync(page, `<!doctype html><style>html,body{margin:0;overflow:hidden;background:${BACKGROUND}}` +
      `body{width:${size}px;height:${size}px;display:grid;place-items:center}` +
      `svg{display:block;width:${icon}px;height:${icon}px;border-radius:${radius}px}</style>${svg}`);
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--user-data-dir=${join(tmp, 'profile')}`, `--window-size=${size},${size}`,
      `--screenshot=${join(ROOT, target)}`, 'file:///' + page.replace(/\\/g, '/'),
    ], { stdio: 'ignore' });
    const png = readFileSync(join(ROOT, target));
    console.log(`${target} (${png.readUInt32BE(16)}×${png.readUInt32BE(20)})`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
