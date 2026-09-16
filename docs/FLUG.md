# Flug über die Strecke

Seit September 2026 ist das die **Hauptseite** (`index.html`). Die frühere flache Karte auf
Leaflet ist entfallen: eine Draufsicht auf dieselbe Karte leistet dasselbe, und zwei Seiten
mit zwei Kartenbibliotheken für dieselben Daten waren doppelte Arbeit. `flug.html` bleibt als
Weiterleitung, damit alte Verweise samt Zeitraum weiter funktionieren.

Mitgenommen wurden: Zeitraumwahl, Link kopieren, das Passwort-Tor und die Zahlenleiste. Dazu
neu die **Draufsicht** (genordet, flach, ganze Reise im Bild) und **Ländergrenzen** zur
Orientierung. Die Liste der Aufenthalte ist entfallen, die Pins in der Karte sagen dasselbe.

Die Grenzen liegen als eigene Vektorquelle über allen drei Belägen (`boundary` aus den
OpenFreeMap-Planet-Kacheln, `admin_level = 2`, ohne Seegrenzen). Satellit und Topografisch
sind reine Rasterkarten und bringen selbst keine mit.

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

## Die Drohne hoppelte über jeden Hügel

Zwei verschiedene Ursachen, nacheinander gefunden.

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

## Der Sägezahn über welligem Land

Danach wackelte die Kamera immer noch, und zwar über Kuppen unter der **Drohnenbahn**, nicht
über Steigungen der Straße. Die Drohne fliegt ja ihre eigene Bahn, das Gelände unter ihr hat
mit der Straße im Tal wenig zu tun.

Das Höhenziel war `max(Boden direkt darunter, Gelände voraus) + Reisehöhe`. Der erste Term
hob es bei jeder Kuppe sofort an, und die Sperrklinke ließ es zügig steigen (0,02) und nur
langsam sinken (0,004). Heraus kam ein Sägezahn.

Jetzt bestimmt allein das Gelände weit voraus die Reisehöhe, stark geträgt (0,010 hoch,
0,002 runter). Einzelne Kuppen fallen dabei unter den Tisch. Dazu eine harte Untergrenze:
kommt der Boden näher als 45 Prozent der Reisehöhe, wird mit 0,08 nachgesteuert. Gestiegen
wird also nur, wenn es sonst eng würde.

Die Regelung lässt sich ohne Grafikkarte prüfen, indem man sie über ein gerechnetes
Geländeprofil laufen lässt: welliges Land mit Kuppen von ±265 m, dazwischen ein Gebirge bis
1.606 m.

```
                Höhenschlag    Richtungswechsel    kleinster Bodenabstand
alt                   755 m                  53                  2.973 m
neu                   264 m                   2                  2.834 m
```

Der Rest von 264 m ist langsame Drift über 150 km, kein Wippen. Das Gebirge wird weiterhin
überflogen.

Das reichte immer noch nicht, und der Grund war ein anderer als gedacht.

## Der eigentliche Grund: die Kamera hing am Gelände

MapLibre heftet den Kartenmittelpunkt ans Gelände. Die Kamera hängt daran und steigt
zwangsläufig mit jedem Hügel darunter, ganz gleich, welche Zoomstufe man setzt. Über den Zoom
lässt sich das nicht ausgleichen: der ändert den Maßstab, nicht die Lage im Bild.

Seit Fassung 5 lässt sich die Kopplung lösen. `setCenterClampedToGround(false)` und
`setCenterElevation()` gibt es in 4.7.1 noch nicht, in 5.0.0 und 5.6.1 schon. Die Seite läuft
deshalb auf **5.6.1**.

Während des Flugs bekommt der Mittelpunkt die geplante Höhe statt des echten Geländes. Damit
kann die Zoomstufe auch fest bleiben, die Höhe steckt ja im Mittelpunkt.

Gemessen über einen Flug, Gelände unter der Drohne mit 763 m Höhenunterschied:

```
                     Spanne    Richtungswechsel
Boden darunter        763 m                  22
Flughöhe              933 m                   2
Zoomstufe               0,0                   0
Neigung              1,28 °                   2
```

Der Boden wellt sich, die Kamera nicht.

## Die Höhe wird geplant, nicht geregelt

Jede Regelung, die im Flug auf das Gelände unter der Kamera reagiert, steigt über jede Kuppe
und sinkt dahinter wieder. Eine Drohne tut das nicht. Sie hält eine Höhe, solange nichts im
Weg ist.

