# Flug über die Strecke

`flug.html`: die gefahrene Strecke aus der Drohnenperspektive über echtem Gelände, mit
topografischer Karte darüber. Ohne API-Schlüssel, ohne Vorbereitung, für jeden Zeitraum.

## Wie es zusammengesetzt ist

| Baustein | Quelle |
|---|---|
| 3D-Gelände | MapLibre GL `setTerrain` |
| Höhendaten | Terrain Tiles auf AWS Open Data, Terrarium-Format, frei und ohne Schlüssel |
| Karte | drei Beläge zur Wahl, siehe unten |
| Strecke | dieselbe Auswertung wie `index.html`, siehe `analyse.js` |

```js
tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
encoding: 'terrarium', tileSize: 256, maxzoom: 15
```

Das ist alles. Die Kacheln kommen mit `Access-Control-Allow-Origin: *`, WebGL darf sie also
auslesen.

## Beläge

| | Quelle | wofür |
|---|---|---|
| Satellit | Esri World Imagery | die plastischste Ansicht, Vorgabe |
| Topografisch | OpenTopoMap | Höhenlinien, Wege, Hütten |
| Outdoor | OpenFreeMap liberty plus Schummerung | Vektorstil, bleibt beim Kippen scharf |

Alle drei ohne Schlüssel. Umschalten wechselt den Stil und setzt Gelände, Himmel, Strecke und
Aufenthalte danach neu, die hängen nicht am Belag.

Übernommen aus dem Schwesterprojekt **vantrip**, das genau diese Kombination seit Monaten
fährt. Dort steht auch der Hinweis, der den Irrweg unten aufgelöst hat.

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

Zweite Lehre: vantrip benutzt dieselbe Adresse seit Monaten erfolgreich. Ein Blick ins eigene
Schwesterprojekt hätte den Umweg erspart.

## Vorladen, falls doch einmal gewünscht

`werkzeug/hoehenkorridor.py` lädt den Korridor einer Strecke herunter. Gebraucht wird das nur
noch, wenn die Reise **ohne Netz** anschaubar sein soll, etwa im Van selbst. Dann
`flug.html?dem=lokal` aufrufen.

```
werkzeug/hoehenkorridor.py route.json --zoom 11 --rand 3 --ziel dem
```

Umfang für die Balkanreise: 77 MB bis Zoom 10, 207 MB mit Zoom 11. Für den Normalfall ist das
überflüssig, die Kacheln kommen direkt aus dem Netz.

## Kameraführung

Die Drohne folgt der Straße **nicht**. Sie hat eine eigene Bahn: die Strecke wird weit
abgetastet, ein Stützpunkt etwa alle zwei Prozent der Gesamtlänge, mindestens alle 6 km.
Dazwischen zieht eine Catmull-Rom-Kurve durch. Aus zehntausenden Straßenpunkten werden so
einige Dutzend Wegpunkte, und Serpentinen verschwinden vollständig. Die gezeichnete Strecke
bleibt davon unberührt und liegt weiter exakt auf der Straße.

Der Blick geht nach vorn, auf einen Punkt in einiger Entfernung auf derselben Bahn, und der
Kurs wird gedämpft nachgeführt.

Gemessen über einen Flug, Kursänderung je Bild:

| | vorher | jetzt |
|---|---:|---:|
| Mittelwert | 1,41° | **0,84°** |
| 95-Prozent-Fall | 3,95° | **2,58°** |
| größter | 5,23° | **2,84°** |

## Nicht durch Berge fliegen

Die Kamera saß auf einer Zoomstufe, nicht auf einer Höhe. MapLibre leitet daraus zwar eine
Höhe ab, die weiß aber nichts vom Gelände, und bei 1,8-facher Überhöhung ragen Gipfel dann
durchs Bild.

Jetzt wird das Gelände zwischen Kamera und Blickziel an vier Stellen abgetastet. Steigt es an,
geht die Kamera höher (bis zu 1,5 Zoomstufen) und richtet sich flacher aus (bis zu 22 Grad
weniger Neigung), beides gedämpft nachgeführt.

Sauberer wäre eine freie Kamera mit echter Höhenangabe, wie Mapbox sie hat. MapLibre hat sie
nicht, geprüft in 4.7.1, 5.0.0 und 5.6.1. Das Abtasten ist deshalb eine Minderung, keine
Garantie.

## Die Straße kurvt wirklich

Die Routenabfrage holte bis dahin `overview=simplified`, eine vereinfachte Geometrie mit
langen Geraden und scharfen Ecken. Im Tiefflug sah das aus wie Zickzack. Jetzt kommt
`overview=full`.

Für dieselbe Woche: 27.474 Stützpunkte statt einiger hundert, mittlerer Abstand 16 m,
mittlerer Knick zwischen zwei Punkten 3,3 Grad. Der Schlüssel im Zwischenspeicher hat deshalb
eine Versionskennung bekommen, alte Einträge werden nicht mehr benutzt.

Die Positionssuche auf der Bahn läuft seitdem über eine binäre Suche. Linear durchlaufen
wären es bei dreimal je Bild und zehntausenden Punkten Millionen Schritte je Sekunde.

Wie in der Kartenansicht wird nichts vorweggenommen: beim Start verschwinden Strecke und
Aufenthalte, die Spur wächst hinter der Drohne, die Aufenthalte tauchen beim Passieren auf.
Am Ende ist wieder alles zu sehen.

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
