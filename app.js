'use strict';
// App sopralluoghi: sopralluogo -> voci -> foto con didascalia + note -> report PDF.
// Tutti i dati restano nel telefono (IndexedDB), niente viene caricato online.
// Il codice è pubblico: qui dentro non ci sono nomi, email o dati personali. Intestazione dei report, email ed
// elenco delle voci si impostano dall'app (pagina Impostazioni) e restano nel telefono.

const NUM_SALE = 12;

// ---------- Database ----------
let db;

function apriDb() {
  return new Promise((ok, ko) => {
    const rq = indexedDB.open('sopralluoghi', 2);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      const ha = nome => d.objectStoreNames.contains(nome);
      if (!ha('sopralluoghi')) d.createObjectStore('sopralluoghi', { keyPath: 'id' });
      if (!ha('voci')) d.createObjectStore('voci', { keyPath: 'id' }).createIndex('sopId', 'sopId');
      if (!ha('foto')) {
        const foto = d.createObjectStore('foto', { keyPath: 'id' });
        foto.createIndex('vocId', 'vocId');
        foto.createIndex('sopId', 'sopId');
      }
      if (!ha('impostazioni')) d.createObjectStore('impostazioni', { keyPath: 'chiave' });
    };
    rq.onsuccess = () => { db = rq.result; ok(); };
    rq.onerror = () => ko(rq.error);
  });
}

function tx(store, modo, fn) {
  return new Promise((ok, ko) => {
    const t = db.transaction(store, modo);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => ok(r ? r.result : undefined);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error);
  });
}

const dbGet = (s, id) => tx(s, 'readonly', st => st.get(id));
const dbPut = (s, o) => tx(s, 'readwrite', st => st.put(o));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbIdx = (s, indice, chiave) => tx(s, 'readonly', st => st.index(indice).getAll(chiave));

// ---------- Impostazioni (intestazione, email, elenco voci) ----------
// Alla prima apertura sono tutte vuote.
let conf = { intestazione: '', email: '', voci: [] };

async function caricaConf() {
  const r = await dbGet('impostazioni', 'conf');
  if (r && r.valore) conf = Object.assign(conf, r.valore);
}

const salvaConf = () => dbPut('impostazioni', { chiave: 'conf', valore: conf });

// ---------- Utilità ----------
const app = document.getElementById('app');

const nuovoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const perOrdine = (a, b) => a.ordine - b.ordine;
const giaInElenco = titolo => conf.voci.some(t => t.toLowerCase() === titolo.toLowerCase());

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function oggi() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function dataIt(iso) {
  const [a, m, g] = String(iso || '').split('-');
  return g ? `${g}/${m}/${a}` : '';
}

// Le foto sono mostrate con URL temporanei che vanno rilasciati a ogni cambio pagina.
let urlAperti = [];
function urlFoto(blob) {
  const u = URL.createObjectURL(blob);
  urlAperti.push(u);
  return u;
}
function liberaUrl() {
  urlAperti.forEach(u => URL.revokeObjectURL(u));
  urlAperti = [];
}

// Salvataggio ritardato mentre si scrive (evita di scrivere a ogni lettera).
const timer = {};
function differisci(chiave, fn, ms = 400) {
  clearTimeout(timer[chiave]);
  timer[chiave] = setTimeout(fn, ms);
}

// Riduce la foto (max 1600 px sul lato lungo): report più leggeri e telefono meno pieno.
async function ridimensiona(file, max = 1600) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    bmp = await createImageBitmap(file);
  }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
}

