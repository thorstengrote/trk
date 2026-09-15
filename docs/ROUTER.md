# Der Teil im Van

`router/update_location_and_sheet.sh`, 499 Zeilen POSIX sh, laeuft auf einem GL.iNet GL-X750
(Spitz) unter OpenWrt 22.03.4 alle 15 Minuten per Cron:

```
*/15 * * * * /root/update_location_and_sheet.sh
```

## Ablauf

**1. Funkzelle auslesen.** `gl_modem AT 'AT+QENG="servingcell"'` liefert vom Quectel EP06-E
eine Zeile wie:

```
+QENG: "servingcell","NOCONN","LTE","FDD",262,01,1FC2F00,425,1300,3,5,5,6F56,-118,-14,-82,11,9
```

Daraus werden Netztyp, MCC, MNC und je nach Typ LAC/CID (GSM, WCDMA) oder TAC/ECI (LTE)
gezogen. Die Hex-Werte werden nach dezimal gewandelt, weil UnwiredLabs das so erwartet.

**2. Vergleichen.** Der Bezeichner `LTE,262,01,425,1FC2F00` wird gegen den zuletzt gesehenen
gehalten. Ist die Zelle dieselbe, endet der Lauf hier. Das ist der Grund, warum das Sheet bei
stehendem Van nicht waechst.

**2a. Sperrliste und Budget.** Stand die Zelle schon einmal ohne Ergebnis da, wird sie eine
Woche lang nicht erneut abgefragt. Und pro Tag gibt es ein Hoechstmass an Abfragen. Beides ist
neu, siehe unten.

**3. Aufloesen.** POST an `us1.unwiredlabs.com/v2/process.php` mit der Zellkennung, zurueck
kommen `lat` und `lon`. Begrenzt durch Sperrliste und Tagesbudget, siehe unten.

Ein lokaler OpenCelliD-Abzug auf dem USB-Stick wurde gebaut, gemessen und wieder verworfen.
Warum, steht im Schwesterprojekt vanbox unter docs/CELLDB.md.

**4. Hoehe holen.** `api.open-elevation.com` zu den Koordinaten.

**5. Schreiben.** Anhaengen an das Google Sheet ueber die Sheets-API. Die Authentifizierung
laeuft ohne Google-Bibliothek: das Script baut den JWT selbst aus dem Service-Account-Schluessel
(`openssl dgst -sha256 -sign`), tauscht ihn bei `oauth2.googleapis.com/token` gegen ein
Access Token und legt das fuer eine Stunde in `/tmp` ab. Das ist der Grund, warum auf dem
Router kein Python mehr noetig ist.

**6. Melden.** Bei Bedarf eine Telegram-Nachricht.

**5a. Spalten.** Geschrieben werden lat, lon, Zeit, Hoehe, und seit dem 15.09.2026 zusaetzlich
die Zellkennung und die Empfangsstaerke RSRP. Damit laesst sich hinterher unterscheiden, ob die
Karte springt oder der Van gefahren ist.

## Ohne Netz

Faellt der Uplink aus, landet der Datensatz im Puffer unter
`/mnt/extroot/vanbox/state/offline_location_data`. Der naechste Lauf mit Verbindung schiebt
nach, aeltester zuerst und gedeckelt auf acht Punkte pro Lauf.

Der Puffer lag frueher in `/tmp`. Im Van haengt der Router an einem Kippschalter, und damit war
alles Gepufferte nach jedem Ausschalten weg. Genau die Punkte aus Laendern ohne Roaming.

## Was am 15.09.2026 repariert wurde

Aus 419 Datensaetzen und den Verlaufsdateien des Routers liess sich rekonstruieren, warum die
Aufzeichnung ueber Monate lueckenhaft war. An 105 Tagen lief der Router nachweislich, ohne dass
ein Punkt entstand. Elf davon am Stueck im Juli 2025, mit dem Van in Como.

**Die Endlosschleife.** Der Zellbezeichner wurde nur im Erfolgsfall fortgeschrieben. Schlug die
Ortung fehl, hielt das Script die Zelle 15 Minuten spaeter erneut fuer neu und fragte wieder an.
96 Mal am Tag, gegen ein Kontingent von rund 100. Dazu ging der komplette Offline-Puffer bei
jedem Lauf durch, jeder Eintrag eine weitere Abfrage. Ein voller Puffer hat das Tageskontingent
in einem einzigen Lauf aufgebraucht, und danach schlug alles fehl, was funktioniert haette.

Gemessen am 15.09.2026: `"balance": 3`. Drei Abfragen uebrig.

Jetzt wird der Bezeichner immer fortgeschrieben, Zellen ohne Treffer kommen auf eine Sperrliste
mit einer Woche Verfall, es gibt ein Tagesbudget (Voreinstellung 60), und der Puffer wird
gedeckelt abgearbeitet.

**`set -e` ist raus.** Es hat das Script beim ersten Schluckauf still beendet und die
Fehlerbehandlung darunter zu totem Code gemacht.

**Timeouts.** Keiner der sieben curl-Aufrufe hatte einen. Auf einer Verbindung mit 400 ms
Latenz blieb dadurch regelmaessig ein Cronlauf haengen.

**Protokoll.** Es gab keins. Jetzt schreibt das Script nach
`/mnt/extroot/vanbox/log/vanbox.log`, und der naechste Ausfall ist nachlesbar statt
rekonstruierbar.

## Bedienung

```
update_location_and_sheet.sh            normaler Lauf
update_location_and_sheet.sh --verbose  mit Protokoll
update_location_and_sheet.sh --debug    Zellinformationen anzeigen
update_location_and_sheet.sh --help
```

## Zugangsdaten

Im Repository stehen keine. Das Script liest beim Start:

```sh
[ -f /etc/vanbox/secrets.env ] && . /etc/vanbox/secrets.env
```

Gebraucht werden `SPREADSHEET_ID`, `UNWIRED_API_KEY`, `BOT_TOKEN`, `CHAT_ID` und ein Pfad
`CREDENTIALS_JSON` auf den Google-Service-Account-Schluessel. Vorlage:
`router/secrets.env.example`. Auf dem Geraet liegt die Datei mit `chmod 600` unter
`/etc/vanbox/secrets.env`, der Schluessel unter `/etc/vanbox/google-sa.json`.

## Ausrollen

```
router/deploy.sh [ssh-ziel]
```

Sichert den alten Stand auf dem Geraet, spielt das Script ein und prueft die Syntax. Setzt
voraus, dass `/etc/vanbox/lib.sh` schon liegt, die kommt aus dem vanbox-Projekt.

## Grenzen

**Genauigkeit.** Eine Funkzelle deckt im Ort einige hundert Meter ab, auf dem Land mehrere
Kilometer. Punkte springen, wenn das Modem zwischen Masten wechselt, ohne dass der Van sich
bewegt hat.

**GNSS liegt brach.** Das EP06-E hat GNSS-Firmware, `AT+QGPS=1` startet sauber. Gemessen am
15.09.2026: nach zehn Minuten kein Fix, `GSV` meldet null Satelliten. Das ist kein schwacher
Empfang, sondern eine fehlende Antenne. Mit einer GNSS-Antenne liefert `AT+QGPSLOC=2` Position,
Geschwindigkeit und Kurs, und die Zellortung wuerde zum Rueckfall.

**Ein Punkt alle 15 Minuten** bei Zellwechsel. Auf der Autobahn ergibt das grobe Spruenge.
