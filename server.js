// Serveur du jeu de rôle, version hébergement gratuit (Render + Firebase).
// Variables d'environnement : KEY (mot de passe, lettres/chiffres) et DB_URL (adresse Firebase).
const http = require('http'), fs = require('fs');
const KEY = process.env.KEY || '';
const PORT = process.env.PORT || 3000;
const FB = (process.env.DB_URL || '').replace(/\/$/, '');
if (!/^[A-Za-z0-9_-]{6,}$/.test(KEY)) {
  console.error('KEY manquante ou invalide : 6 caractères minimum, lettres/chiffres uniquement.');
  process.exit(1);
}
const REMOTE = FB + '/g/' + KEY + '.json';

let db = { players: {}, pins: [] };
let dirty = false, timer = null;

async function load() {
  if (FB) {
    const r = await fetch(REMOTE);
    if (!r.ok) throw new Error('Firebase a répondu ' + r.status);
    const d = await r.json();
    if (d) db = { players: d.players || {}, pins: Array.isArray(d.pins) ? d.pins : Object.values(d.pins || {}) };
  } else {
    try { db = JSON.parse(fs.readFileSync('data.json', 'utf8')); } catch (e) {}
  }
}
function push() {
  clearTimeout(timer); timer = null;
  if (!dirty) return;
  dirty = false;
  const body = JSON.stringify(db);
  if (FB) fetch(REMOTE, { method: 'PUT', body }).catch(e => console.error('sauvegarde:', e.message));
  else fs.writeFile('data.json', body, () => {});
}
function save(now) { // les positions sont groupées toutes les 5 s, les pins sont sauvés tout de suite
  dirty = true;
  if (now) return push();
  if (!timer) timer = setTimeout(push, 5000);
}
const reply = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ping') return reply(res, 200, 'ok', 'text/plain');
  if (url.searchParams.get('key') !== KEY) return reply(res, 401, { error: 'cle invalide' });
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e5) req.destroy(); });
  req.on('end', () => {
    try {
      const p = url.pathname;
      if (req.method === 'GET' && p === '/')
        return reply(res, 200, fs.readFileSync(__dirname + '/map.html', 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api') return reply(res, 200, db);

      if (req.method === 'POST' && p === '/pub') { // OwnTracks (mode HTTP)
        const d = JSON.parse(raw || '{}');
        if (d._type === 'location' && d.lat != null) {
          const name = req.headers['x-limit-u'] || d.tid || 'joueur';
          db.players[name] = { lat: d.lat, lon: d.lon, t: (d.tst || Date.now() / 1000) * 1000, batt: d.batt };
          save(false);
        }
        return reply(res, 200, []);
      }
      if (req.method === 'POST' && p === '/pin') {
        const d = JSON.parse(raw), id = Date.now().toString(36);
        db.pins.push({
          id, lat: +d.lat, lon: +d.lon,
          type: d.type || 'autre',
          title: String(d.title || '').slice(0, 80),
          desc: String(d.desc || '').slice(0, 1000)
        });
        save(true);
        return reply(res, 200, { ok: true, id });
      }
      if (req.method === 'PUT' && p === '/pin') { // modifier un pin
        const d = JSON.parse(raw), pin = db.pins.find(x => x.id === url.searchParams.get('id'));
        if (!pin) return reply(res, 404, { error: 'pin introuvable' });
        if (isFinite(+d.lat) && isFinite(+d.lon)) { pin.lat = +d.lat; pin.lon = +d.lon; }
        pin.type = d.type || pin.type;
        pin.title = String(d.title == null ? pin.title : d.title).slice(0, 80);
        pin.desc = String(d.desc == null ? pin.desc : d.desc).slice(0, 1000);
        save(true);
        return reply(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && p === '/pin') {
        db.pins = db.pins.filter(x => x.id !== url.searchParams.get('id'));
        save(true);
        return reply(res, 200, { ok: true });
      }
      reply(res, 404, { error: 'introuvable' });
    } catch (e) { reply(res, 400, { error: 'requete invalide' }); }
  });
}

load()
  .then(() => http.createServer(handler).listen(PORT, () => console.log('Serveur lancé sur le port ' + PORT)))
  .catch(e => { console.error('Impossible de charger les données :', e.message); process.exit(1); });
