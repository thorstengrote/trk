# Flug über die Strecke

`flug.html`: die gefahrene Strecke aus der Drohnenperspektive über echtem Gelände, mit
topografischer Karte darüber. Ohne API-Schlüssel, ohne Vorbereitung, für jeden Zeitraum.

## Wie es zusammengesetzt ist

| Baustein | Quelle |
|---|---|
| 3D-Gelände | MapLibre GL `setTerrain` |
| Höhendaten | Terrain Tiles auf AWS Open Data, Terrarium-Format, frei und ohne Schlüssel |
| Karte | OpenTopoMap, Höhenlinien und Schummerung |
| Strecke | dieselbe Auswertung wie `index.html`, siehe `analyse.js` |

```js
tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
encoding: 'terrarium', tileSize: 256, maxzoom: 15
```

Das ist alles. Die Kacheln kommen mit `Access-Control-Allow-Origin: *`, WebGL darf sie also
auslesen.

## Ein Irrweg, den man sich sparen kann

Beim Bauen hatte ich die Quelle zunächst als unbrauchbar verworfen, weil mein Prüfbefehl
keinen CORS-Header fand, und daraufhin einen ganzen Apparat gebaut: die Kacheln für den
Streckenkorridor vorab herunterladen und neben die Seite legen.

Der Prüfbefehl war falsch. Er filterte mit `awk` und `IGNORECASE`, das kennt aber nur GNU-awk;
auf macOS läuft BSD-awk und ignoriert die Einstellung stillschweigend. S3 antwortet über
HTTP/1.1 mit **groß** geschriebenen Headernamen, das Muster `^access-control-allow-origin`
traf deshalb nie. Über HTTP/2 kommen Headernamen klein zurück, weshalb dieselbe Prüfung bei
anderen Anbietern scheinbar funktionierte.

Richtig geprüft:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
```

Merke: CORS-Header nie mit `awk`+`IGNORECASE` suchen, sondern mit `grep -i`. Und im Zweifel
im Browser prüfen statt mit curl.

## Vorladen, falls doch einmal gewünscht

`werkzeug/hoehenkorridor.py` lädt den Korridor einer Strecke herunter. Gebraucht wird das nur
noch, wenn die Reise **ohne Netz** anschaubar sein soll, etwa im Van selbst. Dann
`flug.html?dem=lokal` aufrufen.

```
werkzeug/hoehenkorridor.py route.json --zoom 11 --rand 3 --ziel dem
```

Umfang für die Balkanreise: 77 MB bis Zoom 10, 207 MB mit Zoom 11. Für den Normalfall ist das
überflüssig, die Kacheln kommen direkt aus dem Netz.

## Bedienung

Zeitraum über `?start=` und `?end=` wie bei der Karte. Regler für Spieldauer, Kamerawinkel und
Höhenüberhöhung. Die Kamera fährt die Strecke in Fahrtrichtung ab, die Höhe unter dem
Fahrzeug läuft mit.

## Geprüft

Die Dekodierung stimmt, unabhängig aus den Kacheln gelesen:

```
Sibiu, Rumänien     413,7 m   (real ~415 m)
Fagaras-Gebirge    2179,9 m
```

**Offen:** Die Fluganimation ließ sich nur im Software-Renderer testen, und der schafft das
Nachladen der Kacheln nicht, wenn die Kamera 60 Mal je Sekunde springt. Auf einem Gerät mit
Grafikhardware sollte das anders aussehen, belegt ist es nicht.

## Quellen nennen

Höhendaten: Terrain Tiles auf AWS Open Data (unter anderem SRTM und ASTER).
Karte: OpenTopoMap (CC-BY-SA), Daten von OpenStreetMap und SRTM.
