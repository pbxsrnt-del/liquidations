/* Cloudflare Pages advanced-mode worker. Copied into dist/ by build/package.py.

   Everything that is a plain file (pages, CSS, photos in assets/items/) is
   served straight from the upload. This worker only adds the phone editor:

     GET  /data/live.js          item edits made on the phone, as JS
     GET  /photos/<id>.jpg       photos taken on the phone
     GET  /sitemap.xml           the uploaded sitemap plus phone-listed items
     /api/admin/...              the editor's own calls, password protected

   Needs, in the Pages project settings:
     Bindings > D1 database, variable name DB
     Variables and Secrets > secret ADMIN_PASSWORD
   Without them the public site still works exactly as uploaded, and the
   editor says it is not set up yet. Tables are created on first use. */

const PUBLIC_FIELDS = ['title', 'brand', 'size', 'color', 'condition', 'notes',
                       'photos', 'status', 'price', 'updated'];
const MAX_PHOTO = 4 * 1024 * 1024;
const IMAGE_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};

let ready = null;
function ensure(db) {
  if (!ready) {
    ready = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS items (
        sku TEXT PRIMARY KEY, data TEXT NOT NULL, private TEXT, updated INTEGER NOT NULL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, bytes BLOB NOT NULL,
        created INTEGER NOT NULL, inbox INTEGER NOT NULL DEFAULT 0, sku TEXT)`),
    ]).catch(e => { ready = null; throw e; });
  }
  return ready;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});

function publicRecord(raw) {
  const d = JSON.parse(raw), out = {};
  for (const k of PUBLIC_FIELDS) if (d[k] !== undefined && d[k] !== '') out[k] = d[k];
  return out;
}

async function sha(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function authorised(request, env) {
  const given = request.headers.get('x-admin-key') || '';
  const a = await sha(given), b = await sha(env.ADMIN_PASSWORD);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 && given.length > 0;
}

/* ---------------- public ---------------- */

async function liveJs(env) {
  let map = {};
  if (env.DB) {
    try {
      await ensure(env.DB);
      const {results} = await env.DB.prepare('SELECT sku, data FROM items').all();
      for (const r of results) map[r.sku] = publicRecord(r.data);
    } catch (e) { map = {}; }
  }
  return new Response('window.LIQ_LIVE = ' + JSON.stringify(map) + ';\n', {headers: {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'public, max-age=0, must-revalidate'}});
}

async function photo(request, env, ctx, id) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  if (!env.DB) return new Response('Not found', {status: 404});
  await ensure(env.DB);
  const row = await env.DB.prepare('SELECT type, bytes FROM photos WHERE id = ?').bind(id).first();
  if (!row) return new Response('Not found', {status: 404});
  const res = new Response(new Uint8Array(row.bytes), {headers: {
    'content-type': row.type,
    'cache-control': 'public, max-age=31536000, immutable',   /* ids are never reused */
    'x-content-type-options': 'nosniff'}});
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

async function sitemap(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!env.DB || !res.ok) return res;
  let xml = await res.text();
  try {
    await ensure(env.DB);
    const {results} = await env.DB.prepare('SELECT sku, data FROM items').all();
    const origin = 'https://liquidations.city';
    const day = new Date().toISOString().slice(0, 10);
    const add = results.filter(r => {
      const d = JSON.parse(r.data);
      return d.photos && d.photos.length && d.status !== 'sold' && !xml.includes(`sku=${r.sku}<`);
    }).map(r => `  <url><loc>${origin}/item?sku=${r.sku}</loc><lastmod>${day}</lastmod></url>\n`).join('');
    xml = xml.replace('</urlset>', add + '</urlset>');
  } catch (e) { /* fall back to the uploaded file */ }
  return new Response(xml, {headers: {'content-type': 'application/xml; charset=utf-8'}});
}

/* ---------------- editor API ---------------- */

async function api(request, env, path) {
  if (!env.DB || !env.ADMIN_PASSWORD) {
    return json({error: 'not_set_up', message: 'The editor is not connected yet. See EDITOR-SETUP.md.'}, 503);
  }
  if (!(await authorised(request, env))) return json({error: 'wrong_password'}, 401);
  await ensure(env.DB);
  const db = env.DB, m = request.method;

  if (path === 'ping') return json({ok: true});

  if (path === 'state' && m === 'GET') {
    const items = (await db.prepare('SELECT sku, data, private, updated FROM items').all()).results;
    const inbox = (await db.prepare(
      'SELECT id, type, created FROM photos WHERE inbox = 1 ORDER BY created DESC').all()).results;
    const out = {};
    for (const r of items) out[r.sku] = {record: JSON.parse(r.data), private: r.private || '', updated: r.updated};
    return json({items: out, inbox: inbox.map(p => ({id: p.id, path: `photos/${p.id}.${IMAGE_TYPES[p.type]}`, created: p.created}))});
  }

  if (path === 'photo' && m === 'POST') {
    const type = (request.headers.get('content-type') || '').split(';')[0].trim();
    if (!IMAGE_TYPES[type]) return json({error: 'bad_type', message: 'Photos must be JPEG, PNG or WebP.'}, 415);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_PHOTO) return json({error: 'too_big', message: 'Photo is over 4 MB after resizing.'}, 413);
    const url = new URL(request.url);
    const inbox = url.searchParams.get('inbox') === '1' ? 1 : 0;
    const sku = url.searchParams.get('sku') || null;
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    await db.prepare('INSERT INTO photos (id, type, bytes, created, inbox, sku) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, type, bytes, Date.now(), inbox, sku).run();
    return json({id, path: `photos/${id}.${IMAGE_TYPES[type]}`});
  }

  let mm = path.match(/^inbox\/([a-f0-9]{20})$/);
  if (mm) {
    if (m === 'DELETE') {
      await db.prepare('DELETE FROM photos WHERE id = ? AND inbox = 1').bind(mm[1]).run();
      return json({ok: true});
    }
    if (m === 'POST') {          /* filed to an item: leaves the inbox, keeps the bytes */
      const {sku} = await request.json();
      await db.prepare('UPDATE photos SET inbox = 0, sku = ? WHERE id = ?').bind(sku || null, mm[1]).run();
      return json({ok: true});
    }
  }

  mm = path.match(/^item\/(\d{4}-\d{4})$/);
  if (mm) {
    const sku = mm[1];
    if (m === 'PUT') {
      const body = await request.json();
      const rec = {}, src = body.record || {};
      for (const k of PUBLIC_FIELDS) if (src[k] !== undefined) rec[k] = src[k];
      rec.photos = Array.isArray(rec.photos) ? rec.photos.filter(p =>
        typeof p === 'string' && /^(photos\/[a-f0-9]{20}\.(jpg|png|webp)|assets\/items\/[\w.-]+)$/.test(p)) : [];
      if (!['available', 'hold', 'sold'].includes(rec.status)) rec.status = 'available';
      if (rec.price !== undefined && (typeof rec.price !== 'number' || !(rec.price >= 0))) delete rec.price;
      for (const k of ['title', 'brand', 'size', 'color', 'condition', 'notes'])
        if (rec[k] !== undefined) rec[k] = String(rec[k]).slice(0, 2000);
      rec.updated = Date.now();
      await db.prepare(`INSERT INTO items (sku, data, private, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT(sku) DO UPDATE SET data = excluded.data, private = excluded.private, updated = excluded.updated`)
        .bind(sku, JSON.stringify(rec), String(body.private || '').slice(0, 4000), rec.updated).run();
      return json({ok: true, record: rec});
    }
    if (m === 'DELETE') {        /* back to whatever data/details.js says */
      await db.prepare('DELETE FROM items WHERE sku = ?').bind(sku).run();
      return json({ok: true});
    }
  }

  if (path === 'export' && m === 'GET') {   /* backup of every phone edit, private notes included */
    const items = (await db.prepare('SELECT sku, data, private, updated FROM items ORDER BY sku').all()).results;
    return json(items.map(r => ({sku: r.sku, record: JSON.parse(r.data), private: r.private, updated: r.updated})));
  }

  return json({error: 'not_found'}, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p.startsWith('/api/admin/')) return await api(request, env, p.slice('/api/admin/'.length));
      if (p === '/data/live.js' || p === '/data/live') return await liveJs(env);
      const ph = p.match(/^\/photos\/([a-f0-9]{20})\.(jpg|png|webp)$/);
      if (ph) return await photo(request, env, ctx, ph[1]);
      if (p === '/sitemap.xml') return await sitemap(request, env);
    } catch (e) {
      if (p.startsWith('/api/')) return json({error: 'server', message: String(e && e.message || e)}, 500);
      throw e;
    }
    return env.ASSETS.fetch(request);
  }
};
