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

**2. Vergleichen.** Der Bezeichner `LTE,262,01,425,1FC2F00` wird gegen `/tmp/last_cell_info`
gehalten. Ist die Zelle dieselbe, endet der Lauf hier. Das ist der Grund, warum das Sheet bei
stehendem Van nicht waechst.

**3. Aufloesen.** POST an `us1.unwiredlabs.com/v2/process.php` mit der Zellkennung, zurueck
kommen `lat` und `lon`.

**4. Hoehe holen.** `api.open-elevation.com` zu den Koordinaten.

**5. Schreiben.** Anhaengen an das Google Sheet ueber die Sheets-API. Die Authentifizierung
laeuft ohne Google-Bibliothek: das Script baut den JWT selbst aus dem Service-Account-Schluessel
(`openssl dgst -sha256 -sign`), tauscht ihn bei `oauth2.googleapis.com/token` gegen ein
Access Token und legt das fuer eine Stunde in `/tmp` ab. Das ist der Grund, warum auf dem
Router kein Python mehr noetig ist.

**6. Melden.** Bei Bedarf eine Telegram-Nachricht.

## Ohne Netz

Faellt der Uplink aus, landet der Datensatz in `/tmp/offline_location_data`. Der naechste Lauf
mit Verbindung schiebt die gepufferten Punkte nach. Positionen, deren Hoehe beim Schreiben
fehlte, holt `update_missing_elevations` spaeter nach.

`/tmp` ist ein tmpfs. Ein Neustart ohne Netz verwirft den Puffer.

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
`router/secrets.env.example`. Auf dem Geraet gehoert die Datei mit `chmod 600` nach
`/etc/vanbox/secrets.env`, der Schluessel nach `/etc/vanbox/google-sa.json`.

Auf dem laufenden Geraet stehen diese Werte bis heute im Klartext in `/root`. Der Austausch
ist im Schwesterprojekt vanbox beschrieben.

## Grenzen

**Genauigkeit.** Eine Funkzelle deckt im Ort einige hundert Meter ab, auf dem Land mehrere
Kilometer. Punkte springen, wenn das Modem zwischen Masten wechselt, ohne dass der Van sich
bewegt hat.

**GNSS liegt brach.** Das EP06-E hat GNSS-Firmware, `AT+QGPS=1` startet sauber. Gemessen am
15.09.2026: nach zehn Minuten kein Fix, `GSV` meldet null Satelliten. Das ist kein schwacher
Empfang, sondern eine fehlende Antenne. Mit einer GNSS-Antenne liefert `AT+QGPSLOC=2` Position,
Geschwindigkeit und Kurs, und die Zellortung wuerde zum Rueckfall.

**Ein Punkt alle 15 Minuten** bei Zellwechsel. Auf der Autobahn ergibt das grobe Spruenge.