Die Höhe wird deshalb vor dem Start geplant, über das ganze Geländeprofil auf einmal:

1. Das Profil kommt aus denselben Terrarium-Kacheln wie die Landschaft, auf Zoomstufe 9. Für
   eine Reiseflughöhe reichen gut zweihundert Meter Auflösung. Für die Balkanreise sind das
   1.201 Stützpunkte zwischen −48 m und 2.365 m, ein paar Dutzend Kacheln, die beim Laden der
   Seite im Hintergrund kommen.
2. Laufendes Maximum über ein breites Fenster. Alle Kuppen, die schmaler sind als das
   Fenster, verschwinden, übrig bleibt die Hüllkurve des Gebirges.
3. Symmetrische Glättung, drei Durchgänge. Weil offline gerechnet wird, schaut sie nach vorn
   und nach hinten. Kein Nachlauf, kein Sägezahn.
4. Zum Schluss die Mindesthöhe über der Hüllkurve erzwingen, damit die Glättung nirgends in
   einen Berg hineinläuft.

Im Flug wird der Plan nur noch abgelesen. Dazu eine harte Untergrenze gegen das echte
Gelände, weil das Profil grob abgetastet ist und ein einzelner Grat darin fehlen kann.

Über das echte Gelände der Balkanreise, 3.521 km:

```
Boden                   -48 .. 2.365 m
Richtungswechsel der geplanten Höhe        0
Strecke mit unter 5 m Höhenänderung je km   87 %
```

Die Neigung kommt aus demselben Plan. Vorher hing sie am Boden direkt unter der Kamera und
zappelte mit bis zu 7 Grad mit.

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

In der Flugansicht bekommt jedes Fährstück eine eigene Quelle mit `lineMetrics`, weil ein
Farbverlauf immer die ganze Quelle betrifft und jedes Stück seinen eigenen Streckenstand
hat. Gezeichnet wird die klassische Fährsignatur: blaue Linie, weiße Striche darüber. Die
Freigabe während des Flugs läuft mit, der Gesamtanteil wird dafür auf den Anteil innerhalb
des Stücks umgerechnet.

Am Drin sind das 32 km von Koman nach Fierzë, bei Streckenkilometer 261 bis 293.

Der Schlüssel im Zwischenspeicher steht deshalb auf `r3`. Einträge von vorher stammen von
einem Router ohne Fähren und werden nicht mehr benutzt.

Die Geometrie kommt als Polyline mit sechs Nachkommastellen und wird in `analyse.js`
dekodiert. Der Gemeinschaftsserver drosselt bei zu vielen Anfragen; bei 429 oder 5xx wird
bis zu dreimal mit wachsender Pause neu gefragt, gleichzeitig laufen höchstens drei Anfragen.

## Kacheln vorwärmen

MapLibre lädt immer nur, was gerade im Bild ist. Im Flug heißt das: Details tauchen auf,
wenn man schon darüber ist. Ein Vorladen lässt sich nicht anweisen, aber der Browser hat
einen Zwischenspeicher.

Gewärmt wird entlang der Flugbahn, an drei Punkten voraus mit je einem Ring von neun
Kacheln. Die Zoomstufe wird nicht geraten, sondern aus den Anfragen gelernt, die die Karte
selbst stellt (`transformRequest`, Adresse gegen die Kachelvorlage gematcht). Dazu jeweils die
nächstgröbere Stufe, denn solange die feine Kachel lädt, zeigt die Karte die gröbere.

Über 45 Sekunden Flug gemessen:

```
ohne Vorwärmen      848 Kachelanfragen,   0 aus dem Vorrat
mit Vorwärmen     1.017 Kachelanfragen, 440 aus dem Vorrat   (43 %)
```

**Standardmäßig aus.** Ob es sichtbar hilft, ließ sich nicht messen: der Software-Renderer
wartet in beiden Fällen die ganze Zeit auf Kacheln, er ist selbst der Engpass. Belegt ist nur
die Trefferquote, und der Verkehr verdoppelt sich dabei. Einschalten mit `?warm=an`.

## Schwarze Keile im Bild

Über dem Bergkamm und mitten in der Landschaft standen schwarze Flächen mit scharfem Rand.

