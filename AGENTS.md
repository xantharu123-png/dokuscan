# AGENTS.md – DokuScan

Anweisungen für KI-Coding-Agenten (z. B. Codex). **Vor jeder Arbeit lesen.**
Den vollständigen Projektstand (Aufbau, Algorithmen, Entscheidungen, Stolperfallen, offene Aufgaben)
beschreibt [`docs/HANDOVER.md`](docs/HANDOVER.md). Für Nutzer gedacht ist die [`README.md`](README.md).

## Was das Projekt ist

DokuScan scannt Dokumente mit der iPhone-Kamera. Die App erkennt das Blatt live und schneidet es exakt
an der Blattkante aus (kein Tisch im Bild). Sie entzerrt die Perspektive, wendet Filter an, kann eine
gespeicherte Unterschrift einfügen und erstellt ein PDF.

- **Web-App (PWA):** reines HTML/CSS/JavaScript ohne Build-Schritt, live auf GitHub Pages:
  https://xantharu123-png.github.io/dokuscan/
- **iPhone-App:** dieselbe Web-App in einer Capacitor-8-Hülle (`ios/`), gebaut in der Cloud über
  GitHub Actions (`.github/workflows/ios.yml`). Signieren und TestFlight warten noch auf das
  Apple-Developer-Konto des Nutzers (siehe HANDOVER, „Offene Aufgaben“).

## Zusammenarbeit mit dem Nutzer (verbindlich)

1. **Sprache:** Deutsch, du-Form, einfache Worte. Der Nutzer ist kein Entwickler. Erkläre das Ergebnis und
   was es für ihn bedeutet, nicht die Interna.
2. **Nichts Ungefragtes bauen.** Ist eine Bitte so nicht umsetzbar, erkläre den Grund und frage, welche
   Alternative er will. Baue und veröffentliche keine Ersatzlösungen auf eigene Faust. Das ist schon einmal
   schiefgegangen: Zwei ungefragte Kamera-Varianten mussten zurückgenommen werden (Commit `74e10ab`).
   **Diese beiden Varianten nicht wieder einführen.** Gemeint sind „Kamera pausieren statt ausschalten“ und der
   Modus „iPhone-Kamera“ über `<input capture>`.
3. **Ehrlich berichten:** Was getestet ist, was nicht, und vor allem was auf einem echten iPhone noch nie lief.
4. **Der Nutzer hat keinen Mac**, nur Windows 11. Alles iOS-Spezifische läuft über GitHub Actions (macOS-Runner).

## Wichtige Befehle

```bash
npm install                 # einmalig: Capacitor-Pakete (für iOS-Build und ios:sync; Web-App und Tests brauchen sie nicht)
npm run serve               # lokaler Server: http://localhost:8765  (NICHT python -m http.server, siehe HANDOVER)
npm test                    # alle Ende-zu-Ende-Tests (Erkennung, App-Ablauf, Unterschrift) – müssen grün sein
npm run test:detection      # 12 künstliche Szenen für die Dokumenterkennung
npm run test:app            # App-Ablauf mit simulierter Kamera
npm run test:signature      # Unterschrift-Ablauf
npm run icons               # App-Icons, iOS-Icon und Startbildschirm aus icons/icon.svg erzeugen
npm run ios:sync            # www/ zusammenstellen und ins iOS-Projekt übertragen
```

Die Tests brauchen Node 22+ und Google Chrome oder Microsoft Edge (Pfad notfalls über `CHROME=…`).
Sie starten den Server selbst und legen Screenshots in `test/e2e/output/` ab (nicht versioniert).
Echte Fotos analysiert `http://localhost:8765/test/photo.html`. Es zeigt alle Kandidaten mit Bewertung.

## Regeln für Code-Änderungen

- **Kein Bundler, kein Framework, keine neuen Abhängigkeiten ohne Rückfrage.** ES-Module direkt im Browser.
  `vendor/opencv.js` (OpenCV.js 4.10.0, `@techstark/opencv-js@4.10.0-release.1`) und
  `vendor/jspdf.umd.min.js` (jsPDF 4.2.1) sind fest eingecheckt, nicht austauschen.
- **Stil:** UI-Texte und Kommentare auf Deutsch (deutsche Anführungszeichen „…“, Auslassungszeichen „…“ für
  laufende Vorgänge), 2 Leerzeichen, einfache Anführungszeichen, Semikolons, JSDoc-Kommentare in der Dichte
  des umgebenden Codes.
- **OpenCV-Speicher:** Jede `cv.Mat` mit `.delete()` freigeben. `mat.data` erst **nach** dem letzten
  OpenCV-Aufruf holen, denn wächst der WASM-Speicher, werden alte Ansichten ungültig (Muster: `views()` in
  `js/detect.js`, `removeSpecks()` in `js/signature.js`).
- **iOS-Canvas-Speicher:** Nicht mehr benötigte Canvas mit `releaseCanvas()` freigeben. Quellbilder bleiben
  ≤ 4096 px und ≤ 16 MP (`loadImageCanvas`).
- **Erkennung (`js/detect.js`):** Nach **jeder** Änderung `npm run test:detection`. Alle 12 Szenen müssen
  bestehen, der „Rand“ muss positiv bleiben (Ergebnis liegt innerhalb des Blatts, kein Tischstreifen).
  Die strenge Stufe nicht aufweichen, Begründung in HANDOVER.
- **Oberfläche:** Nach Änderungen `npm run test:app` und `npm run test:signature`. Neue Bedienelemente bekommen
  eine `id`, die Tests greifen darüber zu.
- **Service Worker (`sw.js`):** `vendor/` und `icons/` werden dauerhaft aus dem Cache geliefert. Werden diese
  Dateien geändert oder JS-Dateien hinzugefügt, die Liste `APP_FILES` ergänzen und `CACHE` hochzählen
  (aktuell `dokuscan-v3`).
- **iOS-Projekt:** `www/`, `ios/App/App/public/`, `ios/App/App/capacitor.config.json` und
  `ios/App/App/config.xml` sind generiert, nie von Hand bearbeiten. Stattdessen `npm run ios:sync`.
  Die App-ID darf keine Bindestriche enthalten: `io.github.xantharu123png.dokuscan`.
- **Öffentliches Repository:** Keine Secrets, keine E-Mail-Adressen, keine Namen und keine Inhalte aus Scans
  des Nutzers committen. Apple-Schlüssel gehören ausschließlich in GitHub-Secrets.

## Commits und Veröffentlichung

- Arbeitszweig ist `main`. Ein Push auf `main` aktualisiert automatisch GitHub Pages (Web-App, etwa 1 Minute)
  und startet den iOS-Build.
- Commit-Nachrichten auf Deutsch: kurze Betreffzeile, darunter Stichpunkte.
- Die repo-lokale Git-Identität ist absichtlich `xantharu123-png` mit der GitHub-noreply-Adresse. Nicht ändern.
- Vor dem Push: `npm test` grün. Nach dem Push prüfen, dass die Live-Seite die neue Version ausliefert.
