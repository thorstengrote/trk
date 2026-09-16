> **Hinweis:** Dieses Dokument beschreibt den alten Stand mit Leaflet. Seit September 2026
> ist die Flugansicht die Hauptseite, siehe [FLUG.md](FLUG.md). Die flache Karte ist
> entfallen.

# Die Web-App

Statische Seiten ohne Build, ohne Abhaengigkeitsverwaltung, ausgeliefert ueber GitHub Pages.
Bibliotheken kommen per CDN.

## van.html

Die aktuelle Fassung, 89 KB, alles inline. Wer etwas aendert, aendert hier.

**Laden.** PapaParse holt das Google Sheet als CSV
(`/pub?gid=0&single=true&output=csv`), die Zeilen haben `lat`, `lon`, `time`, `Elevation`.
Zeilen ohne brauchbare Werte fallen raus, der Rest wird nach Zeit sortiert.

**Zusammenfassen.** Zwei Regler steuern die Aufbereitung. `mergeDistance` fasst Punkte
zusammen, die dicht beieinander liegen, `clusterDistance` bildet daraus Haltepunkte. Beides
faengt das Springen zwischen Funkmasten ab.

**Stopps benennen.** Aus der Standzeit an einem Cluster wird eine Art Halt: ab 15 Minuten eine
Pause, ab 60 Minuten ein laengerer Halt, ab 360 Minuten eine Uebernachtung. Die Schwellen sind
im Formular einstellbar und lassen sich per URL vorgeben (`?coffee=20&parking=90&overnight=300`).

**Abspielen.** Ein Marker faehrt die Route ab, Geschwindigkeit ueber einen Regler,
`?autoplay=true` startet von selbst. Darunter laeuft das Hoehenprofil mit.

**Teilen.** `generateShareLink` baut eine URL mit Zeitraum und Einstellungen.

**Passwortfeld.** `password === 'thorsten'`, im Quelltext nachlesbar. Es haelt zufaellige
Besucher ab und sonst nichts. Das Sheet dahinter ist ohne Anmeldung abrufbar.

**Fallbacks.** `loadLibrariesWithFallback` probiert mehrere CDNs durch (cdnjs, jsdelivr,
unpkg), weil die Seite oft aus dem Van ueber eine schwache Mobilverbindung geladen wird.
Fuer Abrufe, die an CORS scheitern, liegen `corsproxy.io` und `allorigins.win` als Umweg bereit.

## index.html mit map.js, elevation.js, utils.js

Die aeltere Fassung, sauber in Module getrennt und funktional hinter `van.html` zurueck.

- `map.js`: Leaflet-Karte, Sheet laden, Route aufbereiten, Animation
- `elevation.js`: Hoehenprofil zeichnen, fehlende Hoehen zwischen Stuetzpunkten interpolieren
- `utils.js`: Haversine-Distanz, Fahrzeit zwischen Punkten, Zeitraumfilter, Teilen-Links,
  Ratenbegrenzung fuer API-Abrufe, Datums- und Zeitformatierung, Marker-Icons

Aufbewahrt, weil die Aufteilung als Vorlage taugt, falls `van.html` einmal zerlegt wird.

## index2.html, ng.html, widget-test.html

`index2.html` ist ein Zwischenstand, `ng.html` ein unfertiger Neuanfang mit dem Titel
"GPS Tracker". `widget-test.html` bindet ein Chat-Widget von einer fremden Domain ein und
gehoert nicht zu dieser App.

## Fremde Dienste

| Dienst | Wofuer |
|---|---|
| Google Sheets (veroeffentlichtes CSV) | die Datenquelle |
| Leaflet, OpenStreetMap, Stamen | Karte und Kacheln |
| PapaParse | CSV lesen |
| localforage | lokaler Zwischenspeicher |
| Font Awesome | Symbole |
| Valhalla (valhalla1.openstreetmap.de) | Strassenrouting mit Faehren, siehe FLUG.md |
| OSRM | Rueckfall, wenn Valhalla nicht antwortet |
| corsproxy.io, allorigins.win | Umweg bei CORS-Sperren |

Alles ohne Schluessel im Quelltext. Die Routing-Dienste laufen ueber ihre freien Kontingente
und koennen bei Ueberschreitung stumm ausfallen.

## Wenn etwas nicht geht

**Karte leer.** Sheet-Abruf pruefen: die CSV-URL direkt im Browser oeffnen. Kommt sie nicht,
ist die Veroeffentlichung des Sheets weg.

**Keine neuen Punkte.** Normal, solange der Van in derselben Funkzelle steht. Der Collector
schreibt nur beim Zellwechsel. Tatsaechlicher Ausfall laesst sich nur auf dem Router pruefen.

**Route springt.** Funkzellenwechsel ohne Bewegung. `mergeDistance` hochsetzen.