// ---------- Elenco sopralluoghi ----------
async function vistaElenco() {
  const lista = (await dbAll('sopralluoghi')).sort((a, b) => b.creato - a.creato);
  app.innerHTML = `
    <header class="top">
      <h1>Sopralluoghi</h1>
      <a class="icona-link" href="#/impostazioni" title="Impostazioni">⚙️</a>
    </header>
    <button id="nuovo" class="btn primario grande">+ Nuovo sopralluogo</button>
    ${lista.length ? lista.map(s => `
      <a class="card" href="#/s/${esc(s.id)}">
        <b>${esc(s.cinema) || '(senza nome)'}</b>
        <span>${esc(s.sala)}${s.sala ? ' · ' : ''}${dataIt(s.data)}</span>
      </a>`).join('') : '<p class="vuoto">Nessun sopralluogo. Premi il pulsante per iniziare.</p>'}`;

  document.getElementById('nuovo').onclick = async () => {
    const s = { id: nuovoId(), cinema: '', sala: '', data: oggi(), creato: Date.now() };
    await dbPut('sopralluoghi', s);
    location.hash = '#/s/' + s.id;
  };
}

// ---------- Impostazioni ----------
function vistaImpostazioni() {
  app.innerHTML = `
    <header class="top"><a href="#/" class="link">← Elenco</a></header>
    <h1>Impostazioni</h1>
    <section class="card">
      <label>Intestazione dei report
        <input id="c-intest" value="${esc(conf.intestazione)}" placeholder="Es. nome della tua azienda"></label>
      <label>Email a cui inviare i report
        <input id="c-email" type="email" inputmode="email" value="${esc(conf.email)}" placeholder="nome@esempio.it"></label>
    </section>
    <section class="card">
      <h3>Elenco voci</h3>
      <p class="aiuto">Sono le voci proposte in ogni sopralluogo. Cambiare o togliere una voce qui non modifica i
        sopralluoghi già fatti.</p>
      <div id="lista-voci"></div>
      <div class="riga">
        <input id="nuova-c" placeholder="Nuova voce (es. Rack audio)">
        <button id="btn-nuova-c">Inserisci</button>
      </div>
    </section>
    <section class="card">
      <h3>Backup e trasferimento</h3>
      <p class="aiuto">Il backup salva in un file tutti i sopralluoghi (note e foto) e queste impostazioni. Serve anche
        per portare i dati su un altro dispositivo, ad esempio dal telefono al PC: lì si apre l'app e si preme Importa.</p>
      <div class="riga-doppia">
        <button id="btn-backup" class="btn">⬇️ Backup completo</button>
        <label class="btn">⬆️ Importa<input type="file" id="file-importa" accept=".json,application/json" hidden></label>
      </div>
    </section>`;

  document.getElementById('c-intest').addEventListener('input', e => {
    conf.intestazione = e.target.value;
    differisci('c-intest', salvaConf);
  });
  document.getElementById('c-email').addEventListener('input', e => {
    conf.email = e.target.value.trim();
    differisci('c-email', salvaConf);
  });

  const box = document.getElementById('lista-voci');

  function disegnaLista() {
    if (!conf.voci.length) {
      box.innerHTML = '<p class="vuoto">Nessuna voce. Aggiungine una qui sotto.</p>';
      return;
    }
    box.innerHTML = conf.voci.map((t, i) => `
      <div class="voce-riga" data-i="${i}">
        <input data-az="nome" value="${esc(t)}">
        <button class="icona" data-az="su" title="Sposta su"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="icona" data-az="giu" title="Sposta giù"${i === conf.voci.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="icona" data-az="elimina" title="Elimina">🗑</button>
      </div>`).join('');
  }
  disegnaLista();

  box.addEventListener('input', e => {
    if (e.target.dataset.az !== 'nome') return;
    const i = Number(e.target.closest('.voce-riga').dataset.i);
    conf.voci[i] = e.target.value;
    differisci('c-voci', salvaConf);
  });

  // Finita la modifica di un nome: tolgo gli spazi e, se è rimasto vuoto, elimino la voce.
  box.addEventListener('change', async e => {
    if (e.target.dataset.az !== 'nome') return;
    const i = Number(e.target.closest('.voce-riga').dataset.i);
    const nome = e.target.value.trim();
    if (nome) conf.voci[i] = nome;
    else conf.voci.splice(i, 1);
    await salvaConf();
    disegnaLista();
  });

  box.addEventListener('click', async e => {
    const az = e.target.dataset.az;
    if (!az || az === 'nome') return;
    const i = Number(e.target.closest('.voce-riga').dataset.i);
    if (az === 'su' && i > 0) {
      [conf.voci[i - 1], conf.voci[i]] = [conf.voci[i], conf.voci[i - 1]];
    } else if (az === 'giu' && i < conf.voci.length - 1) {
      [conf.voci[i + 1], conf.voci[i]] = [conf.voci[i], conf.voci[i + 1]];
    } else if (az === 'elimina') {
      if (!confirm(`Togliere "${conf.voci[i]}" dall'elenco?`)) return;
      conf.voci.splice(i, 1);
    }
    await salvaConf();
    disegnaLista();
  });

  document.getElementById('btn-nuova-c').onclick = async () => {
    const campo = document.getElementById('nuova-c');
    const titolo = campo.value.trim();
    if (!titolo) return;
    if (!giaInElenco(titolo)) {
      conf.voci.push(titolo);
      await salvaConf();
      disegnaLista();
    }
    campo.value = '';
  };

  document.getElementById('btn-backup').onclick = e => conAttesa(e.target, async () => {
    const ids = (await dbAll('sopralluoghi')).map(s => s.id);
    await esportaBackup(ids, true);
  }, 'Preparo il file…');

  document.getElementById('file-importa').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      alert(await importaFile(file));
    } catch (err) {
      alert('Importazione non riuscita: ' + err.message);
    }
    await route();
  };
}

