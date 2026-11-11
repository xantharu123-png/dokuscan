# DokuScan

Web-App fürs iPhone: Die Kamera erkennt ein Dokument, schneidet es exakt an der Blattkante aus (ohne Tisch), entzerrt die Perspektive und erstellt daraus ein PDF.

Alles läuft direkt auf dem iPhone. Es werden keine Bilder hochgeladen. Nach dem ersten Öffnen funktioniert die App auch offline.

## Funktionen

- **Live-Erkennung:** Das Blatt wird im Kamerabild grün umrandet.
- **Automatische Aufnahme:** Liegt das Blatt etwa eine Sekunde ruhig, löst die App selbst aus. Über die Schaltfläche oben links lässt sich auf „Manuell“ umstellen.
- **Saubere Kanten:** Nach der Aufnahme wird jede Blattkante auf dem hochaufgelösten Foto genau nachgemessen. So bleibt kein Streifen vom Tisch im Bild.
- **Perspektivkorrektur:** Schräg fotografierte Blätter werden gerade gerückt. Nahezu DIN-A-förmige Blätter bekommen genau das A4-Format.
- **Filter:** Original, Verbessert (Schatten weg, Papier weiß), Graustufen, Schwarz-Weiß.
- **Mehrere Seiten:** Reihenfolge ändern, drehen, löschen, Ecken von Hand nachziehen (mit Lupe).
- **Unterschrift:** Einmal als Foto hochladen oder mit dem Finger zeichnen, sie bleibt auf dem iPhone gespeichert. Danach lässt sie sich auf jeder Seite platzieren.
- **PDF:** Teilen-Menü von iOS: in „Dateien“ sichern, per Mail senden, AirDrop …
- **Foto importieren:** vorhandene Bilder aus der Mediathek oder ein Foto mit der vollen Kamera-Auflösung.

## Aufs iPhone bringen

Safari erlaubt den Kamerazugriff nur über eine **https://**-Adresse. Die App muss deshalb einmal ins Internet gestellt werden. Beide Wege sind kostenlos.

### Weg A: GitHub Pages (dauerhaft)

