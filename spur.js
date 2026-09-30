/*
 * Die GPS-Spur aus dem Womo.
 *
 * Aufgezeichnet wird auf dem Tablet im Fahrzeug (Repo womo, geraet/spur.sh),
 * eine Datei je Tag, verschluesselt abgelegt unter
 * https://thorstengrote.github.io/spur/JJJJ-MM-TT.bin
 *
 * Verschluesselt, weil eine Spur im Halbminutentakt metergenau zeigt, wo
 * jemand geschlafen hat, das Repo aber oeffentlich sein muss, damit Pages es
 * ohne Bezahlung ausliefert. AES-256-GCM, zwoelf Byte IV voran, Schluessel
 * ueber PBKDF2 aus einer Passphrase. Die steht nicht im Quelltext, sie wird
 * einmal abgefragt und liegt danach in localStorage.
 *
 * Warum die Spur die Funkzellen nicht einfach ersetzt: sie gibt es erst seit
 * dem 30.09.2026, und sie fehlt, wenn das Tablet aus war. Die Auswertung
 * schaltet deshalb abschnittsweise um, siehe analyse.js.
 *
 * Klartext ist CSV. Die Spalte art sagt, warum eine Zeile da steht:
 *   start     Aufzeichner hat begonnen
 *   f         Fahrt, mehr als 15 m seit dem letzten Punkt
 *   s         Stand, Herzschlag nach fuenf Minuten
 *   kein-fix  keine brauchbare Position mehr
 *   ende      Tageswechsel
 * Aus einer Luecke allein liesse sich der Zustand nicht ablesen: Stehen,
 * Geraet aus und kein Empfang saehen gleich aus.
 */