// ---------- Singolo sopralluogo ----------
async function vistaSopralluogo(id) {
  const s = await dbGet('sopralluoghi', id);
  if (!s) { location.hash = '#/'; return; }

  app.innerHTML = `
    <header class="top"><a href="#/" class="link">← Elenco</a></header>
    <section class="card">
      <label>Cinema<input id="s-cinema" value="${esc(s.cinema)}" placeholder="Nome del cinema"></label>
      <label>Note (facoltative)<input id="s-sala" value="${esc(s.sala)}" placeholder="Es. referente, orari"></label>
      <label>Data<input id="s-data" type="date" value="${esc(s.data)}"></label>
    </section>
    <div id="voci"></div>
    <section class="card">
      <h3>Aggiungi voce</h3>
      <div id="area-chips"></div>
      <div class="riga">
        <input id="nuova-voce" placeholder="Nuova voce (es. Rack audio)">
        <button id="btn-nuova">Inserisci</button>
      </div>
      <label class="spunta"><input type="checkbox" id="memorizza" checked>
        Memorizza nell'elenco per i prossimi sopralluoghi</label>
      <a class="link" href="#/impostazioni">Gestisci l'elenco delle voci</a>
    </section>
    <div class="azioni">
      <a class="btn primario" href="#/r/${esc(id)}">Report</a>
      <button id="btn-esporta" class="btn">⬇️ Esporta</button>
      <button id="btn-elimina" class="btn pericolo">Elimina</button>
    </div>`;

  for (const campo of ['cinema', 'sala', 'data']) {
    document.getElementById('s-' + campo).addEventListener('input', e => {
      s[campo] = e.target.value;
      differisci('s-' + campo, () => dbPut('sopralluoghi', s));
    });
  }

  const contenitore = document.getElementById('voci');
  const voci = (await dbIdx('voci', 'sopId', id)).sort(perOrdine);
  for (const v of voci) contenitore.append(await creaVoce(v));

  async function aggiungiVoce(titolo) {
    titolo = titolo.trim();
    if (!titolo) return;
    const v = { id: nuovoId(), sopId: id, titolo, nota: '', ordine: Date.now() };
    await dbPut('voci', v);
    const sez = await creaVoce(v);
    contenitore.append(sez);
    sez.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Le voci memorizzate compaiono come pulsanti da toccare.
  const areaChips = document.getElementById('area-chips');
  function disegnaChips() {
    areaChips.innerHTML = conf.voci.length
      ? `<div class="chips">${conf.voci.map(t =>
          `<button class="chip" data-titolo="${esc(t)}">${esc(t)}</button>`).join('')}</div>`
      : '<p class="aiuto">Nessuna voce memorizzata. Scrivi il nome di una voce e premi Inserisci: ' +
        'resterà nell\'elenco per i prossimi sopralluoghi.</p>';
    areaChips.querySelectorAll('.chip').forEach(b => b.onclick = () => aggiungiVoce(b.dataset.titolo));
  }
  disegnaChips();

  document.getElementById('btn-nuova').onclick = async () => {
    const campo = document.getElementById('nuova-voce');
    const titolo = campo.value.trim();
    if (!titolo) return;
    await aggiungiVoce(titolo);
    if (document.getElementById('memorizza').checked && !giaInElenco(titolo)) {
      conf.voci.push(titolo);
      await salvaConf();
      disegnaChips();
    }
    campo.value = '';
  };

  document.getElementById('btn-esporta').onclick = e =>
    conAttesa(e.target, () => esportaBackup([id], false), 'Preparo il file…');

  document.getElementById('btn-elimina').onclick = async () => {
    if (!confirm('Eliminare questo sopralluogo con tutte le sue foto e note?')) return;
    for (const f of await dbIdx('foto', 'sopId', id)) await dbDel('foto', f.id);
    for (const v of await dbIdx('voci', 'sopId', id)) await dbDel('voci', v.id);
    await dbDel('sopralluoghi', id);
    location.hash = '#/';
  };
}

// Una "voce" è un blocco (es. Rack audio) con la sua sala, nota e foto, sempre insieme.
async function creaVoce(v) {
  const sez = document.createElement('section');
  sez.className = 'card voce';
  sez.id = 'voce-' + v.id;
  const foto = (await dbIdx('foto', 'vocId', v.id)).sort(perOrdine);

  sez.innerHTML = `
    <div class="voce-testa">
      <h3>${esc(v.titolo)}</h3>
      <select data-az="sala" aria-label="Sala">
        <option value="">Sala…</option>
        ${Array.from({ length: NUM_SALE }, (_, i) => i + 1).map(n =>
          `<option value="${n}"${String(v.sala) === String(n) ? ' selected' : ''}>Sala ${n}</option>`).join('')}
      </select>
      <button class="icona" data-az="elimina-voce" title="Elimina voce">🗑</button>
    </div>
    <textarea data-az="nota" rows="4"
      placeholder="Note su questa voce (puoi dettare con il microfono della tastiera)">${esc(v.nota)}</textarea>
    <div class="foto-lista">${foto.map(f => `
      <figure data-foto="${esc(f.id)}">
        <img src="${urlFoto(f.blob)}" alt="">
        <input data-az="didascalia" placeholder="Didascalia foto" value="${esc(f.didascalia)}">
        <button class="icona" data-az="elimina-foto" title="Elimina foto">✕</button>
      </figure>`).join('')}</div>
    <div class="riga">
      <label class="btn">📷 Scatta<input type="file" accept="image/*" capture="environment" hidden data-az="scatta"></label>
      <label class="btn">🖼 Galleria<input type="file" accept="image/*" multiple hidden data-az="galleria"></label>
    </div>`;

  const salvaNota = async testo => {
    const corrente = await dbGet('voci', v.id);
    if (!corrente) return;
    corrente.nota = testo;
    await dbPut('voci', corrente);
  };

  async function ricarica() {
    await salvaNota(sez.querySelector('textarea').value);
    sez.replaceWith(await creaVoce(await dbGet('voci', v.id)));
  }

  sez.addEventListener('input', e => {
    const az = e.target.dataset.az;
    if (az === 'nota') {
      differisci('nota-' + v.id, () => salvaNota(e.target.value));
    } else if (az === 'didascalia') {
      const fid = e.target.closest('figure').dataset.foto;
      differisci('did-' + fid, async () => {
        const f = await dbGet('foto', fid);
        if (!f) return;
        f.didascalia = e.target.value;
        await dbPut('foto', f);
      });
    }
  });

  sez.addEventListener('change', async e => {
    const az = e.target.dataset.az;
    if (az === 'sala') {
      const corrente = await dbGet('voci', v.id);
      corrente.sala = e.target.value;
      await dbPut('voci', corrente);
      v.sala = e.target.value;
      return;
    }
    if (az !== 'scatta' && az !== 'galleria') return;
    const file = Array.from(e.target.files);
    let i = 0;
    for (const f of file) {
      const blob = await ridimensiona(f);
      await dbPut('foto', {
        id: nuovoId(), vocId: v.id, sopId: v.sopId, blob, didascalia: '', ordine: Date.now() + i++
      });
    }
    await ricarica();
  });

  sez.addEventListener('click', async e => {
    const az = e.target.dataset.az;
    if (az === 'elimina-foto') {
      if (!confirm('Eliminare questa foto?')) return;
      await dbDel('foto', e.target.closest('figure').dataset.foto);
      await ricarica();
    } else if (az === 'elimina-voce') {
      if (!confirm(`Eliminare la voce "${v.titolo}" con le sue foto?`)) return;
      for (const f of await dbIdx('foto', 'vocId', v.id)) await dbDel('foto', f.id);
      await dbDel('voci', v.id);
      sez.remove();
    }
  });

  return sez;
}

// ---------- Report ----------
// Ordine delle voci nel report: prima quelle senza sala ("Generale"), poi Sala 1, 2, ... Le intestazioni di sala
// compaiono solo se almeno una voce ha una sala; dentro ogni sala le voci restano nell'ordine di inserimento.
function elementiReport(voci) {
  const perSala = new Map();
  for (const v of voci) {
    const k = v.sala ? Number(v.sala) : 0;
    if (!perSala.has(k)) perSala.set(k, []);
    perSala.get(k).push(v);
  }
  const chiavi = Array.from(perSala.keys()).sort((a, b) => a - b);
  const conSale = chiavi.some(k => k > 0);
  const elementi = [];
  for (const k of chiavi) {
    if (conSale) elementi.push({ sala: k ? 'Sala ' + k : 'Generale' });
    for (const v of perSala.get(k)) elementi.push({ voce: v });
  }
  return elementi;
}

async function vistaReport(id) {
  const s = await dbGet('sopralluoghi', id);
  if (!s) { location.hash = '#/'; return; }
  const voci = (await dbIdx('voci', 'sopId', id)).sort(perOrdine);

  let n = 0;
  let corpo = '';
  for (const el of elementiReport(voci)) {
    if (el.sala) {
      corpo += `<h2 class="sala">${esc(el.sala)}</h2>`;
      continue;
    }
    const v = el.voce;
    const foto = (await dbIdx('foto', 'vocId', v.id)).sort(perOrdine);
    corpo += `
      <section class="rep-voce">
        <h3>${esc(v.titolo)}</h3>
        ${v.nota ? `<p class="nota">${esc(v.nota)}</p>` : ''}
        <div class="rep-foto">${foto.map(f => {
          n++;
          return `<figure>
            <img src="${urlFoto(f.blob)}" alt="Foto ${n}">
            <figcaption><b>Foto ${n}</b>${f.didascalia ? ' – ' + esc(f.didascalia) : ''}</figcaption>
          </figure>`;
        }).join('')}</div>
      </section>`;
  }

  app.innerHTML = `
    <div class="noprint barra">
      <a class="link" href="#/s/${esc(id)}">← Modifica</a>
    </div>
    <div class="noprint azioni-rep">
      <button id="btn-pdf" class="btn">📄 Anteprima PDF</button>
      <button id="btn-mail" class="btn primario">✉️ Invia per email</button>
    </div>
    <article class="report">
      <header>
        ${conf.intestazione ? `<div class="marchio">${esc(conf.intestazione)}</div>` : ''}
        <h1>Report sopralluogo</h1>
        <p><b>${esc(s.cinema) || '(cinema non indicato)'}</b>${s.sala ? ' – ' + esc(s.sala) : ''}<br>${dataIt(s.data)}</p>
      </header>
      ${corpo || '<p>Nessuna voce inserita.</p>'}
    </article>`;

  document.getElementById('btn-pdf').onclick = e => conAttesa(e.target, () => anteprimaPdf(id));
  document.getElementById('btn-mail').onclick = e => conAttesa(e.target, () => inviaEmail(id));
}

// ---------- PDF ed email ----------
// Mentre il PDF si prepara il pulsante mostra "Preparo il PDF…" e non si può ripremere.
async function conAttesa(bottone, azione, messaggio = 'Preparo il PDF…') {
  const testo = bottone.textContent;
  bottone.disabled = true;
  bottone.textContent = messaggio;
  try {
    await azione();
  } catch (err) {
    alert('Operazione non riuscita: ' + (err && err.message));
  }
  bottone.textContent = testo;
  bottone.disabled = false;
}

// Costruisce il PDF (A4): intestazione, poi per ogni voce titolo, nota e foto a due per riga con didascalia.
async function creaPdf(id) {
  const s = await dbGet('sopralluoghi', id);
  const voci = (await dbIdx('voci', 'sopId', id)).sort(perOrdine);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });

  const M = 15;                 // margine
  const L = 210 - 2 * M;        // larghezza utile
  const FONDO = 297 - 18;       // limite basso (lascia spazio al numero di pagina)
  let y = M;
  const spazio = h => { if (y + h > FONDO) { doc.addPage(); y = M; } };
  const blu = () => doc.setTextColor(31, 78, 121);
  const nero = () => doc.setTextColor(0, 0, 0);

  const cinemaSala = (s.cinema || '(cinema non indicato)') + (s.sala ? ' - ' + s.sala : '');
  if (conf.intestazione) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); blu();
    doc.text(conf.intestazione.toUpperCase(), M, y + 3); y += 9;
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); nero();
  doc.text('Report sopralluogo', M, y + 5); y += 11;
  doc.setFontSize(12);
  doc.text(cinemaSala, M, y + 4); y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(dataIt(s.data), M, y + 4); y += 7;
  doc.setDrawColor(31, 78, 121); doc.setLineWidth(0.8);
  doc.line(M, y, M + L, y); y += 7;

  let n = 0;
  const W = (L - 6) / 2;        // larghezza massima di una foto (due per riga)
  const ALT_MAX = 65;           // altezza massima di una foto in mm: quelle verticali si rimpiccioliscono
  let salaInAttesa = null;      // il titolo della sala si disegna insieme alla prima voce, mai da solo
  for (const el of elementiReport(voci)) {
    if (el.sala) { salaInAttesa = el.sala; continue; }
    const v = el.voce;

    // Preparo le righe di foto (due per riga) per sapere quanto spazio serve prima di disegnare i titoli.
    const foto = (await dbIdx('foto', 'vocId', v.id)).sort(perOrdine);
    const righe = [];
    for (let i = 0; i < foto.length; i += 2) {
      const riga = [];
      for (const f of foto.slice(i, i + 2)) {
        n++;
        const bmp = await createImageBitmap(f.blob);
        const h0 = W * bmp.height / bmp.width;
        const k = Math.min(1, ALT_MAX / h0);
        if (bmp.close) bmp.close();
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        const testo = doc.splitTextToSize('Foto ' + n + (f.didascalia ? ' - ' + f.didascalia : ''), W);
        riga.push({ w: W * k, h: h0 * k, testo, dati: new Uint8Array(await f.blob.arrayBuffer()) });
      }
      righe.push({ foto: riga, alt: Math.max(...riga.map(r => r.h + 5 + r.testo.length * 4)) + 4 });
    }

    // Sala, titolo e inizio della nota devono stare sulla stessa pagina della prima riga di foto.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const righeNota = v.nota ? doc.splitTextToSize(v.nota, L) : [];
    const necessario = (salaInAttesa ? 14 : 0) + 9 + Math.min(righeNota.length, 3) * 5.5 +
      (righe.length ? righe[0].alt : 0);
    if (y > M && y + necessario > FONDO) { doc.addPage(); y = M; }

    if (salaInAttesa) {
      doc.setFillColor(234, 241, 247); doc.rect(M, y, L, 9, 'F');
      doc.setFillColor(31, 78, 121); doc.rect(M, y, 1.6, 9, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); blu();
      doc.text(salaInAttesa, M + 4, y + 6.3); y += 14;
      salaInAttesa = null;
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); blu();
    doc.text(v.titolo, M, y + 5); y += 9;
    nero();

    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    for (const riga of righeNota) {
      spazio(6);
      doc.text(riga, M, y + 4); y += 5.5;
    }
    if (righeNota.length) y += 2;

    for (const r of righe) {
      spazio(r.alt);
      r.foto.forEach((f, k) => {
        const x = M + k * (W + 6);
        doc.addImage(f.dati, 'JPEG', x, y, f.w, f.h);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); nero();
        doc.text(f.testo, x, y + f.h + 4);
      });
      y += r.alt;
    }
    y += 4;
  }

  const pagine = doc.getNumberOfPages();
  for (let p = 1; p <= pagine; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text(`Pagina ${p} di ${pagine}`, 105, 290, { align: 'center' });
  }

  const nome = ('Sopralluogo_' + (s.cinema || 'cinema') + '_' + (s.data || '')).replace(/[^A-Za-z0-9]+/g, '_') + '.pdf';
  return { blob: doc.output('blob'), nome, titolo: 'Report sopralluogo - ' + cinemaSala + ' - ' + dataIt(s.data) };
}

