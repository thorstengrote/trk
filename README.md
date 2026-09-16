# trk

Wo war der Van wann. Eine Karte, die die Reisen eines Familien-Vans nachzeichnet, gespeist aus
dem Router im Fahrzeug.

Live: <https://thorstengrote.github.io/trk/>

## Wie es zusammenhaengt

```
 GL-X750 im Van
 │  alle 15 Minuten:  AT+QENG="servingcell"  ──> Funkzelle
 │                    UnwiredLabs ──> lat/lon + Genauigkeitsradius
 │                    open-elevation ──> Hoehe
 └──────────────────> Google Sheet (als CSV veroeffentlicht)
                                │
                        index.html + analyse.js im Browser
                                │
                        OSRM ──> Strassenroute je Abschnitt
                                │
                        Karte, Aufenthalte, Fahrt abspielen
```

Kein eigener Server. Der Router schreibt, das Sheet haelt, der Browser rechnet.

## Die Dateien

| Datei | Was es ist |
|---|---|
| `index.html` | die App: Karte, Bedienfeld, Aufenthaltsliste, Fahrtanimation |
| `analyse.js` | die Auswertung. Hier steckt die eigentliche Arbeit. |
| `router/update_location_and_sheet.sh` | der Teil, der im Van laeuft |
| `alt/` | die vier Vorgaengerfassungen, nur noch als Nachschlagewerk |

## Warum neu gebaut

Die Vorgaengerfassung fand auf der Sommerreise 2026 **null** Aufenthalte, obwohl in den Daten
dreizehn stecken. Auf der dichtesten Fahrt (75 Punkte in vier Tagen) fand sie genau einen.

Die Ursache: sie mass die Standzeit **innerhalb** einer Punktgruppe. Die Daten speichern die
Standzeit aber **zwischen** den Punkten, weil der Collector nur bei einem Zellwechsel schreibt.
Ein Halt erzeugt genau einen Punkt, die Gruppe hat damit die Dauer null, und es entstand kein
Eintrag. 68 Prozent aller Gruppen bestanden aus einem einzigen Punkt.

Kein Wert im damaligen Parameterdialog konnte das aendern. Deshalb ist der Dialog weg.

Zwei weitere Fehler der alten Fassung: sie holte die Daten ueber `export?format=csv`, was im
Browser an CORS scheitert, und fiel dann still auf eingebaute Beispieldaten vom Februar 2025
zurueck. Und sie zog Aufenthalte per `roadSnapDistance = 5000` bis zu fuenf Kilometer weit auf
"nahe" Punkte, was an einer Kueste im Wasser endet.

## Wie die Auswertung arbeitet

**1. Ping-Pong entfernen.** Zwei benachbarte Masten uebernehmen abwechselnd, ohne dass der Van
sich bewegt. Gemessen: 14 solche Spruenge mit im Mittel 8,2 km Ausschlag. Punkte, deren
Vorgaenger und Nachfolger am selben Ort liegen, werden verworfen und ihre Zeit dem Vorgaenger
zugeschlagen.

**2. Abschnitte klassifizieren.** Fuer jeden Abschnitt wird die Strassenroute berechnet. Der
Vergleich von vergangener Zeit und Sollfahrzeit sagt, was passiert ist:

```
Luftlinie < 1,5 km                 -> gestanden
vergangen − Sollfahrzeit < 15 min  -> durchgefahren
vergangen − Sollfahrzeit > 15 min  -> gefahren und unterwegs gehalten
```

**3. Halte zusammenfassen.** Aufeinanderfolgende Halte am selben Ort werden zu einem
Aufenthalt. Ohne das zerfiel eine zweitaegige Pause in "2,2 h" plus "71,9 h".

**4. Position schaetzen.** Bei einem Halt unterwegs ist der Funkturm nicht der Aufenthaltsort.
Genommen wird der Punkt auf der berechneten Route, der dem Turm am naechsten liegt, typisch
15 bis 300 Meter daneben. **Ab sechs Stunden Aufenthalt wird nicht mehr auf die Route gezogen**:
wer drei Tage steht, steht nicht auf der Durchgangsstrasse. Dann bleibt die Zellposition, und
die Karte sagt dazu, dass sie nur auf Funkzelle genau ist.

Ergebnis auf derselben Sommerreise: 21 Aufenthalte statt null, 3434 km ueber Strassen statt
2246 km Luftlinie.

## Bedienung

Zeitraum waehlen, **Anzeigen**. Beim Aufruf ist die Strecke **verdeckt**: die Karte zeigt nur,
wo die Reise losgeht. Sonst waere schon alles verraten, bevor man die Fahrt gesehen hat.
Aufgedeckt wird sie durch **Fahrt abspielen**, durch den Umschalter **Strecke** oder durch
einen Klick auf einen Aufenthalt in der Liste.

Die Umschalter blenden ausserdem Messpunkte und Genauigkeitskreise ein.

**Fahrt abspielen** laesst die ganze Reise in wenigen Sekunden ablaufen, einstellbar von 8 bis
100 Sekunden. Nicht in Echtzeit: bei einem zweitaegigen Aufenthalt saesse man sonst zwei Tage
davor. Vorgerueckt wird nach zurueckgelegter Strecke, an jedem Aufenthalt haelt der Van kurz
an und das Symbol erscheint. Rund ein Drittel der Spielzeit gehoert diesen Haltepausen, damit
die eingestellte Gesamtdauer auch stimmt.

Die Strecke waechst dabei hinter dem Van, statt vorher schon dazuliegen. Der Kartenausschnitt
bleibt der Ueberblick.

Zeitraum im Link: `?start=2026-07-18&end=2026-08-06`.
Ohne Parameter sucht die Seite selbst einen Zeitraum, in dem genug Bewegung liegt.

Die Routen werden nach der ersten Berechnung im Browser zwischengespeichert. Der erste Aufruf
eines Zeitraums dauert daher laenger als der zweite.

## Was man wissen sollte

**Die Genauigkeit ist die einer Funkzelle**, je nach Mastdichte einige hundert Meter bis
mehrere Kilometer. Seit dem 15.09.2026 schreibt der Collector den Genauigkeitsradius mit, den
der Ortungsdienst liefert; der Umschalter "Genauigkeit" zeigt ihn als Kreis.

**Neue Punkte entstehen nur beim Zellwechsel.** Steht der Van, schreibt der Collector nichts.
Eine Luecke im Sheet und ein ausgeschalteter Router sehen darin gleich aus. Wer wissen will,
was wirklich war, schaut ins Protokoll auf dem Router.

**Das Passwortfeld ist ein Vorhang, kein Schloss.** Der Vergleich steht im Quelltext, und das
Google Sheet dahinter ist ohne Anmeldung abrufbar.

## Schwesterprojekt

Der Router selbst, sein Accounting und alle Abweichungen vom Auslieferungszustand liegen in
**vanbox** (privat).
