#!/usr/bin/env python3
"""
Laedt Hoehenkacheln fuer den Korridor einer Reise und legt sie neben die Seite.

Warum selbst mitliefern: die freien Hoehenkacheln von AWS (Terrain Tiles,
Terrarium-Format) schicken keinen CORS-Header. WebGL kann sie damit nicht
auslesen. Ueber GitHub Pages ausgeliefert haben sie CORS (ACAO *), und fuer
eine Reise sind es nur ein paar hundert Kacheln.

Aufruf:
    werkzeug/hoehenkorridor.py <route.json> [--zoom 11] [--rand 1] [--ziel dem]

route.json ist eine Liste von [lat, lon] Paaren, wie sie die Auswertung fuer
die gefahrene Strecke liefert.

Quelle: Terrain Tiles auf AWS Open Data, Hoehendaten unter anderem aus
SRTM und ASTER. Bei Weitergabe Quelle nennen.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

QUELLE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def kachel(lat, lon, z):
    x = int((lon + 180.0) / 360.0 * 2 ** z)
    lat = max(min(lat, 85.05), -85.05)
    r = math.radians(lat)
    y = int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z)
    return x, y


def korridor(punkte, z, rand):
    """Kacheln entlang der Linie, mit Rand. Zwischen weit auseinanderliegenden
    Punkten wird aufgefuellt, sonst entstehen Loecher in der Landschaft."""
    noetig = set()
    for i, (lat, lon) in enumerate(punkte):
        vor = punkte[i - 1] if i else None
        if vor:
            # In Schritten von rund einer halben Kachelbreite auffuellen
            schritt = 360.0 / 2 ** z / 2
            n = max(int(max(abs(lat - vor[0]), abs(lon - vor[1])) / schritt), 1)
            for k in range(n):
                f = k / n
                noetig.add(kachel(vor[0] + (lat - vor[0]) * f,
                                  vor[1] + (lon - vor[1]) * f, z))
        noetig.add(kachel(lat, lon, z))

    mit_rand = set()
    grenze = 2 ** z
    for x, y in noetig:
        for dx in range(-rand, rand + 1):
            for dy in range(-rand, rand + 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < grenze and 0 <= ny < grenze:
                    mit_rand.add((nx, ny))
    return sorted(mit_rand)


def hole(auftrag):
    z, x, y, ziel = auftrag
    pfad = os.path.join(ziel, str(z), str(x), f"{y}.png")
    if os.path.exists(pfad) and os.path.getsize(pfad) > 0:
        return "da", 0
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    req = urllib.request.Request(QUELLE.format(z=z, x=x, y=y),
                                 headers={"User-Agent": "trk-hoehenkorridor/1.0"})
    for versuch in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                daten = r.read()
            if not daten.startswith(b"\x89PNG"):
                return "kaputt", 0
            with open(pfad, "wb") as fh:
                fh.write(daten)
            return "neu", len(daten)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "fehlt", 0
            time.sleep(1 + versuch)
        except Exception:
            time.sleep(1 + versuch)
    return "fehler", 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("route", help="JSON mit [[lat,lon], ...]")
    ap.add_argument("--zoom", type=int, default=11)
    ap.add_argument("--rand", type=int, default=1, help="Kacheln Rand um die Strecke")
    ap.add_argument("--ziel", default="dem")
    ap.add_argument("--parallel", type=int, default=8)
    a = ap.parse_args()

    punkte = json.load(open(a.route))
    liste = korridor(punkte, a.zoom, a.rand)
    print(f"{len(punkte)} Streckenpunkte -> {len(liste)} Kacheln auf Zoom {a.zoom}")

    auftraege = [(a.zoom, x, y, a.ziel) for x, y in liste]
    zaehler, bytes_neu = {}, 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=a.parallel) as pool:
        for i, (art, n) in enumerate(pool.map(hole, auftraege), 1):
            zaehler[art] = zaehler.get(art, 0) + 1
            bytes_neu += n
            if i % 25 == 0 or i == len(auftraege):
                print(f"  {i}/{len(auftraege)}  {bytes_neu/1e6:.1f} MB", end="\r", flush=True)
    print()
    print(f"fertig in {time.time()-t0:.0f} s: " +
          ", ".join(f"{v} {k}" for k, v in sorted(zaehler.items())))

    gesamt = sum(os.path.getsize(os.path.join(w, f))
                 for w, _, fs in os.walk(a.ziel) for f in fs)
    print(f"{a.ziel}: {gesamt/1e6:.1f} MB")
    print("\nHoehendaten: Terrain Tiles auf AWS Open Data (SRTM, ASTER u. a.).")


if __name__ == "__main__":
    sys.exit(main())