function scaricaFile(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Il PDF viene salvato nei Download del telefono e si apre con il lettore PDF (da lì si può anche condividere).
async function anteprimaPdf(id) {
  const { blob, nome } = await creaPdf(id);
  scaricaFile(blob, nome);
}

// L'indirizzo si imposta in Impostazioni; se manca lo chiedo qui e lo ricordo.
async function emailDestinatario() {
  if (!conf.email) {
    const e = (prompt('A quale indirizzo email vuoi ricevere i report?') || '').trim();
    if (e) {
      conf.email = e;
      await salvaConf();
    }
  }
  return conf.email;
}

async function inviaEmail(id) {
  const { blob, nome, titolo } = await creaPdf(id);
  const file = new File([blob], nome, { type: 'application/pdf' });

  // Con il sito in https il telefono apre il menu "Condividi" con il PDF già allegato (Gmail incluso).
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: titolo, text: titolo });
    } catch (e) { /* condivisione annullata */ }
    return;
  }

  // Senza https non si possono allegare file da una pagina web: scarico il PDF e apro la mail già indirizzata.
  scaricaFile(blob, nome);
  alert('Ho salvato il PDF nei Download. Si apre ora la mail: allega il file "' + nome + '".');
  location.href = 'mailto:' + (await emailDestinatario()) + '?subject=' + encodeURIComponent(titolo) +
    '&body=' + encodeURIComponent('In allegato il report del sopralluogo.');
}

