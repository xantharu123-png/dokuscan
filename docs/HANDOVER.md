# Übergabe: DokuScan

Stand: 11.11.2026 · Letzter Commit vor dieser Übergabe: `a158683` · Branch: `main`
Repository: https://github.com/xantharu123-png/dokuscan (öffentlich) · Live: https://xantharu123-png.github.io/dokuscan/

Dieses Dokument soll einem neuen Agenten oder Entwickler ermöglichen, ohne Rückfragen weiterzuarbeiten.
Die verbindlichen Arbeitsregeln stehen kurz in [`AGENTS.md`](../AGENTS.md), die Nutzeranleitung in
[`README.md`](../README.md).

---

## 1. Ziel und Nutzer

**Wunsch des Nutzers** (wörtlich sinngemäß): eine iPhone-App, die die Kamera startet, Dokumente erkennt und
fotografiert und daraus ein PDF macht. Sie muss die Abgrenzung des Dokuments klar erkennen und darf zum
Beispiel den Tisch nicht mit fotografieren.

Später dazugekommen, jeweils auf Wunsch des Nutzers:
- ein eigenes App-Symbol (5 Entwürfe, gewählt wurde „Scanrahmen“),
- eine robustere Erkennung bei weißem Papier auf hellem Tisch mit Schatten (nach einem Fehlschlag mit
  einem echten Foto),
- eine Unterschrift, die einmal hochgeladen oder gezeichnet, gespeichert und in Seiten eingefügt wird,
- **die Kamera-Erlaubnis nur einmal nach der Installation erfragen, danach nie wieder.** In einer
  Home-Bildschirm-Web-App ist das unter iOS unmöglich, daher wird eine echte iPhone-App gebaut
  (Abschnitt 7 und 10).

**Nutzer:** deutschsprachig, kein Entwickler, Windows 11, **kein Mac**. Er hat ein GitHub-Konto
(`xantharu123-png`), `gh` ist auf seinem PC angemeldet. Er möchte gefragt werden statt mit ungefragten
Lösungen überrascht zu werden (siehe AGENTS.md, Regel 2).

---

## 2. Zeitleiste und Entscheidungen

| Commit | Datum | Inhalt |
|---|---|---|
| `b1b21a1` | 28.10. | Erste Version als Web-App (PWA): Live-Erkennung, Auto-Aufnahme, Feinmessung der Kanten, Entzerrung, Filter, Editor, PDF |
| `0959782` | 31.10. | App-Symbol „Scanrahmen“. Das Icon ist jetzt eine SVG-Vorlage, aus der `tools/make-icons.mjs` die PNGs rendert. Service-Worker-Cache v2 |
| `255fac0` | 31.10. | Erkennung zweistufig (streng und empfindlich), Linien-Suche, Ecken-Prüfung, Feinmessung über 4 px. „Automatisch“ im Editor geht von den aktuellen Ecken aus. `test/photo.html` |
| `ca170f9` | 31.10. | Unterschrift: hochladen oder zeichnen, speichern, platzieren, mitdrehen. Service-Worker-Cache v3 |
| `1a2ae07` | 01.11. | Zwei ungefragte Kamera-Varianten (Pausieren, Modus „iPhone-Kamera“) – **vom Nutzer abgelehnt** |
| `74e10ab` | 01.11. | Revert von `1a2ae07`. Der Code entspricht wieder `ca170f9` |
| `625e467` | 05.11. | iPhone-App: Capacitor-8-Projekt (`ios/`), Info.plist, Icon und Startbildschirm, natives Teilen, GitHub-Actions-Build |
| `a158683` | 05.11. | README: Anleitung für die echte iPhone-App über TestFlight |
| (diese Übergabe) | 11.11. | `AGENTS.md`, dieses Dokument, Ende-zu-Ende-Tests aus temporären Skripten ins Repo übernommen (`test/e2e/`, `npm test`) |

**Wichtige Entscheidungen**

1. **Web-App statt nativer Swift-App** (28.10.): Für native Builds braucht man einen Mac mit Xcode, den der
   Nutzer nicht hat. Die Bildverarbeitung läuft deshalb mit OpenCV.js im Browser.
2. **Erkennung selbst gebaut** (OpenCV.js plus eigene Kantenmessung), weil Apples VisionKit nur nativ verfügbar ist.
3. **Zwei Stufen bei der Erkennung** (31.10.): Die strenge Stufe ist auf typischen Fotos bewährt und darf
   nicht schlechter werden. Die empfindliche Stufe findet schwache Kanten, würde aber allein Schatten oder
   Textblöcke greifen. Kombiniert wird über die Regel „größeres umschließendes Viereck gewinnt“ (Abschnitt 5).