const Spur = (() => {
  const ORT = 'https://thorstengrote.github.io/spur/';
  const SALZ = 'womo-spur-1', RUNDEN = 200000;

  /* Groesster Abstand zweier Zeilen, der noch als lueckenlos gilt. Der
     Herzschlag im Stand kommt alle fuenf Minuten, zwoelf lassen Luft fuer
     einen verpassten. */
  const LUECKE_S = 12 * 60;
  /* Innerhalb dieses Radius gilt das Fahrzeug als stehend. Ein ruhender
     Empfaenger wandert je nach Empfang ein paar Dutzend Meter. */
  const STAND_R = 60;
  /* Kuerzeste Dauer, die als Aufenthalt zaehlt. Wie in analyse.js. */
  const MIN_HALT_S = 20 * 60;
  /* Kuerzere Teilstuecke zaehlen nicht zur Strecke, das waere Rauschen. Der
     Aufzeichner schreibt eine Fahrtzeile erst ab 15 m Abstand zur letzten,
     echte Bewegung liegt also immer darueber. Zwoelf Meter lassen sie sicher
     durch und halten das Zittern eines kurz stehenden Empfaengers heraus. */
  const MIN_BEIN_M = 12;

  let schluessel = null, abgelehnt = false;

  /* Einmal fragen, danach steht sie in localStorage. Wer abwinkt, wird bis
     zum naechsten Laden der Seite nicht wieder gefragt: die Auswertung laeuft
     bei jedem Klick auf Anzeigen erneut, und eine Abfrage je Klick waere eine
     Zumutung. */
  function passwort() {
    if (abgelehnt) return null;
    let p = null;
    try { p = localStorage.getItem('trk.spur.pass'); } catch (e) {}
    if (p) return p;
    p = prompt('Passphrase für die GPS-Spur (leer lassen: nur Funkzellen)');
    if (p) { try { localStorage.setItem('trk.spur.pass', p); } catch (e) {} }
    else abgelehnt = true;
    return p || null;
  }

  /* Zum Nachtragen oder Aendern von Hand: Spur.passphrase('...') */
  function passphrase(neu) {
    try { neu ? localStorage.setItem('trk.spur.pass', neu)
              : localStorage.removeItem('trk.spur.pass'); } catch (e) {}
    schluessel = null; abgelehnt = false;
  }

  async function holeSchluessel(pass) {
    if (schluessel) return schluessel;
    const roh = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass),
      'PBKDF2', false, ['deriveKey']);
    schluessel = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode(SALZ), iterations: RUNDEN, hash: 'SHA-256' },
      roh, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return schluessel;
  }

  const tagName = d => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');

  async function tagHolen(name, key) {
    let roh;
    try {
      const r = await fetch(ORT + name + '.bin', { cache: 'no-store' });
      if (!r.ok) return null;               // 404 heisst: an dem Tag nichts
      roh = new Uint8Array(await r.arrayBuffer());
    } catch (e) { return null; }
    if (roh.length < 29) return null;
    try {
      const klar = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: roh.slice(0, 12) }, key, roh.slice(12));
      return new TextDecoder().decode(klar);
    } catch (e) {
      console.warn('Spur ' + name + ': Passphrase passt nicht');
      return null;
    }
  }

  function zeilen(text) {
    const aus = [];
    for (const z of text.split('\n')) {
      const t = z.trim();
      if (!t || t.startsWith('zeit;')) continue;
      const f = t.split(';');
      const zeit = new Date(f[0]);
      if (isNaN(zeit.getTime())) continue;
      const lat = parseFloat(f[2]), lon = parseFloat(f[3]);
      aus.push({
        zeit, art: f[1],
        lat: isFinite(lat) ? lat : null,
        lon: isFinite(lon) ? lon : null,
        hoehe: parseFloat(f[4]),
        tempo: parseFloat(f[5]),
        genauigkeit: parseFloat(f[6])
      });
    }
    aus.sort((a, b) => a.zeit - b.zeit);
    return aus;
  }

  /* Alle Tage im Zeitraum holen. Fehlende Tage sind kein Fehler, dort gab es
     die Aufzeichnung noch nicht oder das Tablet war aus. */
  async function laden(von, bis) {
    const pass = passwort();
    if (!pass) return [];
    let key;
    try { key = await holeSchluessel(pass); } catch (e) { return []; }
    const a = new Date(von || Date.now() - 30 * 864e5);
    const b = new Date(bis || Date.now());
    const namen = [];
    for (let d = new Date(a.getFullYear(), a.getMonth(), a.getDate());
         d <= b && namen.length < 120;
         d.setDate(d.getDate() + 1)) namen.push(tagName(d));
    const texte = await Promise.all(namen.map(n => tagHolen(n, key)));
    let alle = [];
    for (const t of texte) if (t) alle = alle.concat(zeilen(t));
    alle.sort((x, y) => x.zeit - y.zeit);
    return alle;
  }

  /* Zeitraeume, in denen der Aufzeichner nachweislich lief und Positionen
     lieferte. Alles ausserhalb bleibt Sache der Funkzellen. */
  function abdeckung(zn) {
    const aus = [];
    let lauf = null;
    for (const z of zn) {
      const gut = z.art === 'f' || z.art === 's';
      if (!gut) {                               // start, ende, kein-fix
        if (lauf) { aus.push(lauf); lauf = null; }
        continue;
      }
      if (lauf && (z.zeit - lauf.bis) / 1000 > LUECKE_S) { aus.push(lauf); lauf = null; }
      if (!lauf) lauf = { von: z.zeit, bis: z.zeit, punkte: [z] };
      else { lauf.bis = z.zeit; lauf.punkte.push(z); }
    }
    if (lauf) aus.push(lauf);
    return aus.filter(a => a.punkte.length >= 2);
  }

  const meter = (a, b) => {
    const R = 6371e3, r = Math.PI / 180;
    const p1 = a.lat * r, p2 = b.lat * r;
    const dp = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };

  /* Aus den Punkten eines lueckenlosen Zeitraums Abschnitte bauen, in genau
     der Form, die analyse.js sonst aus Routenabfragen gewinnt. Damit arbeiten
     halte() und die Karte unveraendert weiter.

     Kein Routing: die Spur liegt schon auf der Strasse. Die Strecke wird
     gemessen statt gerechnet, und ein Halt ist nicht mehr die Differenz
     zwischen vergangener Zeit und Sollfahrzeit, sondern schlicht: die
     Position aendert sich eine Weile nicht. */
  function abschnitteAus(punkte) {
    const segs = [];
    let i = 0;
    while (i < punkte.length) {
      // Wie lange bleibt es im Umkreis des Ankers?
      let j = i + 1;
      while (j < punkte.length && meter(punkte[i], punkte[j]) <= STAND_R) j++;
      const dauer = (punkte[Math.min(j, punkte.length - 1)].zeit - punkte[i].zeit) / 1000;

      if (j - i >= 2 && dauer >= MIN_HALT_S) {
        const a = punkte[i], b = punkte[Math.min(j, punkte.length - 1)];
        segs.push({
          a: { ...a, time: a.zeit, bis: a.zeit },
          b: { ...b, time: b.zeit, bis: b.zeit },
          vergangen: (b.zeit - a.zeit) / 1000,
          luft: meter(a, b), art: 'steht', meter: 0, quelleSpur: true
        });
        i = j;
        continue;
      }

      // Kein Stand: bis zum naechsten Stand ist es Fahrt.
      let k = i + 1;
      while (k < punkte.length) {
        let m = k + 1;
        while (m < punkte.length && meter(punkte[k], punkte[m]) <= STAND_R) m++;
        const d = (punkte[Math.min(m, punkte.length - 1)].zeit - punkte[k].zeit) / 1000;
        if (m - k >= 2 && d >= MIN_HALT_S) break;
        k++;
      }
      const teil = punkte.slice(i, Math.min(k + 1, punkte.length));
      if (teil.length >= 2) {
        let strecke = 0;
        for (let n = 1; n < teil.length; n++) {
          const d = meter(teil[n - 1], teil[n]);
          if (d >= MIN_BEIN_M) strecke += d;
        }
        const a = teil[0], b = teil[teil.length - 1];
        segs.push({
          a: { ...a, time: a.zeit, bis: a.zeit },
          b: { ...b, time: b.zeit, bis: b.zeit },
          vergangen: (b.zeit - a.zeit) / 1000,
          luft: meter(a, b), art: 'faehrt',
          meter: strecke, soll: (b.zeit - a.zeit) / 1000, ueber: 0,
          geo: teil.map(p => [p.lat, p.lon]), quelleSpur: true
        });
      }
      i = Math.max(k, i + 1);
    }
    return segs;
  }

  async function segmente(von, bis) {
    const zn = await laden(von, bis);
    if (!zn.length) return { segs: [], zeitraeume: [], zeilen: 0 };
    const raeume = abdeckung(zn);
    let segs = [];
    for (const r of raeume) segs = segs.concat(abschnitteAus(r.punkte));
    return { segs, zeitraeume: raeume.map(r => ({ von: r.von, bis: r.bis })), zeilen: zn.length };
  }

  return { segmente, laden, abdeckung, abschnitteAus, meter, passphrase };
})();

if (typeof module !== 'undefined') module.exports = Spur;