1. Auf [github.com](https://github.com) ein neues, **öffentliches** Repository anlegen, z. B. `dokuscan`.
2. Diese Dateien und Ordner hochladen (Schaltfläche „Add file › Upload files“, per Drag & Drop):
   `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `vendor/`, `icons/`
3. Im Repository unter **Settings › Pages** bei „Source“ *Deploy from a branch* wählen, dann Branch `main` und Ordner `/ (root)`, und auf *Save* tippen.
4. Nach etwa einer Minute ist die App unter `https://<dein-name>.github.io/dokuscan/` erreichbar.

### Weg B: Netlify Drop (schnell zum Ausprobieren)

1. [app.netlify.com/drop](https://app.netlify.com/drop) öffnen.
2. Den Projektordner ins Browserfenster ziehen.
3. Netlify zeigt eine https-Adresse an. Damit sie dauerhaft bleibt, legst du ein kostenloses Konto an.

### Auf dem iPhone einrichten

1. Die Adresse in **Safari** öffnen.
2. Auf das Teilen-Symbol tippen und **„Zum Home-Bildschirm“** wählen.
3. DokuScan vom Home-Bildschirm starten und den Kamerazugriff erlauben.

## Bedienung

1. Blatt auf den Tisch legen und das iPhone darüber halten. Sobald der grüne Rahmen erscheint, ruhig halten, dann wird die Seite automatisch aufgenommen.
2. Nächstes Blatt hinlegen. Die App wartet, bis sich etwas geändert hat, und nimmt dieselbe Seite nicht doppelt auf.
3. **Fertig** tippen, um die Seiten zu prüfen: Filter wählen, Seiten sortieren, drehen oder über ✂︎ die Ecken korrigieren.
4. Dateinamen eingeben, **PDF erstellen** tippen und dann **Teilen / In Dateien sichern**.

### Unterschrift einfügen

1. In der Seitenübersicht oben rechts auf **Unterschrift** tippen.
2. **Foto hochladen:** Unterschrift auf ein weißes Blatt setzen, fotografieren, den Bereich um die Unterschrift wählen und auf „Fertig“ tippen. Das Papier wird automatisch entfernt, nur die Tinte bleibt. Alternativ: **Mit dem Finger zeichnen**.
3. Farbe wählen (Blau oder Schwarz). Die Unterschrift wird nur auf diesem iPhone gespeichert und nirgends hochgeladen.
4. Auf einer Seite das Stift-Symbol antippen, die Unterschrift an die richtige Stelle ziehen und über den blauen Punkt die Größe anpassen. Dann „Fertig“ tippen.

Über dasselbe Symbol lässt sich die Unterschrift später verschieben oder wieder entfernen. Wird die Seite gedreht, dreht die Unterschrift mit.

Wird kein Dokument erkannt (z. B. bei manueller Aufnahme), öffnet sich der Ecken-Editor. Dort kann man die vier Ecken von Hand setzen. Zieht man an einem Punkt in der Mitte einer Seite, verschiebt sich die ganze Kante.

## Tipps für gute Scans

- **Kontrast hilft:** Ein dunkler oder farbiger Untergrund wird am zuverlässigsten erkannt. Bei weißem Papier auf einem weißen Tisch klappt die Erkennung oft nicht. Dann die Ecken von Hand setzen.
- Gleichmäßiges Licht, möglichst ohne harten Schatten über dem Blatt.
- Das ganze Blatt muss im Bild sein. Ragt eine Ecke heraus, wird bewusst nichts erkannt.
- Für die höchste Bildqualität: Bild-Symbol oben rechts › „Foto aufnehmen“. Das nutzt die volle Auflösung der iPhone-Kamera (das Live-Video liefert höchstens 4K).

## Gut zu wissen

- Die Seiten bleiben nur erhalten, solange die App geöffnet ist. Erst das PDF erstellen und sichern, dann schließen.
- Als Home-Bildschirm-App fragt iOS die Kameraerlaubnis manchmal bei jedem Start erneut.
- Nach einer Änderung an den Dateien einfach erneut hochladen. Die App holt sich die neue Version beim nächsten Start (eventuell zweimal öffnen).

## Als echte iPhone-App (TestFlight)

Als Web-App auf dem Home-Bildschirm fragt iOS bei jedem Start nach der Kamera-Erlaubnis. Als echte App fragt iOS nur **einmal pro Installation**. Danach lässt sich die Erlaubnis unter Einstellungen › DokuScan ändern.

Die App wird in der Cloud auf einem Mac gebaut (GitHub Actions, `.github/workflows/ios.yml`), einen eigenen Mac brauchst du nicht. Einmalig nötig:

1. **Apple Developer Program** beitreten: [developer.apple.com/programs](https://developer.apple.com/programs/) (99 USD/CHF pro Jahr). Die Freischaltung kann bis zu 2 Tage dauern.
2. **Team-ID** notieren: [developer.apple.com/account](https://developer.apple.com/account) › Mitgliedschaft (10 Zeichen).
3. **Bundle-ID registrieren:** Certificates, Identifiers & Profiles › Identifiers › „+“ › App IDs › App. Als Beschreibung `DokuScan` eintragen und „Explicit“ wählen mit `io.github.xantharu123png.dokuscan`.
4. **App anlegen** in [App Store Connect](https://appstoreconnect.apple.com) › Apps › „+“ › Neue App: Plattform iOS, Name `DokuScan` (falls vergeben, einen Zusatz anhängen), Sprache Deutsch, die Bundle-ID aus Schritt 3, SKU `dokuscan`.
5. **API-Schlüssel erstellen:** App Store Connect › Benutzer und Zugriff › Integrationen › App Store Connect API › Team-Schlüssel › „+“. Name `GitHub`, Zugriff **Admin**. Notiere dir die **Issuer-ID** (oben) und die **Schlüssel-ID** und lade die `.p8`-Datei herunter. Das geht nur einmal.
6. **Bei GitHub hinterlegen:** Repository › Settings › Secrets and variables › Actions › „New repository secret“:
   - `APPLE_TEAM_ID`: Team-ID
   - `ASC_KEY_ID`: Schlüssel-ID
   - `ASC_ISSUER_ID`: Issuer-ID
   - `ASC_KEY_P8`: kompletter Inhalt der `.p8`-Datei (mit Editor öffnen, alles kopieren, inklusive der BEGIN- und END-Zeile)
7. **Bauen:** Actions › „iPhone-App“ › „Run workflow“. Etwa 15 bis 30 Minuten später erscheint der Build in App Store Connect unter TestFlight.
8. **Installieren:** Die App **TestFlight** aus dem App Store laden. In App Store Connect › TestFlight › „Internes Testen“ dich selbst als Tester hinzufügen. Danach installierst du DokuScan über die Einladung in TestFlight.

TestFlight-Builds laufen nach 90 Tagen ab. Davor einfach Schritt 7 wiederholen, TestFlight installiert die neue Version als Update, und die Kamera-Erlaubnis bleibt erhalten.

Für Änderungen am iOS-Projekt: `npm install`, dann `npm run ios:sync` (stellt `www/` zusammen und überträgt es ins iOS-Projekt).

## Am PC ausprobieren

```
node tools/serve.mjs
```

Danach `http://localhost:8765` im Browser öffnen. Am PC wird dabei die Webcam genutzt. Unter `http://localhost:8765/test/detection.html` läuft ein automatischer Test der Dokumenterkennung mit künstlich erzeugten Fotos, unter `http://localhost:8765/test/photo.html` lassen sich eigene Fotos analysieren.

Alle automatischen Tests (Erkennung, App-Ablauf mit simulierter Kamera, Unterschrift) laufen mit:

```
npm test
```

Für Entwickler und KI-Agenten: [`AGENTS.md`](AGENTS.md) (Arbeitsregeln) und [`docs/HANDOVER.md`](docs/HANDOVER.md) (vollständiger Projektstand).

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.html`, `css/app.css` | Oberfläche |
| `js/app.js` | Ablauf: Kamera → Seiten → PDF |
| `js/camera.js` | Kamerazugriff, Beruhigung der Erkennung, automatisches Auslösen |
| `js/detect.js` | Dokumenterkennung und genaue Kantenmessung |
| `js/process.js` | Entzerren, Filter, Drehen |
| `js/editor.js` | Ecken-Editor mit Lupe |
| `js/signature.js` | Unterschrift speichern, aus Foto freistellen, mit dem Finger zeichnen |
| `js/placement.js` | Unterschrift auf einer Seite platzieren |
| `js/pdf.js` | PDF-Erstellung und Teilen |
| `js/geometry.js` | Rechenhilfen für Vierecke |
| `sw.js`, `manifest.webmanifest` | Offline-Betrieb und Home-Bildschirm-App |
| `icons/` | App-Symbol: Vorlage `icon.svg`, daraus erzeugt mit `node tools/make-icons.mjs` die PNGs |
| `vendor/` | OpenCV.js 4.10 (Bilderkennung) und jsPDF 4.2 (PDF), jeweils mit Lizenz |
| `tools/` | Icon-Erzeugung, lokaler Testserver, `www/` für die iPhone-App zusammenstellen |
| `ios/`, `capacitor.config.json`, `package.json` | iPhone-App (Capacitor) |
| `.github/workflows/ios.yml` | Bauen in der Cloud, Signieren, Hochladen zu TestFlight |
| `test/` | Erkennungstest (`detection.html`), Foto-Analyse (`photo.html`), automatische Gesamttests (`e2e/`) |
| `AGENTS.md`, `docs/HANDOVER.md` | Übergabe an Entwickler und KI-Agenten |