Es war der Himmel, oder genauer sein Fehlen. `atmosphere-blend` lief in der Einstellung ab
Zoom 13 auf null, dann zeichnet MapLibre gar keinen Himmel mehr und der dunkle Hintergrund
der Seite bleibt stehen. Auf der langsamsten Stufe fliegt die Kamera bei Zoom 14, also genau
dort. Durch jedes Loch im Gelände war dieselbe schwarze Fläche zu sehen.

Drei Änderungen:

1. `atmosphere-blend` bleibt überall deutlich über null.
2. Der Untergrund der Karte ist ein Himmelsverlauf statt der dunklen Seitenfarbe, dazu eine
   Hintergrundebene in den beiden Rasterbelägen. Was nicht gezeichnet wird, sieht damit nach
   Himmel aus und nicht nach Loch.
3. Die höchste Höhenstufe geht von 15 auf 13. Weiter oben fehlen einzelne Kacheln, und jede
   fehlende ist ein Loch im Gelände. Für die Form reicht 13 auch im Tiefflug.

Gemessen als Anteil sehr dunkler Bildpunkte im schlimmsten Bild eines Flugs: **12,3 Prozent
vorher, 4,8 Prozent nachher**, und der Rest davon ist das Bedienfeld.

## Die Strecke bleibt im Bild

Die Drohnenbahn glättet die Straße, damit die Kamera keine Serpentine mitfliegt. Bei starken
Kurven lief sie dadurch weit daneben: gemessen 19,9 km Abweichung im oberen Zehntel und bis
zu 45,6 km, bei 35,7 km Sichtbreite auf der Vorgabestufe. Die Strecke wanderte dann aus dem
Bild.

Die Kamera wird deshalb in einen Korridor um die Straße eingefangen, halb so breit wie das
halbe Bild. Die Korridorbreite hängt an der aktuellen Sichtbreite, also mittelbar am Tempo:
schnell und hoch darf sie weit ausholen, langsam und tief nicht. Dazu ein Sicherheitsnetz:
macht die Straße im Blickfeld trotzdem einen weiten Bogen, wird gedämpft herausgezoomt,
höchstens um zweieinhalb Stufen.

## Bedienung

Zeitraum über die beiden Datumsfelder oder über `?start=` und `?end=`, Belag über
`?belag=satellit|topo|outdoor`, Grenzen über `?grenzen=aus`. Ein Wechsel des Zeitraums lädt
die Seite neu: Strecke, Geländeprofil und Höhenplan hängen alle daran.

### Höhe im Flug ändern

Zwei Wege, beide wirken sofort:

**Zoom.** Mausrad oder zwei Finger auf der Karte heben und senken die Kamera. Während des
Flugs setzt die Schleife die Zoomstufe in jedem Bild neu, ein gewöhnlicher Kartenzoom wäre
im nächsten Bild wieder weg. Die eigenen Zoomgesten von MapLibre sind deshalb während des
Flugs abgeschaltet, und Rad beziehungsweise Fingerabstand werden auf einen Versatz gerechnet,
den die Schleife auf ihre Zoomstufe legt, gedämpft und begrenzt auf −3 bis +4,5 Stufen. Nach
dem Flug sind die normalen Gesten wieder da.

**Höhenüberhöhung.** In Stufen von flach über 1,0× bis 15×, um die Eins herum fein
abgestuft. 15-fach macht aus einem Mittelgebirge eine Wand.

Wichtig dabei: `queryTerrainElevation` liefert **überhöhte** Werte, gemessen 184 m, 367 m und
735 m für denselben Punkt bei 1×, 2× und 4×. Der Höhenplan wird aus rohen Metern der
Terrarium-Kacheln gebaut und deshalb mit demselben Faktor skaliert, sonst flöge die Kamera
bei starker Überhöhung durch die Berge. Beim Verstellen wird er neu gerechnet, das kostet
Millisekunden.

Bei 8-facher Überhöhung über Albanien gemessen: Gelände bis 8.794 m, kleinster Abstand zur
Kamera 7.975 m, kein einziges Bild unter null.

### Ohne Zeitraum

Die Seite rechnet dann **nichts**, sondern fragt nach einem Zeitraum und nennt, welche
Aufzeichnungen vorliegen.

