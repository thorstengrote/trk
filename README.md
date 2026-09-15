# trk

Wo war der Van wann. Eine Karte, die die Reisen eines Familien-Vans nachzeichnet, gespeist aus
dem Router im Fahrzeug.

Live: <https://thorstengrote.github.io/trk/>

## Wie es zusammenhaengt

```
 GL-X750 im Van
 │
 │  alle 15 Minuten:  AT+QENG="servingcell"  ──> Funkzelle (MCC, MNC, TAC, ECI)
 │                                │
 │                    UnwiredLabs ┴──> lat / lon
 │                    open-elevation ──> Hoehe
 │                                │
 └────────────────────────────────┴──> Google Sheets API (Service Account)
                                              │
                                     Google Sheet, als CSV veroeffentlicht
                                              │
                            PapaParse laedt es im Browser
                                              │
                                    Leaflet zeichnet Spur und Hoehenprofil
```

Kein eigener Server. Der Router schreibt, das Sheet haelt, der Browser liest.

## Die Dateien

| Datei | Was es ist |
|---|---|
| `van.html` | die eigentliche App. Routen-Replay mit Animation, Stopp-Erkennung, Zeitraumfilter, Teilen-Links. 89 KB, alles inline. |
| `index.html` + `map.js`, `elevation.js`, `utils.js`, `styles.css` | die aeltere, modular aufgeteilte Fassung |
| `index2.html` | Zwischenstand einer ueberarbeiteten Karte |
| `ng.html` | Ansatz fuer eine Neufassung, unfertig |
| `widget-test.html` | Testseite fuer ein eingebundenes Chat-Widget, gehoert nicht zur App |
| `router/update_location_and_sheet.sh` | der Teil, der im Van laeuft |

Wer etwas aendern will, aendert `van.html`. Der Rest ist Historie.

Ausfuehrlich: [docs/APP.md](docs/APP.md) und [docs/ROUTER.md](docs/ROUTER.md).

## Stopp-Erkennung

Die App leitet aus Standzeiten ab, was fuer ein Halt es war. Schwellen sind einstellbar:

| Symbol | Standzeit | Bedeutung |
|---|---|---|
| ☕ | ab 15 Minuten | Pause |
| 🅿️ | ab 60 Minuten | laengerer Halt |
| 🛏️ | ab 360 Minuten | Uebernachtung |

Aus 419 Positionspunkten wird so eine lesbare Reise statt einer Punktwolke.

## Was man wissen sollte

**Die Genauigkeit ist die einer Funkzelle.** Je nach Mastdichte einige hundert Meter bis
mehrere Kilometer. Fuer die Frage, in welchem Ort der Van stand, reicht das. Eine Fahrspur im
Sinne einer GPS-Aufzeichnung ist es nicht. Das Modem im Router koennte GNSS, es fehlt die
Antenne. Details im Schwesterprojekt vanbox.

**Neue Punkte entstehen nur beim Zellwechsel.** Steht der Van, schreibt der Collector nichts.
Das haelt das Sheet klein und spart Datenvolumen, erzeugt aber Luecken, die keine Ausfaelle sind.
Eine Luecke im Sheet und ein ausgeschalteter Router sehen gleich aus. Wer wissen will, was
wirklich war, schaut ins Protokoll auf dem Router.

**Seit dem 15.09.2026 hat das Sheet zwei Spalten mehr:** die Zellkennung und die
Empfangsstaerke RSRP. Alte Zeilen haben sie nicht. Fuer die Kopfzeile bietet sich `cell` und
`rsrp` in E1 und F1 an.

**Das Passwortfeld in `van.html` ist ein Vorhang, kein Schloss.** Der Vergleich steht im
Quelltext dieser Seite, und das Google Sheet dahinter ist ohne Anmeldung abrufbar. Wer die
Sheet-URL hat, sieht die vollstaendige Bewegungshistorie. Das ist bewusst so.

**Die Commit-Historie taugt nichts.** 164 Commits, fast alle "Update index.html", entstanden im
GitHub-Web-Editor. Ab hier gibt es sprechende Nachrichten.

## Schwesterprojekt

Der Router selbst, sein Accounting und alle Abweichungen vom Auslieferungszustand liegen in
**vanbox** (privat). Dort steht auch, wie man auf das Geraet kommt und wie ausgerollt wird.
