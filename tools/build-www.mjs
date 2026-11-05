// Stellt die Web-App für die iPhone-App (Capacitor) im Ordner www/ zusammen.
// Zusätzlich zur Web-Version kommt die Capacitor-Laufzeit hinein – über sie spricht
// die Seite native Funktionen wie Teilen und Dateien an.
// Aufruf im Projektordner:  npm run build:www

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../www/', import.meta.url));
const FILES = ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'icons'];
const APP_SCRIPT = '<script type="module" src="js/app.js"';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of FILES) cpSync(ROOT + f, OUT + f, { recursive: true });

cpSync(ROOT + 'node_modules/@capacitor/core/dist/capacitor.js', OUT + 'vendor/capacitor.js');
const html = readFileSync(OUT + 'index.html', 'utf8');
if (!html.includes(APP_SCRIPT)) throw new Error('index.html: App-Skript nicht gefunden');
writeFileSync(OUT + 'index.html', html.replace(APP_SCRIPT, `<script src="vendor/capacitor.js"></script>\n  ${APP_SCRIPT}`));

console.log('www/ erstellt:', FILES.join(', '), '+ Capacitor-Laufzeit');
