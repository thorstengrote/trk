# Flug über die Strecke

`flug.html`, ein Prototyp: die gefahrene Strecke aus der Drohnenperspektive über echtem
Gelände, mit topografischer Karte darüber.

## Warum das lange nicht ging

Drei Dinge mussten zusammenkommen, und eines davon war der Stolperstein.

**Gelände im Browser** kann MapLibre GL seit Version 2 (`setTerrain`). Das ist der offene
Nachfolger von Mapbox GL und braucht keinen Schluessel.

**Topografische Karte** liefert OpenTopoMap als Rasterkacheln, mit Hoehenlinien und
Schummerung, frei und ohne Schluessel.

**Hoehendaten** sind der Haken. Die freie Quelle sind die Terrain Tiles auf AWS Open Data im
Terrarium-Format. Sie liefern die ganze Welt, aber **ohne CORS-Header**. WebGL muss die
Pixelwerte auslesen, und das verbietet der Browser ohne CORS. Gemessen am 16.09.2026:

```
s3.amazonaws.com/elevation-tiles-prod/...            HTTP 200  ACAO: FEHLT
elevation-tiles-prod.s3.amazonaws.com/...            HTTP 200  ACAO: FEHLT
elevation-tiles-prod.s3.dualstack.us-east-1.../...   HTTP 200  ACAO: FEHLT
```

MapLibres eigener Demo-Dienst hat CORS, deckt aber nur eine einzige Gradzelle in Tirol ab
(`jaxa_terrainrgb_N047E011`). Alle anderen brauchbaren Quellen wollen einen API-Schluessel.

**Der Ausweg:** die Kacheln fuer den Streckenkorridor einmal herunterladen und neben die Seite
legen. GitHub Pages liefert sie mit `access-control-allow-origin: *` aus. Kein Schluessel,
keine fremde Abhaengigkeit, und fuer eine Reise sind es ueberschaubar viele.

## Höhendaten holen

```
werkzeug/hoehenkorridor.py route.json --zoom 11 --rand 3 --ziel dem
```

`route.json` ist eine Liste von `[lat, lon]`. Die bekommt man aus der laufenden Karte:

```js
// in der Browserkonsole auf index.html
JSON.stringify(vanspur.erg.segs.filter(s=>s?.geo).flatMap(s=>s.geo))
```

Das Werkzeug fuellt zwischen weit auseinanderliegenden Punkten auf, sonst entstehen Loecher.

**Groesse fuer die Balkanreise 2026**, 1343 Stuetzpunkte ueber 3434 km:

| Zoom | Kachelbreite | Rand | Kacheln | Umfang |
|---:|---:|---:|---:|---:|
| 6 | 626 km | 1 | 20 | 2 MB |
| 7 | 313 km | 1 | 32 | 3 MB |
| 8 | 157 km | 1 | 69 | 6 MB |
| 9 | 78 km | 2 | 227 | 21 MB |
| 10 | 39 km | 2 | 490 | 45 MB |
| 11 | 20 km | 3 | 1398 | 130 MB |

Bis Zoom 10 sind es 77 MB bei rund 150 m Aufloesung, mit Zoom 11 sind es 207 MB bei 76 m.
Fuer einen Blick aus der Drohne reicht Zoom 10 gut aus.

Fehlen die Daten, bleibt die Karte flach und sagt es in einer Hinweiszeile.

## Geprüft

Die Dekodierung stimmt. Unabhaengig von der Karte aus den Kacheln gelesen:

```
Sibiu, Rumaenien    413,7 m   (real ~415 m)
Fagaras-Gebirge    2179,9 m   (Hochgebirge, plausibel)
```

Das Gelaende rendert, die Strecke legt sich ins Tal, die Hoehenanzeige laeuft mit.

**Offen:** Die Fluganimation liess sich nur im Software-Renderer testen, und der schafft das
Nachladen der Kacheln nicht, wenn die Kamera 60 Mal je Sekunde springt. Auf einem Geraet mit
Grafikhardware sollte das anders aussehen, belegt ist es nicht.

## Quellen nennen

Hoehendaten: Terrain Tiles auf AWS Open Data (unter anderem SRTM und ASTER).
Karte: OpenTopoMap (CC-BY-SA), Daten von OpenStreetMap und SRTM.
