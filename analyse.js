/*
 * Auswertung einer Funkzellen-Spur.
 *
 * Die Positionen im Sheet sind Funktuerme, nicht der Van. Und der Collector
 * schreibt nur bei einem Zellwechsel. Daraus folgen zwei Dinge, die der alte
 * Algorithmus beide falsch hatte:
 *
 *   1. Die Standzeit steht ZWISCHEN zwei Punkten, nicht in einer Punktgruppe.
 *      Der alte Code mass die Dauer innerhalb einer Gruppe. Da ein Halt genau
 *      einen Punkt erzeugt, war die Dauer null und es entstand kein Stopp.
 *      Gemessen an der Sommerreise 2026: 0 gefundene Stopps bei 13 echten.
 *
 *   2. Ob zwischen zwei Punkten gefahren oder gestanden wurde, verraet der
 *      Vergleich von vergangener Zeit und Sollfahrzeit der Strasse. Deshalb
 *      wird pro Abschnitt geroutet.
 *
 * Reihenfolge: Ping-Pong entfernen, Abschnitte klassifizieren, Halte
 * zusammenfassen, Position des Halts auf der Route schaetzen.
 */

const Analyse = (() => {
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

  // Ab dieser Luftlinie gilt ein Abschnitt als Ortswechsel und wird geroutet.
  const STILLSTAND_M = 1500;
  // Ueberschuss ueber die Sollfahrzeit, ab dem unterwegs gehalten wurde.
  const HALT_AB_S = 900;
  // Kuerzeste Dauer, die ueberhaupt als Aufenthalt gilt.
  const MIN_HALT_S = 20 * 60;
  // Halte im Umkreis gelten als derselbe Ort.
  const SELBER_ORT_M = 2500;

  function meter(a, b) {
    const R = 6371e3, r = Math.PI / 180;
    const p1 = a.lat * r, p2 = b.lat * r;
    const dp = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /* --- CSV -------------------------------------------------------------- */

  function parse(csvText) {
    const res = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    const out = [];
    for (const row of res.data) {
      const lat = parseFloat(row.lat), lon = parseFloat(row.lon);
      const t = new Date(row.time);
      if (!isFinite(lat) || !isFinite(lon) || isNaN(t.getTime())) continue;
      out.push({
        lat, lon, time: t,
        hoehe: parseFloat(row.Elevation ?? row.elevation),
        zelle: (row.cell || '').trim() || null,
        rsrp: parseFloat(row.rsrp),
        // Genauigkeitsradius der Ortung. Erst seit 15.09.2026 im Sheet, aeltere
        // Zeilen haben ihn nicht.
        genauigkeit: parseFloat(row.accuracy)
      });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  /* --- Ping-Pong -------------------------------------------------------- */
  /* Zwei benachbarte Masten uebernehmen abwechselnd, ohne dass der Van sich
     bewegt. Auf der Karte sah das wie Spruenge ueber mehrere Kilometer aus,
     gemessen 14 Mal mit im Mittel 8,2 km Ausschlag. */

  function entPingPong(punkte) {
    const raus = [];
    for (let i = 0; i < punkte.length; i++) {
      const p = punkte[i];
      const vor = raus[raus.length - 1];
      const nach = punkte[i + 1];
      if (vor && nach && meter(vor, nach) < SELBER_ORT_M && meter(vor, p) > SELBER_ORT_M) {
        // p weicht aus, obwohl davor und danach derselbe Ort ist: Zellwechsel
        // ohne Bewegung. Zeit uebernehmen, Position verwerfen.
        vor.bis = p.time;
        vor.zellen = (vor.zellen || []).concat(p.zelle ? [p.zelle] : []);
        continue;
      }
      raus.push({ ...p, bis: p.time, zellen: p.zelle ? [p.zelle] : [] });
    }
    return raus;
  }

  /* --- Abschnitte ------------------------------------------------------- */

  const cacheKey = (a, b) =>
    `r:${a.lat.toFixed(5)},${a.lon.toFixed(5)}>${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;

  async function route(a, b) {
    const key = cacheKey(a, b);
    try {
      const hit = await localforage.getItem(key);
      if (hit) return hit;
    } catch (e) { /* Zwischenspeicher nicht verfuegbar, dann eben ohne */ }

    const url = `${OSRM}${a.lon.toFixed(6)},${a.lat.toFixed(6)};` +
                `${b.lon.toFixed(6)},${b.lat.toFixed(6)}` +
                `?overview=simplified&geometries=geojson`;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      if (d.code !== 'Ok' || !d.routes?.length) return null;
      const res = {
        meter: d.routes[0].distance,
        sekunden: d.routes[0].duration,
        geo: d.routes[0].geometry.coordinates.map(c => [c[1], c[0]])
      };
      try { await localforage.setItem(key, res); } catch (e) { /* egal */ }
      return res;
    } catch (e) {
      return null;
    }
  }

  // Mehrere Routen gleichzeitig anfragen. Nacheinander dauerte der erste
  // Aufruf ueber eine Minute, weil jede Anfrage einzeln auf die Antwort
  // wartete. Beim zweiten Mal kommt ohnehin alles aus dem Zwischenspeicher.
  const PARALLEL = 4;

  async function abschnitte(punkte, fortschritt) {
    const segs = new Array(Math.max(punkte.length - 1, 0));
    let naechster = 0, fertig = 0;
    const gesamt = segs.length;

    async function arbeiter() {
      while (true) {
        const i = naechster++;
        if (i >= gesamt) return;
        const a = punkte[i], b = punkte[i + 1];
        const vergangen = (b.time - a.bis) / 1000;
        const luft = meter(a, b);

        if (luft < STILLSTAND_M) {
          segs[i] = { a, b, art: 'steht', vergangen, luft, meter: 0, soll: 0 };
        } else {
          const r = await route(a, b);
          if (!r) {
            segs[i] = { a, b, art: 'unklar', vergangen, luft, meter: luft, soll: null };
          } else {
            const ueber = vergangen - r.sekunden;
            segs[i] = {
              a, b, vergangen, luft,
              art: ueber > HALT_AB_S ? 'faehrt+halt' : 'faehrt',
              meter: r.meter, soll: r.sekunden, ueber, geo: r.geo
            };
          }
        }
        if (fortschritt) fortschritt(++fertig, gesamt);
      }
    }

    await Promise.all(Array.from({ length: Math.min(PARALLEL, gesamt || 1) }, arbeiter));
    return segs;
  }

  /* --- Halte ------------------------------------------------------------ */
  /* Zusammenfassen, solange es oertlich derselbe Aufenthalt ist. Ohne das
     zerfaellt eine zweitaegige Pause in "2,2 h" plus "71,9 h". */

  function halte(segs) {
    const roh = [];
    for (const s of segs) {
      if (s.art === 'steht' && s.vergangen >= MIN_HALT_S) {
        roh.push({ von: s.a.bis, bis: s.b.time, sek: s.vergangen,
                   lat: s.a.lat, lon: s.a.lon, seg: s, quelle: 'stillstand' });
      } else if (s.art === 'faehrt+halt' && s.ueber >= MIN_HALT_S) {
        // Gehalten wurde irgendwo auf dem Weg. Die Position schaetzt
        // positionAufRoute spaeter genauer.
        roh.push({ von: s.a.bis, bis: s.b.time, sek: s.ueber,
                   lat: s.b.lat, lon: s.b.lon, seg: s, quelle: 'unterwegs' });
      }
    }

    const zus = [];
    for (const h of roh) {
      const letzter = zus[zus.length - 1];
      // Grosszuegiger zusammenfassen, wenn einer der beiden lang ist. Sonst
      // bleibt vor jedem mehrtaegigen Halt eine 0,5-h-Pause als Artefakt stehen.
      const fenster = (letzter && (letzter.sek > 6 * 3600 || h.sek > 6 * 3600)) ? 6 * 3600 : 3600;
      if (letzter && meter(letzter, h) < SELBER_ORT_M &&
          (h.von - letzter.bis) / 1000 < fenster) {
        letzter.bis = h.bis;
        letzter.sek = (letzter.bis - letzter.von) / 1000;
        letzter.teile++;
        if (h.quelle === 'stillstand') { letzter.lat = h.lat; letzter.lon = h.lon; }
      } else {
        zus.push({ ...h, teile: 1 });
      }
    }
    return zus.map(h => ({ ...h, art: einordnen(h) }));
  }

  // Zeitzone der Reise, nicht die des Betrachters. Wer die Karte aus Kalifornien
  // aufruft, soll dieselbe Einordnung sehen wie jemand im Van.
  const ORTSZEIT_OFFSET_H = 2;

  function einordnen(h) {
    const std = h.sek / 3600;
    if (std >= 24) return 'standtage';
    const stunde = new Date(h.von.getTime() + ORTSZEIT_OFFSET_H * 3600e3).getUTCHours();
    const nachts = stunde >= 19 || stunde <= 7;
    if (std >= 6 && nachts) return 'uebernachtung';
    if (std >= 6) return 'langer-halt';
    if (std >= 1) return 'halt';
    return 'pause';
  }

  /* --- Position eines Halts --------------------------------------------- */
  /* Bei einem Halt unterwegs ist der Funkturm nicht der Aufenthaltsort. Der
     beste Schaetzwert ist der Punkt auf der berechneten Route, der dem Turm am
     naechsten liegt. */

  // Ab dieser Dauer wird nicht mehr auf die Route gezogen: wer drei Tage steht,
  // steht nicht auf der Durchgangsstrasse, sondern irgendwo in der Funkzelle.
  // Dann ist die Zellposition der ehrlichere Schaetzwert.
  const SNAP_BIS_S = 6 * 3600;

  function positionAufRoute(h) {
    if (h.quelle !== 'unterwegs' || !h.seg?.geo?.length) return h;
    if (h.sek > SNAP_BIS_S) return { ...h, unsicher: true };
    const ziel = { lat: h.seg.b.lat, lon: h.seg.b.lon };
    let best = null, bestD = Infinity;
    for (const [lat, lon] of h.seg.geo) {
      const d = meter(ziel, { lat, lon });
      if (d < bestD) { bestD = d; best = { lat, lon }; }
    }
    if (best && bestD < 15000) {
      return { ...h, lat: best.lat, lon: best.lon, versatz: bestD, aufRoute: true };
    }
    return h;
  }

  /* --- Gesamtlauf ------------------------------------------------------- */

  async function lauf(csvText, von, bis, fortschritt) {
    let punkte = parse(csvText);
    const gesamt = punkte.length;
    if (von) punkte = punkte.filter(p => p.time >= von);
    if (bis) punkte = punkte.filter(p => p.time <= bis);
    const roh = punkte.length;

    punkte = entPingPong(punkte);
    const segs = await abschnitte(punkte, fortschritt);
    const stops = halte(segs).map(positionAufRoute);

    const strasse = segs.reduce((s, x) => s + (x.meter || 0), 0);
    return {
      punkte, segs, stops,
      zahlen: {
        gesamt, imZeitraum: roh, nachPingPong: punkte.length,
        pingpongEntfernt: roh - punkte.length,
        km: strasse / 1000,
        faehrt: segs.filter(s => s.art === 'faehrt').length,
        faehrtHalt: segs.filter(s => s.art === 'faehrt+halt').length,
        steht: segs.filter(s => s.art === 'steht').length,
        unklar: segs.filter(s => s.art === 'unklar').length
      }
    };
  }

  return { lauf, parse, entPingPong, abschnitte, halte, positionAufRoute, meter };
})();

if (typeof module !== 'undefined') module.exports = Analyse;