// ---------- Esporta / importa ----------
// Un solo file .json con sopralluoghi, voci, note e foto: serve da backup e per portare un sopralluogo su un altro
// dispositivo (ad esempio dal telefono al PC per consultarlo).
const FORMATO = 'sopralluoghi-backup';

function blobInDataUrl(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlInBlob(url) {
  return (await fetch(url)).blob();
}

// completo = true: include anche le impostazioni (intestazione, email, elenco voci).
async function esportaBackup(ids, completo) {
  const elenco = [];
  for (const id of ids) {
    const s = await dbGet('sopralluoghi', id);
    if (!s) continue;
    const voci = await dbIdx('voci', 'sopId', id);
    const foto = [];
    for (const f of await dbIdx('foto', 'sopId', id)) {
      foto.push(Object.assign({}, f, { blob: undefined, dati: await blobInDataUrl(f.blob) }));
    }
    elenco.push({ sopralluogo: s, voci, foto });
  }

  const contenuto = { formato: FORMATO, versione: 1, creato: new Date().toISOString(), sopralluoghi: elenco };
  if (completo) contenuto.impostazioni = conf;

  const singolo = elenco.length === 1 && !completo ? elenco[0].sopralluogo : null;
  const nome = singolo
    ? ('Sopralluogo_' + (singolo.cinema || 'cinema') + '_' + (singolo.data || '')).replace(/[^A-Za-z0-9]+/g, '_') + '.json'
    : 'Backup_sopralluoghi_' + oggi() + '.json';
  scaricaFile(new Blob([JSON.stringify(contenuto)], { type: 'application/json' }), nome);
}

// I sopralluoghi già presenti (stesso identificativo) non vengono toccati.
async function importaFile(file) {
  let contenuto;
  try {
    contenuto = JSON.parse(await file.text());
  } catch (e) {
    throw new Error('il file non è leggibile');
  }
  if (!contenuto || contenuto.formato !== FORMATO || !Array.isArray(contenuto.sopralluoghi)) {
    throw new Error('non è un file di sopralluoghi');
  }

  let nuovi = 0;
  let presenti = 0;
  for (const el of contenuto.sopralluoghi) {
    if (await dbGet('sopralluoghi', el.sopralluogo.id)) { presenti++; continue; }
    await dbPut('sopralluoghi', el.sopralluogo);
    for (const v of el.voci) await dbPut('voci', v);
    for (const f of el.foto) {
      const { dati: uri, ...resto } = f;
      await dbPut('foto', Object.assign({}, resto, { blob: await dataUrlInBlob(uri) }));
    }
    nuovi++;
  }

  // Le impostazioni si importano solo dove sono ancora vuote, senza cancellare quelle già scritte.
  const imp = contenuto.impostazioni;
  if (imp) {
    if (!conf.intestazione && imp.intestazione) conf.intestazione = imp.intestazione;
    if (!conf.email && imp.email) conf.email = imp.email;
    for (const t of imp.voci || []) if (!giaInElenco(t)) conf.voci.push(t);
    await salvaConf();
  }

  return 'Importati ' + nuovi + ' sopralluoghi' + (presenti ? ', ' + presenti + ' già presenti (non modificati)' : '') + '.';
}

// ---------- Avvio ----------
async function route() {
  liberaUrl();
  const [, tipo, id] = location.hash.split('/');
  if (tipo === 's') await vistaSopralluogo(id);
  else if (tipo === 'r') await vistaReport(id);
  else if (tipo === 'impostazioni') vistaImpostazioni();
  else await vistaElenco();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

apriDb().then(caricaConf).then(route).catch(err => {
  app.innerHTML = `<p class="vuoto">Errore nell'apertura dell'archivio: ${esc(err && err.message)}</p>`;
});

// Chiede al telefono di non cancellare i dati per fare spazio.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// Funzionamento offline: attivo solo se l'app è servita in https (o da localhost).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
