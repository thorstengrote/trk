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

Gemessen über einen Flug, Kursänderung je Bild: Mittelwert 1,41 Grad in der ersten Fassung,
dann 0,84, jetzt **0,64**.

Stellschrauben dafür: Stützpunktabstand (3,5 Prozent der Strecke, mindestens 12 km) und
Dämpfung des Kurses (0,028).

## Nicht durch Berge fliegen

Die Kamera saß auf einer Zoomstufe, nicht auf einer Höhe. MapLibre leitet daraus zwar eine
Höhe ab, die weiß aber nichts vom Gelände, und bei 1,8-facher Überhöhung ragen Gipfel dann
durchs Bild.

Jetzt wird das Gelände **weit voraus** abgetastet, an sechs Stellen bis zum Dreifachen der
Blickweite. Ein kurzer Horizont ließ die Kamera über jeden Grat wippen; über einen langen
steigt sie einmal vor dem Gebirge und bleibt oben.

Dazu eine Sperrklinke: steigen darf sie zügig (Dämpfung 0,02), sinken nur sehr langsam
(0,004). Und die Ausschläge sind klein gehalten, höchstens 0,8 Zoomstufen und 7 Grad Neigung.

Ergebnis über einen kompletten Flug: die Zoomstufe wandert um **0,42**, die Neigung um
**3,4 Grad**. Je Bild sind es im Mittel 0,002 Stufen und 0,016 Grad.

Sauberer wäre eine freie Kamera mit echter Höhenangabe, wie Mapbox sie hat. MapLibre hat sie
nicht, geprüft in 4.7.1, 5.0.0 und 5.6.1. Das Abtasten ist deshalb eine Minderung, keine
Garantie.

## Der Höhenschlag über der Straße

Die Kamera stieg und sank mit jeder Steigung der Straße. Der Grund steckte in einer
Vermischung zweier Bodenwerte.

MapLibre setzt die Kamera zu einer Zoomstufe immer relativ zum echten Gelände unter dem
Bildmittelpunkt. Die Zoomstufe wurde aber gegen einen stark geglätteten Bodenwert gerechnet,
weil der auch das Ziel der Reiseflughöhe bestimmt. Die Differenz beider Werte landete
eins zu eins als Höhenschlag im Bild.

Jetzt laufen zwei Werte nebeneinander: `grundHart` folgt dem Gelände fast unverzögert
(Dämpfung 0,55) und geht in die Zoomrechnung, `grundGlatt` läuft träge (0,12) und bestimmt
nur, welche Höhe angepeilt wird.

Gemessen aus der Animationsschleife heraus über die komplette Reise, 1.321 m Höhenunterschied
am Boden:

```
Zoomstufe, Spanne über den ganzen Flug     0,08
absolute Flughöhe, Änderung je Bild        unter 1 Promille
```

Die Höhe über Grund folgt dem Gelände, die absolute Flughöhe bleibt liegen. Genau
andersherum als vorher.

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

## Fähren gehören zum Verkehrsnetz

Am Drin bei Shkodra führte die gezeichnete Strecke weit an der Drohne vorbei zurück, weil der
Van dort die Fähre genommen hat und der Router sie nicht kannte.

Die Fähren stehen in OpenStreetMap. Der öffentliche OSRM-Demoserver benutzt sie am Drin
nicht, obwohl er es andernorts tut (Villa San Giovanni nach Messina erkennt er). Gerechnet
wird deshalb über **Valhalla** (`valhalla1.openstreetmap.de`) mit `use_ferry: 1`, also ohne
Strafaufschlag auf die Überfahrt. OSRM bleibt als Rückfall, falls Valhalla nicht antwortet.

| Strecke | OSRM | Valhalla |
|---|---|---|
| Shkodra nach Gjakova | 203 km, keine Fähre | 110 km, davon 32,2 km Fähre |
| Koman nach Fierzë | 270 km ums Wasser herum | 43 km über die Fähre |

Das ist keine Ausnahme für diesen Ort, sondern ein Wechsel des Routers. Valhalla liefert
zusätzlich die Fährabschnitte einzeln zurück (`begin_shape_index` je Manöver), die
Kartenansicht zeichnet sie gepunktet in Wasserfarbe.

Der Schlüssel im Zwischenspeicher steht deshalb auf `r3`. Einträge von vorher stammen von
einem Router ohne Fähren und werden nicht mehr benutzt.

Die Geometrie kommt als Polyline mit sechs Nachkommastellen und wird in `analyse.js`
dekodiert. Der Gemeinschaftsserver drosselt bei zu vielen Anfragen; bei 429 oder 5xx wird
bis zu dreimal mit wachsender Pause neu gefragt, gleichzeitig laufen höchstens drei Anfragen.

## Bedienung

Zeitraum über `?start=` und `?end=` wie bei der Karte, Belag über `?belag=satellit|topo|outdoor`.

Vor dem Flug liegt die Karte genordet und flach da, wie eine gewöhnliche Karte. Erst beim
Start kippt sie in die Fluglage und dreht auf den ersten Kurs. Nach dem Flug geht sie wieder
genordet auf die ganze Strecke.

Links unten die Fahrt: Dauer und Start. Oben rechts, wie im Schwesterprojekt vantrip, die
Ansicht: **Karte** für den Belag, **Sicht** für Kamerawinkel und Höhenüberhöhung. Immer nur
ein Fach offen.

Die Dauer reicht von **30 Minuten bis 8 Sekunden** für die ganze Reise, in fünfzehn Stufen.
Da sich die Flughöhe aus der Geschwindigkeit ergibt, ist das zugleich der Höhenregler:
langsam heißt tief und nah an der Straße, schnell heißt hoch und weit. Vorgabe sind
3:30 Minuten.

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
