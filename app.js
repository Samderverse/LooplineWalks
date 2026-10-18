/* Loopline Walks: map, route planner and walk recorder for the Looplines around Worsley & Walkden */
(() => {
'use strict';

const BBOX = '53.465,-2.56,53.55,-2.29'; // Monton/Eccles to Astley/Tyldesley and Little Hulton
const LINE_QUERY = `way["highway"]["name"~"loop ?line",i](${BBOX})`;
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

const $ = s => document.querySelector(s);
const tok = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

function hav(a, b) {
  const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const km = (m, d = 1) => (m / 1000).toFixed(d);
const mi = m => (m / 1609.344).toFixed(1);
function dur(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
function mins(min) { min = Math.round(min); return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`; }

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 260); }, ms);
}
const sub = t => { $('#sub').textContent = t; };

/* ---------- Map ---------- */
const map = L.map('map', { zoomControl: false, tap: true }).setView([53.507, -2.405], 13);
map.attributionControl.setPrefix(false);
let mapStyle = store.get('ll_style') || 'clean', base = null;
function setBase() {
  if (base) map.removeLayer(base);
  const dark = darkMQ.matches;
  if (mapStyle === 'clean') {
    base = L.tileLayer(dark ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO' });
  } else {
    base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© OpenStreetMap contributors', className: dark ? 'tiles-dim' : '' });
  }
  base.addTo(map); base.bringToBack();
  const b = $('#styleBtn');
  b.setAttribute('aria-pressed', mapStyle === 'detailed');
  b.setAttribute('aria-label', mapStyle === 'detailed' ? 'Switch to clean map' : 'Switch to detailed footpath map');
}
$('#styleBtn').onclick = () => {
  mapStyle = mapStyle === 'clean' ? 'detailed' : 'clean'; store.set('ll_style', mapStyle); setBase();
  toast(mapStyle === 'detailed' ? 'Detailed map: shows every footpath' : 'Clean map');
};
setBase();

const lineLayer = L.layerGroup().addTo(map);
const amLayer = L.layerGroup();
const routeLayer = L.layerGroup().addTo(map);
const viewLayer = L.layerGroup().addTo(map);

const sheet = $('#sheet');
function fit(bounds, maxZoom = 17) {
  if (!bounds || !bounds.isValid()) return;
  map.fitBounds(bounds, {
    paddingTopLeft: [24, 90],
    paddingBottomRight: [70, sheet.getBoundingClientRect().height + 16],
    maxZoom
  });
}

/* ---------- Lines ---------- */
let lines = {}, allPts = [], allBounds = null, polys = [];

function glyph(ways) {
  // Small silhouette of a line's actual shape, for the list
  let pts = ways.flat(); if (!pts.length) return '';
  const k = Math.cos(pts[0][0] * Math.PI / 180);
  const xs = pts.map(p => p[1] * k), ys = pts.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min(46 / (x1 - x0 || 1), 24 / (y1 - y0 || 1));
  const ox = (50 - (x1 - x0) * s) / 2, oy = (28 - (y1 - y0) * s) / 2;
  const d = ways.map(w => 'M' + w.map(p => ((p[1] * k - x0) * s + ox).toFixed(1) + ' ' + ((y1 - p[0]) * s + oy).toFixed(1)).join('L')).join('');
  return `<svg viewBox="0 0 50 28" aria-hidden="true"><path d="${d}" fill="none" stroke="${tok('--rail')}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function drawLines(data) {
  lineLayer.clearLayers(); lines = {}; allPts = []; polys = [];
  for (const w of data.elements || []) {
    if (!w.geometry) continue;
    const pts = w.geometry.map(g => [g.lat, g.lon]);
    const name = (w.tags && w.tags.name) || 'Loopline';
    let len = 0; for (let i = 1; i < pts.length; i++) len += hav(pts[i - 1], pts[i]);
    const casing = L.polyline(pts, { color: tok('--surface'), weight: 10, opacity: .95, interactive: false }).addTo(lineLayer);
    const main = L.polyline(pts, { color: tok('--rail'), weight: 5.5 }).addTo(lineLayer)
      .bindPopup(`<b>${esc(name)}</b><br><small>Tap “Plan” to build a walk</small>`);
    polys.push([casing, main]);
    const l = lines[name] || (lines[name] = { len: 0, ways: [] });
    l.len += len; l.ways.push(pts); allPts.push(...pts);
  }
  if (allPts.length) allBounds = L.latLngBounds(allPts);
  renderLines();
}

function renderLines() {
  const names = Object.keys(lines).sort((a, b) => lines[b].len - lines[a].len);
  const total = names.reduce((s, n) => s + lines[n].len, 0);
  $('#netKm').textContent = total ? km(total) : '–';
  if (total) sub(`${km(total)} km of paths · ${mi(total)} mi`);
  $('#lineList').innerHTML = names.length ? names.map(n => `
    <button class="row" data-n="${esc(n)}">
      <span class="glyph">${glyph(lines[n].ways)}</span>
      <span class="txt"><span class="name">${esc(n)}</span><span class="meta">${km(lines[n].len, 2)} km · ${mi(lines[n].len)} mi</span></span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`).join('')
    : '<p class="hint">No Loopline paths came back from the map data. Check your signal and reopen the app.</p>';
  $('#lineList').querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
    setSheet(false); fit(L.latLngBounds(lines[b.dataset.n].ways.flat()), 16);
  });
}

async function overpass(q) {
  for (const u of OVERPASS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (r.ok) return await r.json();
    } catch (e) {}
  }
  throw new Error('busy');
}

async function loadLines() {
  const cached = store.get('ll_lines');
  if (cached) { drawLines(cached.data); fit(allBounds, 15); }
  if (cached && Date.now() - cached.t < 7 * 864e5) return;
  try {
    const d = await overpass(`[out:json][timeout:25];${LINE_QUERY};out geom;`);
    store.set('ll_lines', { t: Date.now(), data: d });
    const first = !cached; drawLines(d); if (first) fit(allBounds, 15);
  } catch (e) {
    if (!cached) { sub('Offline'); $('#lineList').innerHTML = '<p class="hint">Couldn’t reach the map data server. Check your signal and reopen the app.</p>'; }
  }
}
$('#fitBtn').onclick = () => { follow(false); fit(allBounds, 15); };

/* ---------- Cafés, pubs, toilets, parking ---------- */
let amLoaded = false;
$('#amBtn').onclick = async () => {
  const on = !map.hasLayer(amLayer); $('#amBtn').setAttribute('aria-pressed', on);
  if (!on) { map.removeLayer(amLayer); return; }
  amLayer.addTo(map); if (amLoaded) return;
  toast('Finding cafés, pubs, toilets and parking…');
  try {
    const cached = store.get('ll_am');
    const d = cached && Date.now() - cached.t < 14 * 864e5 ? cached.data : await overpass(
      `[out:json][timeout:25];${LINE_QUERY}->.l;(node(around.l:150)["amenity"~"^(cafe|pub|toilets|parking|drinking_water)$"];way(around.l:150)["amenity"="parking"];);out center;`);
    store.set('ll_am', { t: Date.now(), data: d });
    const lab = { cafe: 'Café', pub: 'Pub', toilets: 'WC', parking: 'P', drinking_water: 'Water' };
    let n = 0;
    (d.elements || []).forEach(e => {
      const la = e.lat || (e.center && e.center.lat), lo = e.lon || (e.center && e.center.lon); if (!la) return;
      const t = e.tags.amenity; n++;
      L.marker([la, lo], { icon: L.divIcon({ className: '', html: `<span class="am">${lab[t]}</span>`, iconSize: null, iconAnchor: [14, 10] }) })
        .bindPopup(`<b>${esc(e.tags.name || lab[t])}</b>${e.tags.opening_hours ? '<br><small>' + esc(e.tags.opening_hours) + '</small>' : ''}`)
        .addTo(amLayer);
    });
    amLoaded = true; toast(`${n} stops within 150 m of the lines`);
  } catch (e) { toast('Couldn’t load stops right now'); $('#amBtn').setAttribute('aria-pressed', false); map.removeLayer(amLayer); }
};

/* ---------- Location ---------- */
let me = null, meMk = null, meAcc = null, watchId = null, following = false;
const waiters = [];
function follow(on) { following = on; $('#locBtn').setAttribute('aria-pressed', on); }
map.on('dragstart', () => follow(false));

function startWatch() {
  if (watchId !== null) return;
  if (!navigator.geolocation) { toast('Location isn’t available on this device'); return; }
  watchId = navigator.geolocation.watchPosition(p => {
    const first = !me;
    me = [p.coords.latitude, p.coords.longitude];
    const acc = p.coords.accuracy;
    if (!meMk) {
      meAcc = L.circle(me, { radius: acc, color: tok('--me'), weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
      meMk = L.marker(me, { icon: L.divIcon({ className: '', html: '<div class="me-pulse"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    }
    meMk.setLatLng(me); meAcc.setLatLng(me).setRadius(acc);
    if (following) first ? map.setView(me, Math.max(map.getZoom(), 16)) : map.panTo(me, { animate: true });
    onFix(me, acc);
    waiters.splice(0).forEach(f => f(me));
  }, err => {
    toast(err.code === 1 ? 'Location is blocked. Allow it in Settings › Privacy › Location Services.' : 'No GPS fix yet. Try again in the open.', 4200);
    waiters.splice(0).forEach(f => f(null)); watchId = null; follow(false);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
}
function whereAmI() {
  return new Promise(res => { if (me) return res(me); waiters.push(res); startWatch(); toast('Finding you…'); });
}
$('#locBtn').onclick = () => {
  if (following) { follow(false); return; }
  follow(true);
  if (me) map.setView(me, Math.max(map.getZoom(), 16)); else { startWatch(); toast('Finding you…'); }
};

/* ---------- Bottom sheet & tabs ---------- */
let tab = 'lines';
function setSheet(open) { sheet.classList.toggle('open', open); }
const grab = $('#grab'); let y0 = null;
grab.addEventListener('pointerdown', e => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
grab.addEventListener('pointerup', e => {
  if (y0 === null) return; const dy = e.clientY - y0; y0 = null;
  setSheet(Math.abs(dy) < 8 ? !sheet.classList.contains('open') : dy < 0);
});
grab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(!sheet.classList.contains('open')); } });

function selectTab(t, open = true) {
  tab = t;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
  ['lines', 'plan', 'walk', 'saved'].forEach(x => { $('#p-' + x).hidden = x !== t; });
  if (t !== 'saved') viewLayer.clearLayers();
  if (t === 'plan' && !pts.length) toast('Tap the map to drop your first stop');
  if (open) setSheet(true);
  store.set('ll_tab', t);
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => selectTab(b.dataset.t));

/* ---------- Route planner ---------- */
let pts = [], mks = [], routeLine = null, ctrl = null, lastDist = 0;
const paceEls = document.querySelectorAll('input[name=pace]');
const pace = () => +document.querySelector('input[name=pace]:checked').value;
const savedPace = store.get('ll_pace'); if (savedPace) paceEls.forEach(i => { i.checked = +i.value === savedPace; });
paceEls.forEach(i => i.onchange = () => { store.set('ll_pace', pace()); setStats(lastDist); });

function renderMarkers() {
  mks.forEach(m => routeLayer.removeLayer(m)); mks = [];
  pts.forEach((p, i) => {
    const last = i === pts.length - 1 && i > 0 && hav(p, pts[0]) < 5;
    if (last) return; // loop end sits on the start
    const m = L.marker(p, {
      draggable: true, zIndexOffset: 500,
      icon: L.divIcon({ className: '', html: `<div class="wp${i === 0 ? ' start' : ''}">${i === 0 ? 'S' : i}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] })
    }).addTo(routeLayer);
    m.on('dragend', () => { const ll = m.getLatLng(); pts[i] = [ll.lat, ll.lng]; route(); });
    mks.push(m);
  });
}
function setStats(m) {
  lastDist = m;
  $('#dKm').textContent = km(m); $('#dMi').textContent = mi(m);
  $('#dTime').textContent = mins(m / 1000 / pace() * 60);
}
async function route() {
  renderMarkers();
  if (routeLine) { routeLayer.removeLayer(routeLine); routeLine = null; }
  store.set('ll_draft', pts);
  if (pts.length < 2) {
    setStats(0);
    $('#planHint').textContent = pts.length ? 'Now tap where you want to walk to.' : 'Tap the map to drop stops. The route follows real footpaths, and you can drag any stop.';
    return;
  }
  if (ctrl) ctrl.abort(); ctrl = new AbortController();
  const coords = pts.map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';');
  $('#planHint').textContent = 'Working out the walking route…';
  try {
    const r = await fetch(ROUTER + coords + '?overview=full&geometries=geojson', { signal: ctrl.signal });
    const d = await r.json();
    if (!d.routes || !d.routes.length) throw new Error('none');
    const g = d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    routeLine = L.polyline(g, { color: tok('--signal'), weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    setStats(d.routes[0].distance);
    $('#planHint').textContent = 'Drag a stop to reshape the route, or add more by tapping the map.';
  } catch (e) {
    if (e.name === 'AbortError') return;
    let m = 0; for (let i = 1; i < pts.length; i++) m += hav(pts[i - 1], pts[i]);
    routeLine = L.polyline(pts, { color: tok('--signal'), weight: 4, dashArray: '2 10', lineCap: 'round' }).addTo(routeLayer);
    setStats(m);
    $('#planHint').textContent = 'No signal for routing, so this is the straight-line distance between stops.';
  }
}
map.on('click', e => {
  if (tab !== 'plan') return;
  pts.push([e.latlng.lat, e.latlng.lng]); route();
});
$('#undo').onclick = () => { pts.pop(); route(); };
$('#clear').onclick = () => { pts = []; route(); };
$('#loop').onclick = () => { if (pts.length > 1) { pts.push(pts[0]); route(); } else toast('Add at least two stops first'); };
$('#out').onclick = () => { if (pts.length > 1) { pts = pts.concat(pts.slice(0, -1).reverse()); route(); } else toast('Add at least two stops first'); };
$('#meStart').onclick = async () => { const p = await whereAmI(); if (!p) return; pts.unshift(p); route(); map.panTo(p); };

$('#nearestBtn').onclick = async () => {
  if (!allPts.length) { toast('The Loopline paths haven’t loaded yet'); return; }
  const p = await whereAmI(); if (!p) return;
  let best = null, bd = Infinity;
  for (const q of allPts) { const d = hav(p, q); if (d < bd) { bd = d; best = q; } }
  pts = [p, best]; selectTab('plan', false); setSheet(false); await route();
  fit(L.latLngBounds([p, best]), 17);
};

/* ---------- Walk recorder ---------- */
let rec = null, recTimer = null, wake = null;
async function wakeOn() { try { wake = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) {} }
function wakeOff() { try { wake && wake.release(); } catch (e) {} wake = null; }
document.addEventListener('visibilitychange', () => { if (rec && !rec.paused && document.visibilityState === 'visible') wakeOn(); });
const recElapsed = () => rec ? rec.elapsed + (rec.paused ? 0 : Date.now() - rec.runStart) : 0;

function onFix(p, acc) {
  if (!rec || rec.paused || acc > 35) return;
  const last = rec.pts[rec.pts.length - 1];
  if (last && hav(last, p) < 6) return;
  if (last) rec.dist += hav(last, p);
  rec.pts.push(p); rec.line.addLatLng(p);
  renderRec();
}
function renderRec() {
  const t = recElapsed();
  $('#rKm').textContent = km(rec ? rec.dist : 0, 2);
  $('#rTime').textContent = dur(t);
  $('#rPace').textContent = rec && rec.dist > 50 ? dur(t / (rec.dist / 1000)) : '–';
}
$('#recStart').onclick = () => {
  rec = { pts: [], dist: 0, elapsed: 0, runStart: Date.now(), startedAt: Date.now(), paused: false,
          line: L.polyline([], { color: tok('--rec'), weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(map) };
  follow(true); startWatch(); if (me) map.setView(me, 17);
  $('#recIdle').hidden = true; $('#recLive').hidden = false; $('#recPause').textContent = 'Pause';
  $('#recHint').textContent = 'Recording. Keep the app open on screen for the best GPS track.';
  sub('● Recording'); wakeOn();
  recTimer = setInterval(renderRec, 1000); renderRec();
};
$('#recPause').onclick = () => {
  if (!rec) return;
  if (rec.paused) { rec.runStart = Date.now(); rec.paused = false; $('#recPause').textContent = 'Pause'; sub('● Recording'); wakeOn(); }
  else { rec.elapsed += Date.now() - rec.runStart; rec.paused = true; $('#recPause').textContent = 'Resume'; sub('Paused'); wakeOff(); }
  renderRec();
};
$('#recStop').onclick = () => {
  if (!rec) return;
  const t = recElapsed(); clearInterval(recTimer); wakeOff();
  if (rec.pts.length >= 2 && rec.dist >= 30) {
    const s = store.get('ll_saved') || [];
    const name = 'Walk on ' + new Date(rec.startedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    s.unshift({ id: Date.now(), type: 'walk', name, pts: rec.pts, dist: rec.dist, ms: t, date: new Date(rec.startedAt).toISOString() });
    store.set('ll_saved', s); renderSaved();
    toast(`Saved: ${km(rec.dist, 2)} km in ${dur(t)}`);
  } else toast('Too short to save');
  map.removeLayer(rec.line); rec = null;
  $('#recIdle').hidden = false; $('#recLive').hidden = true;
  $('#recHint').textContent = 'Record a walk as you go. Keep the app open: your phone pauses GPS for web apps when the screen locks.';
  renderRec(); renderLines();
};

/* ---------- Saved ---------- */
function renderSaved() {
  const s = store.get('ll_saved') || [];
  $('#savedList').innerHTML = s.length ? s.map((w, i) => {
    const d = new Date(w.date || Date.now());
    const when = isNaN(d) ? (w.date || '') : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const isWalk = w.type === 'walk';
    return `<div class="row" data-o="${i}" role="button" tabindex="0">
      <span class="glyph">${glyph([w.pts])}</span>
      <span class="txt"><span class="name"><span class="tag${isWalk ? ' rec' : ''}">${isWalk ? 'Walked' : 'Route'}</span>${esc(w.name)}</span>
        <span class="meta">${km(w.dist, 2)} km · ${isWalk ? dur(w.ms || 0) : mins(w.dist / 1000 / pace() * 60)} · ${esc(when)}</span></span>
      <button class="del" data-d="${i}" aria-label="Delete ${esc(w.name)}">Delete</button>
    </div>`;
  }).join('') : '<p class="hint">Nothing saved yet. Plan a route and tap Save, or record a walk from the Walk tab. Everything stays on this phone.</p>';

  $('#savedList').querySelectorAll('[data-o]').forEach(r => {
    const open = () => {
      const w = s[r.dataset.o];
      if (w.type === 'walk') {
        viewLayer.clearLayers();
        const pl = L.polyline(w.pts, { color: tok('--rec'), weight: 5, lineCap: 'round' }).addTo(viewLayer);
        setSheet(false); fit(pl.getBounds(), 17);
      } else {
        pts = w.pts.slice(); selectTab('plan', false); setSheet(false); route(); fit(L.latLngBounds(pts), 17);
      }
    };
    r.onclick = e => { if (!e.target.closest('.del')) open(); };
    r.onkeydown = e => { if (e.key === 'Enter') open(); };
  });
  $('#savedList').querySelectorAll('[data-d]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    if (b.classList.contains('sure')) { s.splice(+b.dataset.d, 1); store.set('ll_saved', s); renderSaved(); viewLayer.clearLayers(); }
    else { b.classList.add('sure'); b.textContent = 'Confirm'; setTimeout(() => { b.classList.remove('sure'); b.textContent = 'Delete'; }, 3000); }
  });
}
$('#save').onclick = () => {
  if (pts.length < 2) { toast('Add at least two stops before saving'); return; }
  const s = store.get('ll_saved') || [];
  const name = $('#wName').value.trim() || `Route ${s.filter(w => w.type !== 'walk').length + 1}`;
  s.unshift({ id: Date.now(), type: 'plan', name, pts: pts.slice(), dist: lastDist, date: new Date().toISOString() });
  store.set('ll_saved', s); $('#wName').value = ''; $('#wName').blur();
  toast(`Saved “${name}”`); renderSaved();
};

/* ---------- Theme changes ---------- */
darkMQ.addEventListener('change', () => {
  setBase();
  polys.forEach(([c, m]) => { c.setStyle({ color: tok('--surface') }); m.setStyle({ color: tok('--rail') }); });
  if (routeLine) routeLine.setStyle({ color: tok('--signal') });
  renderLines(); renderSaved();
});
window.addEventListener('offline', () => toast('You’re offline. Saved paths and visited map areas still work.'));

/* ---------- Start up ---------- */
const draft = store.get('ll_draft'); if (Array.isArray(draft) && draft.length) { pts = draft; route(); }
renderSaved();
selectTab(store.get('ll_tab') === 'walk' ? 'lines' : (store.get('ll_tab') || 'lines'), false);
loadLines();
})();