Vorher wertete sie den kompletten Bestand aus. Gemessen: 406 Abschnitte, 189 Routenanfragen
an den Gemeinschaftsserver, 196 Sekunden Wartezeit. Das Ergebnis war dazu falsch, weil Punkte
quer über Monate hinweg zu Fahrten verbunden wurden: 15.580 km und 1.000 km Fähre für
fünfzehn Monate, in denen der Van die meiste Zeit zu Hause stand.

Beide Felder müssen gefüllt sein. Nur `?start=` oder nur `?end=` führt ebenfalls auf die
Abfrage, mit dem vorhandenen Wert vorbelegt. Der Hinweis auf den vorhandenen Bereich kostet
nur die 20 KB der Tabelle, keine einzige Routenanfrage.

### Auf dem Handy

Das Bedienfeld wird zur Schublade am unteren Rand und startet eingeklappt, sonst deckt es die
halbe Karte zu. Beim Flugstart klappt es von selbst zu. Eingeklappt steht dort nicht der
Titel, sondern der **Tempo-Regler**: im Flug ist das Tempo das Einzige, was man laufend
anfassen will. Der Pfeil zum Aufklappen sitzt in der Ecke. Die Zahlenleiste steht oben links und
zeigt dort nur Kilometer, Halte und Fähre, die volle Liste bräuchte drei Zeilen. Das Klappfeld
bleibt oben rechts, sein Fach ist auf 64 Prozent der Schirmbreite begrenzt. Die Fluganzeige
legt sich als schmaler Streifen über die Schublade.

Geprüft auf iPhone 13 (390 × 664) und Pixel 5 (393 × 727): kein Querlauf, alle Bedienelemente
erreichbar, Schublade eingeklappt 47 px hoch.

Vor dem Flug liegt die Karte genordet und flach da, wie eine gewöhnliche Karte. Erst beim
Start kippt sie in die Fluglage und dreht auf den ersten Kurs. Nach dem Flug geht sie wieder
genordet auf die ganze Strecke.

Links unten die Fahrt: Dauer und Start. Oben rechts, wie im Schwesterprojekt vantrip, die
Ansicht: **Karte** für den Belag, **Sicht** für Kamerawinkel und Höhenüberhöhung. Immer nur
ein Fach offen.

Die Dauer reicht von **30 Minuten bis 8 Sekunden** für die ganze Reise, in fünfzehn Stufen.
Da sich die Flughöhe aus der Geschwindigkeit ergibt, ist das zugleich der Höhenregler:
langsam heißt tief und nah an der Straße, schnell heißt hoch und weit.

Der Regler wirkt **mitten im Flug**. Dafür wird der Fortschritt als Anteil mitgeführt und
nicht aus der Startzeit gerechnet, sonst spränge die Drohne beim Umstellen vor oder zurück.
Höhe und Höhenplan werden mitgezogen, der Zoom wandert weich auf den neuen Wert. Gemessen:
0,8 km/s auf Stufe 4, nach dem Umstellen 9,3 km/s auf Stufe 11, zurück auf 1,0 km/s, ohne
Sprung in der Strecke.

**Pause** hält den Flug an und gibt ihn wieder frei. Die Schleife läuft dabei weiter, sonst
ließe sich die Karte nicht mehr drehen. **Stopp** beendet ihn und zeigt wieder alles.

Vorgaben: **10 Minuten**, Kamerawinkel **53 Grad**, Höhenüberhöhung **1,0×**, Belag
**Satellit**.

## Halte

An jedem Aufenthalt verweilt die Drohne drei Sekunden. Der Halt steckt als Pin in der
Landschaft, ohne Beschriftung:

| Dauer | Sinnbild |
|---|---|
| unter 1 h | Pausenzeichen |
| 1 bis 6 h, oder länger am Tag | P |
| ab 6 h nachts | Zelt mit der Zahl der Nächte |

Die Zahl der Nächte ist die Zahl der Datumswechsel in Ortszeit, nicht die Dauer geteilt durch
24. Ein Aufenthalt vom 26. bis zum 29. Juli zählt drei Nächte.

Die Pins sind gezeichnete Bilder, keine Textebenen. Zwei der drei Beläge sind reine
Rasterkarten ohne Schriftarten, eine Textebene bliebe dort leer. Räumlich wirken sie über
einen Farbverlauf von oben links, ein Glanzlicht, einen dunklen Rand, einen Schaft und einen
Schatten auf dem Boden. Mit dem Zoom wachsen sie von einfacher auf 1,7-fache Größe.

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