4. **Kamera-Erlaubnis:** In iOS-Home-Bildschirm-Web-Apps fragt iOS bei jedem Start erneut. Das ist ein
   WebKit-Fehler, [Bug 215884](https://bugs.webkit.org/show_bug.cgi?id=215884), und nicht lösbar. Der Nutzer
   hat Ersatzlösungen abgelehnt und sich für eine **echte App** entschieden. Capacitor erteilt der Web-Seite die
   Kamera-Erlaubnis selbst (`WebViewDelegationHandler`:
   `requestMediaCapturePermissionFor … decisionHandler(.grant)`). Übrig bleibt nur der iOS-Systemdialog
   (`NSCameraUsageDescription`), **einmal pro Installation**.
5. **Kein Mac → Cloud-Build** auf GitHub Actions (`macos-latest`, zuletzt Xcode 26.6). Signiert wird per
   App-Store-Connect-API-Schlüssel, verteilt über **TestFlight** (internes Testen, keine Prüfung durch Apple).
   Das kostenlose Apple-ID-Signieren wurde verworfen, weil die App dann nach 7 Tagen abläuft.
6. **Keine Speicherung der Seiten:** Gescannte Seiten leben nur im Arbeitsspeicher. Ein Neustart verwirft sie,
   das ist in der README dokumentiert. Nur die Unterschrift und Einstellungen liegen in `localStorage`.

---

## 3. Verzeichnis und Dateien

```
index.html              Alle Ansichten und Overlays (eine Seite, Ansichten über .view.is-active)
css/app.css             Gesamtes Styling (dunkles Design, Safe-Area-Variablen)
js/app.js               Steuerung: Zustand, Ansichten, Kamera-Schleife, Seiten, Unterschrift, PDF, Ereignisse
js/camera.js            Camera (getUserMedia), QuadTracker (Glättung, Ruhe-Erkennung, Auto-Auslösung)
js/cv-loader.js         Lädt vendor/opencv.js einmalig (Achtung: then-Falle, Abschnitt 9)
js/detect.js            Dokumenterkennung (detectQuad), Feinmessung (refineQuad), findDocument, autoCorners
js/process.js           Entzerren (warp), Filter, Einblendungen (Unterschrift), Drehen, JPEG, Bild laden
js/editor.js            Ecken-Editor mit Lupe (auch für „Unterschrift auswählen“)
js/placement.js         Unterschrift platzieren (verschieben, skalieren), Umrechnung gedreht/ungedreht
js/signature.js         Unterschrift speichern, laden, umfärben, aus Foto freistellen, Zeichenfeld
js/pdf.js               PDF mit jsPDF, Teilen (Web Share bzw. nativ in der App)
js/geometry.js          Vierecks-Mathematik
sw.js                   Service Worker (Offline-Betrieb), Cache-Version dokuscan-v3
manifest.webmanifest    PWA-Manifest (standalone, portrait)
icons/icon.svg          Vorlage des App-Symbols. Daraus: icon-512/192.png, apple-touch-icon.png
vendor/                 opencv.js (10 MB, 4.10.0), jspdf.umd.min.js (4.2.1), Lizenzen
tools/serve.mjs         Lokaler Webserver (Port 8765, Cache-Control: no-cache)
tools/make-icons.mjs    Rendert alle Icons und den iOS-Startbildschirm mit Chrome/Edge aus icon.svg
tools/build-www.mjs     Stellt www/ für Capacitor zusammen und fügt vendor/capacitor.js in index.html ein
test/detection.html     Erkennungstest im Browser (12 künstliche Szenen, Diagnose der Kandidaten)
test/photo.html         Analyse eigener Fotos (alle Kandidaten mit Bewertung, Ergebnisbild)
test/e2e/*.mjs          Ende-zu-Ende-Tests über das Chrome-DevTools-Protokoll (Abschnitt 8)
package.json            Capacitor-Pakete und npm-Skripte (Versionen fest gepinnt)
capacitor.config.json   appId io.github.xantharu123png.dokuscan, webDir www, dunkler Hintergrund
ios/                    Xcode-Projekt (Capacitor, Swift Package Manager, kein CocoaPods)
.github/workflows/ios.yml  Cloud-Build, Signieren, Upload zu TestFlight
README.md               Nutzeranleitung (Deutsch)
AGENTS.md               Regeln für Agenten
docs/HANDOVER.md        Dieses Dokument
```

Nicht versioniert (`.gitignore`): `node_modules/`, `www/`, `design/` (lokal: die 4 nicht gewählten
Icon-Entwürfe), `test/e2e/output/`, `.claude/`.

---

## 4. Ablauf der App (Benutzersicht → Code)

### Start
`init()` registriert die Ereignisse und den Service Worker (nur unter `https:`, also nicht in Capacitor mit
`capacitor://`). Die Unterschrift wird geladen (`loadSignature`), danach OpenCV (`loadCv`). Anschließend folgt
`showView('camera')`. Schlägt das Laden fehl, erscheint ein Text im Ladebildschirm. Für Modul-Ladefehler gibt
es einen `onerror` am `<script type="module">`.

### Kamera-Ansicht (`#view-camera`)
- `startCamera()` ruft `camera.start()` auf (`getUserMedia`, Rückkamera, ideal 3840×2160), danach `startLoop()`
  und `keepAwake()` (Wake-Lock). Fehler zeigt `showCameraError()` in `#cam-error` an: Erlaubnis verweigert,
  kein https, keine Kamera.
- `tick()` per `requestAnimationFrame`. Die Erkennung läuft höchstens alle
  `max(DETECT_INTERVAL=100 ms, detectCost·2.5)`, dabei ist `detectCost` der gleitende Mittelwert der
  Rechenzeit. Aufruf: `detectQuad(cv, video, …, { prev: tracker.quad, thorough: true })` bei 400 px.
- `QuadTracker.update()`: Bewegt sich das Viereck um weniger als 8 % der Diagonale, wird geglättet (lerp 0.45).
  Bei mehr als 1,5 % gilt das als Bewegung, dann wird `stableSince` neu gesetzt. Ohne Treffer in mehr als
  3 Bildern wird das Viereck verworfen. `progress()` = Ruhezeit / 1000 ms. Nach einer Aufnahme ist `captured`
  gesetzt und es wird erst wieder ausgelöst, wenn das Blatt mehr als 700 ms weg war oder sich um mehr als
  12 % verschoben hat (keine Doppelaufnahmen).
- `drawOverlay()` zeichnet das grüne Viereck. Das Video nutzt `object-fit: contain`, dieselbe Abbildung gilt
  für das Overlay. Der Auslöser zeigt den Fortschritt als Ring (`--p`).
- **Auto/Manuell:** `#btn-auto` (Einstellung `dokuscan.auto`). Bei Auto löst `progress ≥ 1` `capture()` aus.
- `capture()` setzt `tracker.markCaptured()`, löst den Blitz-Effekt aus, holt das Vollbild mit
  `camera.grab()` und ruft `addPage(frame, hint)` auf.
- **Import:** `#file-input` (`accept=image/*`, mehrere Dateien). `onImport` übernimmt jede Datei über
  `loadImageCanvas` und `addPage(canvas, null)` und wechselt danach zur Übersicht.

### Seite hinzufügen (`addPage`)
`findDocument(cv, canvas, hint)`: Erkennung bei 640 px, gründlich, danach Feinmessung bei 2000 px.
Bei `null` öffnet sich der Ecken-Editor mit `defaultQuad` (8 % Rand) und dem Hinweis „Kein Dokument erkannt“.
Danach wird die Quelle als JPEG 0.92 gespeichert (`page.source`) und `renderInto()` gerendert.

### Übersicht (`#view-review`)
- Die Kamera wird dort **ausgeschaltet** (`camera.stop()`). Das ist so gewollt, weil der Nutzer die
  Pausier-Variante abgelehnt hat.
- Filterleiste: `original | enhanced | gray | bw` (Einstellung `dokuscan.filter`, Standard `enhanced`).
  Ein Wechsel rendert alle Seiten neu.
- Seitenkarte: Tippen auf das Vorschaubild öffnet den Editor. Die Pfeile `left`/`right` liegen auf dem Bild,
  dazu kommen die Aktionen Zuschneiden, Unterschreiben, Drehen (+90°) und Löschen (mit `confirm`).
- Dateiname: Vorgabe „Scan JJJJ-MM-TT HH-MM“. Nicht erlaubte Zeichen werden ersetzt.
- „PDF erstellen“ (`makePdf`) öffnet das Blatt `#export-sheet` mit „Teilen / In Dateien sichern“ und
  „Herunterladen“ (in der nativen App ausgeblendet), dazu „Neuen Scan beginnen“ und „Schließen“.
  Die PDF-Datei wird **vorher** erzeugt, weil `navigator.share` direkt aus einem Tipp heraus aufgerufen
  werden muss.

### Ecken-Editor (`#editor`, `openEditor`)
Vier Eckgriffe und vier Seitenmitten (verschieben eine ganze Kante). Beim Ziehen erscheint eine Lupe
(3-fach, Radius 62). Nicht-konvexe Vierecke werden rot dargestellt, „Fertig“ ist dann gesperrt.
- „Automatisch“ ruft `autoCorners(cv, canvas, aktuelleEcken)` auf. Das sucht das Blatt bevorzugt nahe den
  aktuellen Ecken. Findet es nichts, werden die aktuellen Ecken an die nächsten Kanten angelegt, sofern
  mindestens 3 Seiten eine Kante haben. Sonst erscheint „Keine Blattkante gefunden …“.
- „Ganzes Bild“ setzt das Viereck auf das ganze Bild.
- Parameter `title` (z. B. „Unterschrift auswählen“). Ohne `onAuto` ist der Knopf „Automatisch“ ausgeblendet.

### Unterschrift
- Verwaltung `#signature-sheet` über `manageSignature(forSigning)`: Vorschau, Farbe Blau `#1d3f9a` oder
  Schwarz `#15171c` (Einstellung `dokuscan.ink`), „Foto hochladen“ (`#sig-file`), „Mit dem Finger zeichnen“,
  „Unterschrift löschen“.
- **Foto:** `signatureFromPhoto` lädt das Bild, der Editor wählt den Bereich, `warpToCanvas` entzerrt ihn und
  `extractSignature` stellt frei (Abschnitt 5.4).
- **Zeichnen:** `openSignaturePad`, Pointer-Events mit quadratischer Glättung, Strichbreite 3,2 CSS-px.
  Zugeschnitten wird auf den gezeichneten Bereich.
- Gespeichert wird als PNG-Data-URL in `localStorage['dokuscan.signature']`, danach wird
  `navigator.storage.persist()` versucht.
- **Platzieren:** `signPage` rendert die Seite ohne Unterschrift als Hintergrund. `openPlacement` erlaubt
  Ziehen und Skalieren um die Mitte über den blauen Punkt (8–95 % der Seitenbreite). Startlage: Mitte bei
  (0,7 | 0,85), Breite 32 %.
- Gespeichert wird je Seite `page.signature = { image, cx, cy, w, angle }` **bezogen auf die ungedrehte Seite**
  (`toPageFrame` und `toViewFrame` in `placement.js`). Dadurch dreht die Unterschrift beim Drehen der Seite mit.
  Eingefügt wird nach dem Filter und vor der Drehung (`drawOverlays` in `process.js`). Bei S/W bleibt sie
  also farbig.

### Datenmodell
```js
state = {
  pages: [{ id, source: Blob /*JPEG 0.92*/, quad: [{x,y}×4] /*in Quell-Pixeln*/, rotation: 0|90|180|270,
            signature: null | { image: Canvas, cx, cy, w, angle }, result: { blob, url, width, height } }],
  filter: 'enhanced', auto: true, ink: 'blau', signature: Canvas|null, view: 'loading'|'camera'|'review',
}
```
`localStorage`-Schlüssel: `dokuscan.filter`, `dokuscan.auto`, `dokuscan.ink`, `dokuscan.signature`.
Vierecke haben immer die Reihenfolge oben-links, oben-rechts, unten-rechts, unten-links (`orderQuad`).

---

## 5. Algorithmen und Parameter

### 5.1 Erkennung `detectQuad(cv, source, W, H, { maxSide, prev, thorough, debug })` – `js/detect.js`
1. Verkleinern auf `maxSide` (live 400, Foto 640). Dann Grau, HSV-Sättigung und Gauß 5×5.
2. `closedG` = Closing (Rechteck-Kern, Seitenlänge `max(W,H)/45`, ungerade) löscht dunkle Schrift.
   `openS` = Opening der Sättigung löscht bunte Details.
3. **Strenge Kandidaten:** Canny `closedG` 30/90 („canny-stark“), Canny `closedG` 12/36 („canny-schwach“),
   Canny `openS` 20/60 („canny-farbe“), jeweils um 3×3 dilatiert. Dazu Otsu-Schwelle auf `closedG` („otsu“).
   `collectQuads`: die 5 größten Konturen ab 8 % Fläche, jeweils Kontur und konvexe Hülle,
   `approxPolyDP` mit 1,5 / 3 / 5 % Umfang, Treffer bei genau 4 Punkten.
4. **Empfindliche Kandidaten** (bei `thorough` oder wenn streng nichts fand): CLAHE (Clip 3, Kacheln 8×8) auf
   `closedG`, Canny 20/60 („kontrast“, Konturen) und Canny 10/30 mit `HoughLinesP` („linien“).
   `collectLineQuads`: Segmente werden zu Geraden zusammengefasst, die 16 stärksten bilden Paare fast paralleler
   Geraden (unter 26° Unterschied, Abstand über 20 % der kurzen Bildseite). Aus je zwei Paaren mit mindestens
   45° Winkelunterschied entsteht ein Viereck (Ecken innerhalb ±2 % des Bildes).
5. **Bewertung `rateQuad`:** konvex, Fläche 8–97 %, Innenwinkel 45–135°. Je Seite 28 Messpunkte
   (`edgeSupport`); an jedem prüft `edgeAt` quer zur Seite (Versatz ±2 px) den Kontrast ±3 px in Grau
   **oder** Sättigung:
   - **streng:** Kontrast ≥ 14,
   - **empfindlich:** zusätzlich Kontrast ≥ 5, sofern der Grauwert-Gradient bis auf 25° quer zur Seite zeigt
     (`alignedGradient`, |cos| ≥ 0,9). Außerdem müssen ≥ 3 von 4 Ecken „solide“ sein (`solidCorners`: auf
     beiden angrenzenden Seiten in 3–15 px Abstand ≥ 2 von 5 Treffern).
   - Jede Seite braucht ≥ 45 % Treffer.
   - Score = `sqrt(Fläche) · Mittelwert² · Minimum`. Bonus ×1,4, wenn alle Ecken innerhalb 5 % der Diagonale
     von `prev` liegen (gegen Flackern).
6. **Auswahl:** `strict` = bester strenger Kandidat. `loose` = `outermost(sensitive)`: der beste empfindliche
   Kandidat, solange ein anderer mit Score ≥ 50 % ihn umschließt (Toleranz 1 % der Diagonale) und mindestens
   **1,18×** so groß ist (`ENCLOSING`). `loose` gewinnt, wenn es kein `strict` gibt **oder** wenn `loose`
   `strict` umschließt und ≥ 1,18× größer ist. Hintergrund: Textblock statt Blatt wird so korrigiert. Ein
   Schatten unter dem Blatt macht das Viereck nur wenige Prozent größer und bleibt deshalb ausgeschlossen.

### 5.2 Feinmessung `refineQuad(cv, canvas, quad)` → `{ quad, fitted }`
Das Bild wird auf 2000 px (lange Seite) skaliert, in Grau umgewandelt und mit Gauß 3×3 geglättet.
Suchradius `R = max(6, 0,9 % der langen Seite)`.

`fitEdge` je Seite:
- `n = clamp(Länge/8, 16, 120)` Messstellen bei t = 0,1…0,9.
- Quer zur Seite wird `I(s+2) − I(s−2)` gemessen (über 4 px, gemittelt über 3 Punkte längs der Kante im
  Abstand ±1,5 px), für s = −R…R in 0,5er-Schritten.
- Die Lage der Kante ist der Schwerpunkt des Spitzenbereichs (≥ 70 % der Spitze, `peak`). Mindestwert 5.
- Das Vorzeichen (Tisch dunkler oder heller als Papier) wird per Summe gewählt. Nötig sind ≥ 35 % gültige
  Punkte.
- `fitLineRansac`: Paare (i, i+n/2), Inlier ≤ 1,5 px, mindestens 6 Inlier bzw. 40 %. Danach orthogonale
  Ausgleichsgerade.

Ecken entstehen als Schnittpunkte benachbarter Geraden. Wandert eine Ecke um mehr als 2,5·R, bleibt die
alte. Ist das Ergebnis nicht konvex, bleibt der Start. Danach **1,5 px nach innen** (`EDGE_INSET`), damit kein
Übergangssaum bzw. Tischstreifen bleibt.

`findDocument(cv, canvas, hint)` = Erkennung bei 640 px (gründlich, `prev = hint`), sonst `hint`; danach
Feinmessung.

### 5.3 Ausgabe `renderPage` – `js/process.js`
- `outputSize`: Breite = max(obere, untere Seite), Höhe = max(linke, rechte Seite). Liegt das
  Seitenverhältnis innerhalb ±7 % von √2, wird auf DIN A exakt gerundet. Höchstens 3508 px (A4 bei 300 dpi).
- `warpPerspective` mit `INTER_CUBIC` und `BORDER_REPLICATE`.
- **Filter:**
  - `original`: unverändert.
  - `enhanced`: Papierfarbe schätzen (1/8 verkleinert, Dilatation 7×7 ×2, Gauß σ 3, hochskaliert), dann
    `divide(rgb, paper, 255)` und `convertTo(α 1,12, β −30)`.
  - `gray`: `enhanced` in Grau.
  - `bw`: adaptive Gauß-Schwelle (Block `clamp(lange Seite/70, 15, 61)`, C 12), UND-verknüpft mit einer
    Otsu-Schwelle (gedeckelt auf 170). Dadurch werden große dunkle Flächen nicht hohl.
- Danach Einblendungen, Drehung per Canvas und JPEG 0.88.

### 5.4 Unterschrift freistellen `extractSignature` – `js/signature.js`
- Grau, Papierhelligkeit schätzen (wie bei `enhanced`), dann teilen.
- Deckkraft = `(215 − v) / (215 − 110)`, begrenzt auf 0…1; unter 0,15 wird sie 0.
- `removeSpecks`: zusammenhängende Flächen mit Deckkraft > 90/255 und Fläche ≥ `max(30, 0,005 % der
  Bildfläche)` bleiben, dilatiert 5×5 für den weichen Rand. Alles andere wird durchsichtig.
- Zuschnitt über Zeilen- und Spaltenhistogramme mit 4 % Rand, eingefärbt in der Tintenfarbe, höchstens 1200 px breit.

### 5.5 PDF – `js/pdf.js`
jsPDF in Punkt: Die kurze Seite ist immer 595,28 pt (A4-Breite), die lange Seite ergibt sich aus dem
Bildverhältnis. Jede Seite ist ein JPEG ohne Neukompression. `setProperties({ title, creator: 'DokuScan' })`.
- **Teilen im Web:** `navigator.share({ files })`.
- **In der App** (`isNativeApp()` über `window.Capacitor.isNativePlatform()`): Base64 mit
  `Filesystem.writeFile` nach `CACHE`, dann `Share.share({ files: [uri] })`. Die Plugins werden per
  `Capacitor.registerPlugin('Filesystem' | 'Share')` angesprochen. `vendor/capacitor.js` (Core-Laufzeit) fügt
  `build-www.mjs` **nur in `www/index.html`** ein, die Web-Version ist davon nicht betroffen.

---

## 6. Web-App: Auslieferung und Offline-Betrieb

- **GitHub Pages:** Branch `main`, Root `/`, `.nojekyll`. Jeder Push veröffentlicht nach etwa 1 Minute.
  Die Kamera braucht https, deshalb ist das die Testumgebung auf dem iPhone.
- **Service Worker** `sw.js`, Cache `dokuscan-v3`:
  - Bei `install` werden alle `APP_FILES` geladen.
  - `vendor/` und `icons/` kommen **cache-first**, alles andere network-first mit Rückfall auf den Cache.
  - Bei `activate` werden alte Caches gelöscht.
  - Geänderte Icons oder vendor-Dateien und neue JS-Dateien erfordern eine neue Version und einen Eintrag
    in `APP_FILES`.
- PWA-Meta: `apple-mobile-web-app-capable`, Statusleiste `black-translucent`, `viewport-fit=cover`.
  Safe-Area über `env(safe-area-inset-*)`.

---

## 7. iPhone-App (Capacitor) und Cloud-Build

### Projekt
- Capacitor **8.5.3** (`core`, `ios`, `cli`), `@capacitor/share` 8.0.3, `@capacitor/filesystem` 8.1.5. Die
  Versionen sind exakt gepinnt.
- Eingerichtet mit `npx cap add ios --packagemanager SPM`, das funktioniert auch unter Windows. Pakete liegen
  in `ios/App/CapApp-SPM/Package.swift`, das von `cap sync` neu geschrieben wird.
- `capacitor.config.json`: `appId io.github.xantharu123png.dokuscan` (keine Bindestriche erlaubt),
  `appName DokuScan`, `webDir www`, `ios.contentInset never`, Hintergrund `#0b0d10`.
- **Info.plist** (`ios/App/App/Info.plist`), gegenüber der Vorlage geändert:
  - `CFBundleDevelopmentRegion de`
  - `NSCameraUsageDescription` „DokuScan braucht die Kamera, um Dokumente zu scannen.“
  - `UISupportedInterfaceOrientations` nur Hochformat
  - `UIRequiredDeviceCapabilities arm64` statt armv7
  - `UIViewControllerBasedStatusBarAppearance false` und `UIStatusBarStyleLightContent`
  - `ITSAppUsesNonExemptEncryption false`, damit TestFlight nicht jedes Mal nach Exportkontrolle fragt
- `project.pbxproj`: `TARGETED_DEVICE_FAMILY = 1` (nur iPhone), `IPHONEOS_DEPLOYMENT_TARGET 15.0`,
  `MARKETING_VERSION 1.0`, `CODE_SIGN_STYLE Automatic`.
- App-Symbol (`AppIcon-512@2x.png`, 1024 px) und Startbildschirm (`splash-2732x2732*.png`: dunkel, Symbol
  360 px in der Mitte) erzeugt `npm run icons`.
- Generiert und nicht versioniert: `ios/App/App/public/`, `ios/App/App/capacitor.config.json`,
  `ios/App/App/config.xml`, `ios/capacitor-cordova-ios-plugins/`.

### Workflow `.github/workflows/ios.yml`
Auslöser: Push auf `main` und manuell (`workflow_dispatch`). Läuft auf `macos-latest`.
1. `npm ci`, `npm run build:www`, `npx cap sync ios`.
2. Probe-Build Simulator: `xcodebuild … -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`. **Läuft grün**
   (Lauf 41980685680, Xcode 26.6).
3. **Nur wenn Secrets gesetzt sind** (`if: env.ASC_KEY_ID != ''`): Archiv bauen mit `-allowProvisioningUpdates`,
   API-Schlüssel, `DEVELOPMENT_TEAM`, `CODE_SIGN_STYLE=Automatic` und
   `CURRENT_PROJECT_VERSION=$GITHUB_RUN_NUMBER` (Build-Nummer steigt). Danach `-exportArchive` mit
   ExportOptions `method app-store-connect` und `destination upload`, das lädt direkt zu App Store Connect hoch.

Secrets (Namen): `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (Inhalt der .p8-Datei).
**Stand 11.11.2026: keine gesetzt** (`gh secret list` ist leer).

---

## 8. Tests

| Befehl | Prüft | Stand 11.11.2026 |
|---|---|---|
| `npm run test:detection` | 12 Szenen (Holz, hellgrau, blau gedreht, weiß auf weiß, starke Perspektive, Stift und Tasse, dunkler Kopfbalken, weißer Tisch mit Schatten, Papier dunkler als Tisch, Blatt ragt heraus → nichts, kein Blatt → nichts, 12-MP-Foto). Grenze: Abweichung ≤ 0,25 % der langen Seite, Rand ≥ −0,5 px | 12/12 ✓ (Abweichung 2,6–5,7 px, Rand 0,71–1,86 px innen) |
| `npm run test:app` | Kamera-Simulation, manuell/auto, keine Doppelaufnahme, Blattwechsel, Editor ohne Blatt, Kamera in Übersicht aus, S/W, Drehen, Sortieren, Editor mit Lupe/Automatisch, PDF gültig mit 2 Seiten, 12-MP-Import | 16/16 ✓ |
| `npm run test:signature` | Zeichnen, speichern, Farbe, Foto-Upload mit Staub und Freistellen, platzieren, verschieben, skalieren, Mitdrehen, Entfernen, Filter, PDF, Persistenz nach Neuladen | 15/15 ✓ |

- **Kamera-Simulation:** `CAMERA_STUB` in `test/e2e/lib.mjs` ersetzt `getUserMedia` durch ein Canvas-Video.
  Steuerung über `window.__cam = { hide, empty, quad, shake }`, Zähler `window.__gum`.
- **Diagnose:** `detectQuad(…, { debug: [] })` liefert alle Kandidaten mit `from`, `mode`, `score`, `reason`,
  `area` und `support`. `test/detection.html` zeigt bei Fehlern die besten Kandidaten. `test/photo.html`
  analysiert eigene Fotos (Datei wählen; per Skript `window.analyze(canvas)`).
- Die Tests prüfen **Chrome**, nicht Safari oder WKWebView.

---

## 9. Stolperfallen (alle schon einmal aufgetreten)

1. **OpenCV.js und `then`:** Das Emscripten-Modul hat eine eigene `then()`. Wird es von einer `async`-Funktion
   zurückgegeben oder mit einem Promise aufgelöst, entsteht eine endlose Mikrotask-Schleife und die Seite friert
   ein. `cv-loader.js` löscht deshalb `cv.then` vor dem `resolve`. Nie `await cv` schreiben.
2. **WASM-Speicher wächst:** Danach zeigen `mat.data`-Ansichten ins Leere. `data` erst nach dem letzten
   OpenCV-Aufruf holen bzw. neu holen.
3. **`python -m http.server`** verweigert unter Windows bei vielen parallelen Modul-Anfragen Verbindungen
   (`ERR_CONNECTION_REFUSED`). Dann startet die App zufällig nicht. Immer `npm run serve` verwenden.
4. **Headless Chrome mit `--virtual-time-budget`/`--dump-dom`** wartet nicht zuverlässig auf das Kompilieren von
   WASM. Deshalb laufen die Tests über das DevTools-Protokoll in Echtzeit.
5. **Kamera in Testbrowsern:** Echte Browser fragen nach der Kamera-Erlaubnis bzw. haben keine Kamera.
   Immer `CAMERA_STUB` benutzen.
6. **iOS-Canvas:** Canvas-Speicher ist begrenzt. Größe auf 0 setzen gibt ihn frei (`releaseCanvas`).
   Höchstens etwa 16,7 MP pro Canvas.
7. **Web Share:** `navigator.share` nur direkt in einer Nutzeraktion aufrufen, deshalb wird das PDF vorher
   erzeugt. In WKWebView ist Web Share unzuverlässig, daher das native Teilen.
8. **Service Worker:** Wird `CACHE` nicht hochgezählt, behalten installierte PWAs alte Icons und vendor-Dateien.
9. **Kamera-Erlaubnis in iOS-Home-Bildschirm-Web-Apps:** Sie gilt nur pro Start, nach etwa 90 s ohne Nutzung
   wird erneut gefragt. Das ist der Grund für die native App. Nicht mit Tricks in der Web-App „lösen“,
   der Nutzer hat das abgelehnt.
10. **Erkennung bei weißem Papier auf weißem Tisch:** Im Originalfall war das Papier oben nur 7 Stufen heller
    und rechts 5 Stufen *dunkler* als der Tisch. Die empfindliche Stufe deckt das ab. Eine weitere Absenkung
    der Schwellen hat in Tests Schatten- und Textblock-Vierecke gewinnen lassen. Erst mit echten Fotos
    nachjustieren.
11. **Windows-Zeilenenden:** Git meldet „LF will be replaced by CRLF“. Das ist harmlos, im Repo bleibt LF.

---

## 10. Offene Aufgaben (in dieser Reihenfolge)

1. **Wartet auf den Nutzer:** Apple Developer Program (99 USD/CHF pro Jahr) und die Schritte 2–6 aus der
   README („Als echte iPhone-App“):
   - Team-ID,
   - Bundle-ID `io.github.xantharu123png.dokuscan` registrieren,
   - App in App Store Connect anlegen (Name „DokuScan“, falls vergeben mit Zusatz),
   - API-Schlüssel mit Zugriff **Admin**,
   - 4 GitHub-Secrets.

   Secrets gibt der Nutzer selbst ein. Nicht danach fragen, sie im Chat zu teilen.
2. **Ersten signierten Build** auslösen (Actions → „iPhone-App“ → Run workflow) und Fehler beheben.
   Bisher **ungetestet**, bekannte Risiken:
   - Automatisches Signieren beim `archive` kann ein **Development-Profil** verlangen. Ohne registriertes
     Gerät endet das mit „no devices“. Abhilfe in dieser Reihenfolge prüfen:
     1. Das iPhone (UDID) im Developer-Portal registrieren.
     2. Archiv mit Distributionssignatur, z. B. `CODE_SIGN_IDENTITY="Apple Distribution"`. Dabei auf den
        Konflikt „automatically signed … manually specified“ achten.
     3. Notfalls manuelles Signieren mit fastlane `match`.
   - Cloud-verwaltete Zertifikate erfordern einen API-Schlüssel mit ausreichender Rolle (Admin).
   - Der App-Eintrag in App Store Connect muss vor dem ersten Upload existieren.
3. **Auf dem iPhone über TestFlight prüfen** (noch nie auf echter Hardware gelaufen):
   - Kamera-Systemdialog genau einmal, danach nie wieder, auch nach Neustart und Update,
   - Live-Erkennung, Leistung und Erkennungsintervall,
   - Safe-Area und Statusleiste,
   - Foto-Import über `<input type=file>` in WKWebView,
   - natives Teilen und „In Dateien sichern“,
   - Unterschrift bleibt in `localStorage` von WKWebView,
   - Startbildschirm und Icon.
4. **TestFlight-Builds laufen nach 90 Tagen ab.** Mit dem Nutzer klären, ob ein automatischer Neu-Build
   (z. B. monatlich per `schedule`) gewünscht ist. **Nicht ungefragt einbauen.**
5. **Echte Fotos:** Der Nutzer wurde um ein Originalfoto (weißes Blatt auf hellem Tisch) gebeten, geliefert hat
   er noch keines. Kommt eins, mit `test/photo.html` prüfen und gegebenenfalls als Testszene nachbauen.
   **Keine Fotos oder Inhalte des Nutzers ins öffentliche Repository legen.**
6. Optional und nur auf Wunsch: Seiten dauerhaft speichern (zurzeit gehen sie beim Schließen verloren),
   mehrere Unterschriften, Upload in den App Store.

---

## 11. Was nicht verifiziert ist

- Nichts davon lief bisher auf einem echten iPhone, weder als Web-App noch als native App. Ausnahme: Der Nutzer
  hat die Web-App genutzt (Erkennungsproblem, Kamera-Nachfrage) und das neue Symbol gesehen.
- Signieren und TestFlight-Upload (Schritt 3 im Workflow) liefen noch nie.
- Natives Teilen über Filesystem und Share ist nur kompiliert, nicht ausgeführt.
- Die Erkennungsparameter wurden mit künstlichen Szenen und einem verfälschten Screenshot abgestimmt, nicht mit
  Originalfotos.

---

## 12. Umgebung des Nutzers (für lokale Arbeit auf seinem PC)

Windows 11 · Node 24 · npm 11 · Python 3.11 · Git 2.55 · GitHub CLI (`gh`, angemeldet) · Google Chrome und
Microsoft Edge · Projektpfad `C:\Projekt\Iphone PDF app` · Kein Mac, kein Xcode.
