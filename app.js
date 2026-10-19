/* Loopline Walks v2: map, route planner, walk log, sharing and backup for the Looplines around Worsley & Walkden */
(() => {
'use strict';

const APP_VERSION = '2.0';
const BBOX = '53.465,-2.56,53.55,-2.29'; // Monton/Eccles to Astley/Tyldesley and Little Hulton
const LINE_QUERY = `way["highway"]["name"~"loop ?line",i](${BBOX})`;
// Public mirrors of the OpenStreetMap data server; tried in turn a few seconds apart, first answer wins
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
const HOME = [53.507, -2.405];

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const root = document.documentElement;
const tok = v => getComputedStyle(root).getPropertyValue(v).trim();
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const onMQ = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

function hav(a, b) {
  const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function pathLen(p) { let m = 0; for (let i = 1; i < p.length; i++) m += hav(p[i - 1], p[i]); return m; }
// Distance in metres from point p to segment a–b
function segDist(p, a, b) {
  const kx = 111320 * Math.cos(p[0] * Math.PI / 180), ky = 110540;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
// Drop the first and last `want` metres of a path (at most 20% each end), keeping the original indexes
function trimEnds(p, want = 200) {
  const all = { pts: p.slice(), idx: p.map((_, i) => i) };
  if (p.length < 3) return all;
  const total = pathLen(p), cut = Math.min(want, total * 0.2);
  const pts = [], idx = []; let d = 0;
  for (let i = 0; i < p.length; i++) {
    if (i) d += hav(p[i - 1], p[i]);
    if (d >= cut && d <= total - cut) { pts.push(p[i]); idx.push(i); }
  }
  return pts.length >= 2 ? { pts, idx } : all;
}

const km = (m, d = 1) => (m / 1000).toFixed(d);
const mi = m => (m / 1609.344).toFixed(1);
function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
function mins(min) { min = Math.round(min); return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`; }
const toDate = v => { const d = new Date(v); return isNaN(d) ? new Date() : d; };
const fmtDay = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayYear = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtMonth = d => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
function partOfDay(d) { const h = d.getHours(); return h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'; }
const slug = s => (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loopline-walk').slice(0, 40);

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 260); }, ms);
}
const sub = t => { $('#sub').textContent = t; };

/* ---------- Day / night ---------- */
// Sunrise and sunset (the standard NOAA / SunCalc approximation, accurate to a minute or two)
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180, J1970 = 2440588, J2000 = 2451545;
  const d = date.valueOf() / 864e5 - 0.5 + J1970 - J2000;
  const lw = -lon * rad, phi = lat * rad;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const transit = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosw = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosw < -1 || cosw > 1) return null;
  const w = Math.acos(cosw);
  const set = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const rise = transit - (set - transit);
  const fromJ = j => new Date((j + 0.5 - J1970) * 864e5);
  return { rise: fromJ(rise), set: fromJ(set) };
}
const THEME_MODES = ['auto', 'sunset', 'day', 'night'];
let lastFix = store.get('ll_lastfix'); if (!Array.isArray(lastFix) || lastFix.length !== 2) lastFix = HOME;
const themeMode = () => { const m = store.get('ll_theme'); return THEME_MODES.includes(m) ? m : 'auto'; };
function computeDark() {
  const m = themeMode();
  if (m === 'day') return false;
  if (m === 'night') return true;
  if (m === 'sunset') {
    const t = sunTimes(new Date(), lastFix[0], lastFix[1]);
    if (t) { const now = Date.now(); return now < t.rise.getTime() || now > t.set.getTime(); }
  }
  return darkMQ.matches;
}
let isDark = computeDark();
root.dataset.theme = isDark ? 'dark' : 'light';
const themeHooks = [];
const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';
function updateThemeBtn() {
  const b = $('#themeBtn');
  b.innerHTML = isDark ? SUN : MOON;
  b.setAttribute('aria-label', isDark ? 'Switch to day mode' : 'Switch to night mode');
}
function applyTheme(force) {
  const d = computeDark();
  if (d === isDark && !force) return;
  isDark = d;
  root.dataset.theme = d ? 'dark' : 'light';
  store.set('ll_theme_eff', root.dataset.theme);
  const meta = $('meta[name=theme-color]'); if (meta) meta.content = d ? '#0e1411' : '#1d5c45';
  updateThemeBtn();
  themeHooks.forEach(f => { try { f(); } catch (e) {} });
}
function setThemeMode(m) { store.set('ll_theme', m); applyTheme(true); syncThemeOpts(); }
onMQ(darkMQ, () => applyTheme());
setInterval(() => applyTheme(), 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applyTheme(); });
updateThemeBtn();
$('#themeBtn').onclick = () => {
  setThemeMode(isDark ? 'day' : 'night');
  const tips = store.get('ll_tip_theme') || 0;
  toast(tips < 2 ? `${isDark ? 'Night' : 'Day'} mode. Tap the logo for automatic options.` : `${isDark ? 'Night' : 'Day'} mode`);
  store.set('ll_tip_theme', tips + 1);
};

/* ---------- Map ---------- */
const map = L.map('map', { zoomControl: false }).setView(HOME, 13);
map.attributionControl.setPrefix(false);
// All three map styles are free and need no API key
const STYLES = {
  standard: { label: 'Standard map', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', dim: true, attr: '© OpenStreetMap contributors' },
  paths: { label: 'Paths map: footpaths and cycle routes stand out', url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', sub: 'abc', dim: true, attr: '© OpenStreetMap contributors, CyclOSM' },
  satellite: { label: 'Satellite view', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', dim: false, attr: 'Imagery © Esri, Maxar, Earthstar Geographics' }
};
const ORDER = ['standard', 'paths', 'satellite'];
let mapStyle = store.get('ll_style'); if (!STYLES[mapStyle]) mapStyle = 'standard';
let base = null;
function setBase() {
  if (base) map.removeLayer(base);
  const s = STYLES[mapStyle];
  base = L.tileLayer(s.url, { maxZoom: 19, subdomains: s.sub || 'abc', attribution: s.attr, className: s.dim && isDark ? 'tiles-dim' : '' });
  base.addTo(map); base.bringToBack();
  const b = $('#styleBtn');
  b.setAttribute('aria-pressed', mapStyle !== 'standard');
  b.setAttribute('aria-label', 'Change map style (now: ' + s.label.split(':')[0] + ')');
}
$('#styleBtn').onclick = () => {
  mapStyle = ORDER[(ORDER.indexOf(mapStyle) + 1) % ORDER.length]; store.set('ll_style', mapStyle); setBase();
  toast(STYLES[mapStyle].label);
};
setBase();
themeHooks.push(setBase);

const lineLayer = L.layerGroup().addTo(map);
const amLayer = L.layerGroup();
const routeLayer = L.layerGroup().addTo(map); // the planner
const viewLayer = L.layerGroup().addTo(map);  // a saved route or journey being viewed

const sheet = $('#sheet');
function fit(bounds, maxZoom = 17) {
  if (!bounds || !bounds.isValid()) return;
  map.fitBounds(bounds, { paddingTopLeft: [24, 90], paddingBottomRight: [70, sheet.getBoundingClientRect().height + 16], maxZoom });
}

/* ---------- Lines ---------- */
let lines = {}, allPts = [], allBounds = null, polys = [], lineSegs = [], linesLoaded = false;
const lineWaiters = [];
function whenLines(timeout = 30000) {
  if (linesLoaded) return Promise.resolve(true);
  return new Promise(res => { lineWaiters.push(res); setTimeout(() => res(linesLoaded), timeout); });
}

function glyph(ways) {
  // Small silhouette of a path's actual shape, for lists
  const pts = ways.flat(); if (pts.length < 2) return '';
  const k = Math.cos(pts[0][0] * Math.PI / 180);
  const xs = pts.map(p => p[1] * k), ys = pts.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min(46 / (x1 - x0 || 1e-9), 24 / (y1 - y0 || 1e-9));
  const ox = (50 - (x1 - x0) * s) / 2, oy = (28 - (y1 - y0) * s) / 2;
  const step = Math.max(1, Math.floor(pts.length / 300));
  const d = ways.map(w => 'M' + w.filter((_, i) => i % step === 0 || i === w.length - 1)
    .map(p => ((p[1] * k - x0) * s + ox).toFixed(1) + ' ' + ((y1 - p[0]) * s + oy).toFixed(1)).join('L')).join('');
  return `<svg viewBox="0 0 50 28" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function drawLines(data) {
  lineLayer.clearLayers(); lines = {}; allPts = []; polys = []; lineSegs = [];
  for (const w of data.elements || []) {
    if (!w.geometry) continue;
    const pts = w.geometry.map(g => [g.lat, g.lon]);
    const name = (w.tags && w.tags.name) || 'Loopline';
    const len = pathLen(pts);
    const casing = L.polyline(pts, { color: tok('--surface'), weight: 10, opacity: .95, interactive: false }).addTo(lineLayer);
    const main = L.polyline(pts, { color: tok('--rail'), weight: 5.5 }).addTo(lineLayer)
      .bindPopup(`<b>${esc(name)}</b><br><small>Open Plan to build a walk along it</small>`);
    polys.push([casing, main]);
    const l = lines[name] || (lines[name] = { len: 0, ways: [] });
    l.len += len; l.ways.push(pts); allPts.push(...pts);
    for (let i = 1; i < pts.length; i++) lineSegs.push({ name, a: pts[i - 1], b: pts[i] });
  }
  if (allPts.length) {
    allBounds = L.latLngBounds(allPts);
    linesLoaded = true; lineWaiters.splice(0).forEach(f => f(true));
  }
  renderLines();
}
themeHooks.push(() => polys.forEach(([c, m]) => { c.setStyle({ color: tok('--surface') }); m.setStyle({ color: tok('--rail') }); }));

// Which Looplines a path uses, and how far along each (metres)
function linesUsed(path) {
  if (!lineSegs.length || !path || path.length < 2) return [];
  const tally = {}, LAT = 0.0004, LON = 0.0006; // ~45 m search box
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best = Infinity, name = null;
    for (const s of lineSegs) {
      if (Math.min(s.a[0], s.b[0]) - mid[0] > LAT || mid[0] - Math.max(s.a[0], s.b[0]) > LAT) continue;
      if (Math.min(s.a[1], s.b[1]) - mid[1] > LON || mid[1] - Math.max(s.a[1], s.b[1]) > LON) continue;
      const d = segDist(mid, s.a, s.b);
      if (d < best) { best = d; name = s.name; }
    }
    if (best <= 30) tally[name] = (tally[name] || 0) + hav(a, b);
  }
  return Object.entries(tally).filter(([, m]) => m >= 50).sort((x, y) => y[1] - x[1]).map(([name, m]) => ({ name, m: Math.round(m) }));
}
const shortLine = n => n.replace(/\s*loop ?line$/i, '');

function renderLines() {
  const names = Object.keys(lines).sort((a, b) => lines[b].len - lines[a].len);
  const total = names.reduce((s, n) => s + lines[n].len, 0);
  $('#netKm').textContent = total ? km(total) : '–';
  if (total && !rec) sub(`${km(total)} km of paths · ${mi(total)} mi`);
  if (!names.length) return;
  $('#lineList').innerHTML = names.map(n => `
    <button class="row" type="button" data-n="${esc(n)}">
      <span class="glyph">${glyph(lines[n].ways)}</span>
      <span class="txt"><span class="name">${esc(n)}</span><span class="meta">${km(lines[n].len, 2)} km · ${mi(lines[n].len)} mi</span></span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`).join('');
  $$('#lineList [data-n]').forEach(b => b.onclick = () => { setSheet(false); fit(L.latLngBounds(lines[b.dataset.n].ways.flat()), 16); });
}
function lineMsg(text, retry) {
  $('#lineList').innerHTML = `<div class="empty"><p class="hint">${esc(text)}</p>${retry ? '<button class="chip" type="button" id="retryLines">Try again</button>' : ''}</div>`;
  if (retry) $('#retryLines').onclick = () => { lineMsg('Trying again…'); loadLines(true); };
}

async function overpass(q, ms = 35000) {
  const body = 'data=' + encodeURIComponent(q);
  const ctrls = OVERPASS.map(() => new AbortController());
  let done = false;
  const attempt = async (u, i) => {
    await sleep(i * 5000);
    if (done) throw new Error('skipped');
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: ctrls[i].signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.elements)) throw new Error('bad reply');
    return j;
  };
  const timer = setTimeout(() => ctrls.forEach(c => c.abort()), ms);
  try { return await Promise.any(OVERPASS.map(attempt)); }
  finally { done = true; clearTimeout(timer); ctrls.forEach(c => c.abort()); }
}

let loadingLines = false;
async function loadLines(force) {
  if (loadingLines) return; loadingLines = true;
  try {
    const cached = store.get('ll_lines');
    if (cached && cached.data && !linesLoaded) { drawLines(cached.data); fit(allBounds, 15); }
    if (!force && linesLoaded && cached && Date.now() - cached.t < 7 * 864e5) return;
    if (!linesLoaded) { sub('Loading paths…'); lineMsg('Fetching the Loopline paths from OpenStreetMap. The first load can take up to half a minute.'); }
    const d = await overpass(`[out:json][timeout:25];${LINE_QUERY};out geom;`);
    if (!d.elements.length) throw new Error('empty');
    store.set('ll_lines', { t: Date.now(), data: d });
    const first = !linesLoaded; drawLines(d); if (first) fit(allBounds, 15);
  } catch (e) {
    if (!linesLoaded) {
      sub('Paths not loaded'); lineMsg('Couldn’t reach the map data servers. Check your signal and try again.', true);
      lineWaiters.splice(0).forEach(f => f(false));
    }
  } finally { loadingLines = false; }
}
$('#fitBtn').onclick = () => { follow(false); fit(allBounds, 15); };
window.addEventListener('online', () => { if (!linesLoaded) loadLines(true); });

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
      const t = e.tags && e.tags.amenity; if (!lab[t]) return; n++;
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
    if (hav(lastFix, me) > 5000) { lastFix = me.slice(); store.set('ll_lastfix', lastFix); applyTheme(); }
    onFix(me, acc);
    waiters.splice(0).forEach(f => f(me));
  }, err => {
    toast(err.code === 1 ? 'Location is blocked. Allow it in Settings › Privacy › Location Services.' : 'No GPS fix yet. Try again in the open.', 4200);
    waiters.splice(0).forEach(f => f(null)); watchId = null; follow(false);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
}
themeHooks.push(() => { if (meAcc) meAcc.setStyle({ color: tok('--me') }); });
function whereAmI() {
  return new Promise(res => { if (me) return res(me); waiters.push(res); startWatch(); toast('Finding you…'); });
}
$('#locBtn').onclick = () => {
  if (following) { follow(false); return; }
  follow(true);
  if (me) map.setView(me, Math.max(map.getZoom(), 16)); else { startWatch(); toast('Finding you…'); }
};

/* ---------- Saved routes and journeys ---------- */
// Both live in one list ('ll_saved'), the same store v1 used: type 'plan' = route, type 'walk' = journey
const lib = {
  all() { const a = store.get('ll_saved'); return Array.isArray(a) ? a.filter(w => w && Array.isArray(w.pts)) : []; },
  set(a) { if (!store.set('ll_saved', a)) toast('Couldn’t save: this phone’s storage is full'); },
  get(id) { return lib.all().find(w => w.id === id); },
  put(item) { const a = lib.all(); const i = a.findIndex(w => w.id === item.id); if (i >= 0) a[i] = item; else a.unshift(item); lib.set(a); },
  remove(id) { lib.set(lib.all().filter(w => w.id !== id)); }
};
(function migrate() {
  const a = lib.all(); let changed = false; const seen = new Set();
  a.forEach((w, i) => {
    if (typeof w.id !== 'number' || seen.has(w.id)) { w.id = Date.now() + i; changed = true; }
    seen.add(w.id);
    if (w.type !== 'walk' && w.type !== 'plan') { w.type = 'plan'; changed = true; }
    // The first single-file version saved dates like "19 Oct" with no year; rebuild them from the id (a save timestamp)
    if (typeof w.date !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(w.date)) { w.date = new Date(w.id > 1e12 && w.id < 4e12 ? w.id : Date.now()).toISOString(); changed = true; }
  });
  if (changed) lib.set(a);
})();
const itemPath = w => (w.type === 'walk' ? w.pts : (w.geom && w.geom.length > 1 ? w.geom : w.pts));
function ensureLines(w) {
  if (!linesLoaded || (Array.isArray(w.lines) && w.linesV === 2)) return w;
  w.lines = linesUsed(itemPath(w)); w.linesV = 2; lib.put(w); return w;
}

/* ---------- Bottom sheet & tabs ---------- */
const TABS = ['lines', 'plan', 'walk', 'routes', 'journeys'];
let tab = 'lines', detailId = null;
function setSheet(open) { sheet.classList.toggle('open', open); }
const grab = $('#grab'); let y0 = null;
grab.addEventListener('pointerdown', e => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
grab.addEventListener('pointerup', e => {
  if (y0 === null) return; const dy = e.clientY - y0; y0 = null;
  setSheet(Math.abs(dy) < 8 ? !sheet.classList.contains('open') : dy < 0);
});
grab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(!sheet.classList.contains('open')); } });

function showPane(p) { [...TABS, 'detail'].forEach(x => { $('#p-' + x).hidden = x !== p; }); $('#body').scrollTop = 0; }
function selectTab(t, open = true, quiet = false) {
  tab = t; detailId = null;
  $$('.seg button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
  showPane(t);
  viewLayer.clearLayers();
  if (t === 'plan') routeLayer.addTo(map); else map.removeLayer(routeLayer);
  if (t === 'routes' || t === 'journeys') renderList(t);
  if (t === 'plan' && !pts.length && !quiet) toast('Tap the map to drop your first stop');
  if (open) setSheet(true);
  store.set('ll_tab', t);
}
$$('.seg button').forEach(b => b.onclick = () => selectTab(b.dataset.t));

/* ---------- Route planner ---------- */
let pts = [], mks = [], routeLine = null, routeGeom = [], routed = false, ctrl = null, lastDist = 0;
const pace = () => +(document.querySelector('input[name=pace]:checked') || { value: 5 }).value;
const savedPace = store.get('ll_pace'); if (savedPace) $$('input[name=pace]').forEach(i => { i.checked = +i.value === savedPace; });
$$('input[name=pace]').forEach(i => i.onchange = () => { store.set('ll_pace', pace()); setStats(lastDist); });

function renderMarkers() {
  mks.forEach(m => routeLayer.removeLayer(m)); mks = [];
  pts.forEach((p, i) => {
    if (i === pts.length - 1 && i > 0 && hav(p, pts[0]) < 5) return; // a loop's end sits on the start
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
async function fetchRoute(p, signal) {
  const coords = p.map(q => q[1].toFixed(6) + ',' + q[0].toFixed(6)).join(';');
  const r = await fetch(ROUTER + coords + '?overview=full&geometries=geojson', { signal });
  const d = await r.json();
  if (!d.routes || !d.routes.length) throw new Error('no route');
  return { geom: d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]), dist: d.routes[0].distance };
}
async function route() {
  renderMarkers();
  if (routeLine) { routeLayer.removeLayer(routeLine); routeLine = null; }
  store.set('ll_draft', pts);
  routeGeom = []; routed = false;
  if (pts.length < 2) {
    setStats(0);
    $('#planHint').textContent = pts.length ? 'Now tap where you want to walk to.' : 'Tap the map to drop stops. The route follows real footpaths, and you can drag any stop.';
    return;
  }
  if (ctrl) ctrl.abort(); ctrl = new AbortController();
  $('#planHint').textContent = 'Working out the walking route…';
  try {
    const r = await fetchRoute(pts, ctrl.signal);
    routeGeom = r.geom; routed = true;
    routeLine = L.polyline(routeGeom, { color: tok('--signal'), weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    setStats(r.dist);
    const used = linesUsed(routeGeom);
    $('#planHint').textContent = used.length ? `Uses ${used.map(u => shortLine(u.name)).join(', ')}. Drag a stop to reshape it.` : 'Drag a stop to reshape the route, or add more by tapping the map.';
  } catch (e) {
    if (e.name === 'AbortError') return;
    routeGeom = pts.slice();
    routeLine = L.polyline(pts, { color: tok('--signal'), weight: 4, dashArray: '2 10', lineCap: 'round' }).addTo(routeLayer);
    setStats(pathLen(pts));
    $('#planHint').textContent = 'No signal for routing, so this is the straight-line distance between stops.';
  }
}
themeHooks.push(() => { if (routeLine) routeLine.setStyle({ color: tok('--signal') }); });
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
  if (!linesLoaded) {
    toast('Loading the Loopline paths first…', 4000);
    if (!loadingLines) loadLines(true);
    if (!(await whenLines())) { toast('The Loopline paths haven’t loaded. Check your signal and try again.'); return; }
  }
  const p = await whereAmI(); if (!p) return;
  let best = null, bd = Infinity;
  for (const q of allPts) { const d = hav(p, q); if (d < bd) { bd = d; best = q; } }
  pts = [p, best]; selectTab('plan', false, true); setSheet(false); await route();
  fit(L.latLngBounds([p, best]), 17);
};

$('#save').onclick = () => {
  if (pts.length < 2) { toast('Add at least two stops before saving'); return; }
  const n = lib.all().filter(w => w.type === 'plan').length + 1;
  const name = $('#wName').value.trim() || `Route ${n}`;
  const geom = routeGeom.length > 1 ? routeGeom : pts;
  const item = { id: Date.now(), type: 'plan', name, pts: pts.slice(), geom: routed ? geom : null, dist: Math.round(lastDist), date: new Date().toISOString(), lines: linesUsed(geom), linesV: linesLoaded ? 2 : 0 };
  lib.put(item);
  $('#wName').value = ''; $('#wName').blur();
  toast(`Saved “${name}” to Routes`);
};

/* ---------- Walk recorder ---------- */
let rec = null, recTimer = null, wake = null;
async function wakeOn() { try { wake = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) {} }
function wakeOff() { try { if (wake) wake.release(); } catch (e) {} wake = null; }
document.addEventListener('visibilitychange', () => { if (rec && !rec.paused && document.visibilityState === 'visible') wakeOn(); });
const recElapsed = () => (rec ? rec.elapsed + (rec.paused ? 0 : Date.now() - rec.runStart) : 0);

function onFix(p, acc) {
  if (!rec || rec.paused || acc > 35) return;
  const last = rec.pts[rec.pts.length - 1];
  if (last && hav(last, p) < 6) return;
  if (last) rec.dist += hav(last, p);
  rec.pts.push(p); rec.ts.push(Date.now() - rec.startedAt); rec.line.addLatLng(p);
  renderRec();
}
function renderRec() {
  const t = recElapsed();
  $('#rKm').textContent = km(rec ? rec.dist : 0, 2);
  $('#rTime').textContent = dur(t);
  $('#rPace').textContent = rec && rec.dist > 50 ? dur(t / (rec.dist / 1000)) : '–';
}
$('#recStart').onclick = () => {
  rec = { pts: [], ts: [], dist: 0, elapsed: 0, runStart: Date.now(), startedAt: Date.now(), paused: false,
          line: L.polyline([], { color: tok('--rec'), weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(map) };
  follow(true); startWatch(); if (me) map.setView(me, 17);
  $('#recIdle').hidden = true; $('#recLive').hidden = false; $('#recPause').textContent = 'Pause';
  $('#recHint').textContent = 'Recording. Keep the app open on screen for the best GPS track.';
  sub('● Recording'); wakeOn();
  recTimer = setInterval(renderRec, 1000); renderRec();
};
themeHooks.push(() => { if (rec) rec.line.setStyle({ color: tok('--rec') }); });
$('#recPause').onclick = () => {
  if (!rec) return;
  if (rec.paused) { rec.runStart = Date.now(); rec.paused = false; $('#recPause').textContent = 'Pause'; sub('● Recording'); wakeOn(); }
  else { rec.elapsed += Date.now() - rec.runStart; rec.paused = true; $('#recPause').textContent = 'Resume'; sub('Paused'); wakeOff(); }
  renderRec();
};
$('#recStop').onclick = () => {
  if (!rec) return;
  const t = recElapsed(); clearInterval(recTimer); wakeOff();
  const done = rec; map.removeLayer(done.line); rec = null;
  $('#recIdle').hidden = false; $('#recLive').hidden = true;
  $('#recHint').textContent = 'Log a walk as you go. Keep the app open on screen: iPhones pause GPS for web apps when the screen locks.';
  renderRec(); renderLines();
  if (done.pts.length < 2 || done.dist < 30) { toast('Too short to save'); return; }
  const start = new Date(done.startedAt);
  const item = { id: Date.now(), type: 'walk', name: `${partOfDay(start)} walk`, pts: done.pts, ts: done.ts, dist: Math.round(done.dist), ms: t,
                 date: start.toISOString(), lines: linesUsed(done.pts), linesV: linesLoaded ? 2 : 0 };
  lib.put(item);
  toast(`Saved: ${km(done.dist, 2)} km in ${dur(t)}`);
  selectTab('journeys'); openDetail(item.id);
};

/* ---------- Lists ---------- */
function renderList(kind) {
  const isWalk = kind === 'journeys';
  const items = lib.all().filter(w => (isWalk ? w.type === 'walk' : w.type !== 'walk'))
    .sort((a, b) => toDate(b.date) - toDate(a.date));
  const el = $(isWalk ? '#journeyList' : '#routeList');
  if (!items.length) {
    el.innerHTML = isWalk
      ? '<div class="empty"><p class="hint">No journeys yet. Open the Walk tab and tap Start recording next time you’re out.</p><button class="chip" type="button" data-go="walk">Go to Walk</button></div>'
      : '<div class="empty"><p class="hint">No routes yet. Plan one on the map and tap Save route to keep it here.</p><button class="chip" type="button" data-go="plan">Plan a route</button></div>';
    el.querySelector('[data-go]').onclick = e => selectTab(e.target.dataset.go);
    return;
  }
  let html = '';
  if (isWalk) {
    const now = new Date();
    const month = items.filter(w => { const d = toDate(w.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    const mDist = month.reduce((s, w) => s + (w.dist || 0), 0), all = items.reduce((s, w) => s + (w.dist || 0), 0);
    html += `<div class="summary"><div><b>${km(mDist)}</b><span>km this month</span></div><div><b>${month.length}</b><span>${month.length === 1 ? 'walk' : 'walks'}</span></div><div><b>${km(all)}</b><span>km all time</span></div></div>`;
  }
  let lastMonth = '';
  for (const w of items) {
    const d = toDate(w.date);
    if (isWalk) { const m = fmtMonth(d); if (m !== lastMonth) { html += `<div class="month">${m}</div>`; lastMonth = m; } }
    const meta = isWalk
      ? `${km(w.dist || 0, 2)} km · ${dur(w.ms || 0)} · ${fmtDay(d)}, ${fmtTime(d)}`
      : `${km(w.dist || 0, 1)} km · ${mins((w.dist || 0) / 1000 / pace() * 60)}${w.lines && w.lines.length ? ' · ' + w.lines.map(l => shortLine(l.name)).join(', ') : ''}`;
    html += `<button class="row" type="button" data-id="${w.id}">
      <span class="glyph ${isWalk ? 'walk' : 'route'}">${glyph([itemPath(w)])}</span>
      <span class="txt"><span class="name">${esc(w.name)}</span><span class="meta">${esc(meta)}</span></span>
      <span class="chev" aria-hidden="true">›</span></button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => openDetail(+b.dataset.id));
}

/* ---------- Detail ---------- */
function openDetail(id) {
  const w = lib.get(id); if (!w) return;
  detailId = id; showPane('detail'); setSheet(true);
  renderDetail(ensureLines(w)); showOnMap(w, true);
}
function renderDetail(w) {
  const isWalk = w.type === 'walk', d = toDate(w.date);
  const stats = isWalk
    ? `<div><span class="big num">${km(w.dist, 2)}</span><span class="unit">km</span></div>
       <div><span class="mid num">${dur(w.ms || 0)}</span><span class="unit">time</span></div>
       <div><span class="mid num">${w.dist > 50 ? dur((w.ms || 0) / (w.dist / 1000)) : '–'}</span><span class="unit">min / km</span></div>`
    : `<div><span class="big num">${km(w.dist, 1)}</span><span class="unit">km</span></div>
       <div><span class="mid num">${mi(w.dist)}</span><span class="unit">miles</span></div>
       <div><span class="mid num">${mins(w.dist / 1000 / pace() * 60)}</span><span class="unit">walking</span></div>`;
  const used = Array.isArray(w.lines) ? w.lines : [];
  const lu = used.length
    ? `<h3 class="label">Looplines ${isWalk ? 'walked' : 'on this route'}</h3><div class="lu">${used.map(u => {
        const full = lines[u.name] ? lines[u.name].len : 0, pct = full ? Math.min(100, u.m / full * 100) : 0;
        return `<div class="lu-row"><span class="n">${esc(u.name)}</span><span class="v">${km(u.m, 1)}${full ? ' of ' + km(full, 1) : ''} km</span><span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span></div>`;
      }).join('')}</div>`
    : (linesLoaded ? `<p class="hint">This ${isWalk ? 'walk' : 'route'} doesn’t follow any of the Looplines.</p>` : '');
  $('#detail').innerHTML = `
    <div class="pane" style="padding-top:0">
      <div class="dhead"><button class="back" type="button" id="dBack">‹ ${isWalk ? 'Journeys' : 'Routes'}</button></div>
      <div><h2 class="dtitle">${esc(w.name)}</h2><p class="dmeta">${isWalk ? `${fmtDayYear(d)} · started ${fmtTime(d)}` : `Saved ${fmtDayYear(d)}`}</p></div>
      <div class="stats">${stats}</div>
      ${lu}
      <div class="chips">
        <button class="btn share" type="button" id="dShare"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Share</button>
        ${isWalk ? '' : '<button class="btn alt" type="button" id="dEdit">Edit in planner</button>'}
      </div>
      <div class="chips">
        <button class="chip" type="button" id="dRename">Rename</button>
        <button class="chip danger" type="button" id="dDelete">Delete</button>
      </div>
    </div>`;
  $('#dBack').onclick = () => selectTab(isWalk ? 'journeys' : 'routes');
  $('#dShare').onclick = () => openShare(w.id);
  $('#dRename').onclick = async () => {
    const name = await dialog({ title: 'Rename', input: w.name, ok: 'Save' });
    if (name && name.trim()) { const cur = lib.get(w.id); cur.name = name.trim().slice(0, 60); lib.put(cur); renderDetail(cur); }
  };
  $('#dDelete').onclick = async () => {
    const ok = await dialog({ title: `Delete “${w.name}”?`, text: 'This can’t be undone unless you have a backup.', ok: 'Delete', danger: true });
    if (ok) { lib.remove(w.id); toast('Deleted'); selectTab(isWalk ? 'journeys' : 'routes'); }
  };
  const edit = $('#dEdit');
  if (edit) edit.onclick = () => { pts = w.pts.slice(); selectTab('plan', false, true); setSheet(false); route(); fit(L.latLngBounds(pts), 17); };
}
let viewFetch = null;
function showOnMap(w, doFit) {
  viewLayer.clearLayers();
  const isWalk = w.type === 'walk', path = itemPath(w);
  const color = tok(isWalk ? '--rec' : '--signal');
  const dashed = !isWalk && !(w.geom && w.geom.length > 1);
  const pl = L.polyline(path, { color, weight: 5.5, opacity: .95, lineCap: 'round', lineJoin: 'round', dashArray: dashed ? '2 10' : null }).addTo(viewLayer);
  const dot = c => L.divIcon({ className: '', html: `<div class="end-dot ${c}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  L.marker(path[0], { icon: dot('s'), interactive: false }).addTo(viewLayer);
  if (hav(path[0], path[path.length - 1]) > 20) L.marker(path[path.length - 1], { icon: dot('f'), interactive: false }).addTo(viewLayer);
  if (doFit) setTimeout(() => fit(pl.getBounds(), 17), 340); // after the panel has opened, so the route sits above it
  // Routes saved without a footpath route (v1, or saved offline): fetch it now and keep it
  if (dashed && w.pts.length > 1) {
    if (viewFetch) viewFetch.abort(); viewFetch = new AbortController();
    fetchRoute(w.pts, viewFetch.signal).then(r => {
      const cur = lib.get(w.id); if (!cur) return;
      cur.geom = r.geom; cur.dist = Math.round(r.dist); cur.linesV = 0; lib.put(cur);
      if (detailId === w.id) { const u = ensureLines(cur); showOnMap(u, false); renderDetail(u); }
    }).catch(() => {});
  }
}
themeHooks.push(() => { if (detailId) { const w = lib.get(detailId); if (w) showOnMap(w, false); } });

/* ---------- Modals ---------- */
let lastFocus = null;
function openModal(id) {
  const m = $('#' + id); lastFocus = document.activeElement; m.hidden = false;
  requestAnimationFrame(() => m.classList.add('show'));
}
function closeModal(id) {
  const m = $('#' + id); if (m.hidden) return;
  m.classList.remove('show'); setTimeout(() => { m.hidden = true; }, 220);
  if (m.onclose) m.onclose();
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(m.id); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const open = $$('.modal').filter(m => !m.hidden).pop(); if (open) closeModal(open.id); } });

// A small confirm / rename dialog built into the page
function dialog({ title, text = '', input = null, ok = 'OK', danger = false }) {
  return new Promise(res => {
    const m = $('#m-dialog'), inp = $('#dlg-input'), okBtn = $('#dlg-ok');
    $('#dlg-title').textContent = title; $('#dlg-text').textContent = text; $('#dlg-text').hidden = !text;
    inp.hidden = input === null; inp.value = input || '';
    okBtn.textContent = ok; okBtn.className = danger ? 'btn share' : 'btn';
    let settled = false;
    const finish = v => { if (settled) return; settled = true; m.onclose = null; closeModal('m-dialog'); res(v); };
    m.onclose = () => { if (!settled) { settled = true; res(input === null ? false : null); } };
    okBtn.onclick = () => finish(input === null ? true : inp.value);
    $('#dlg-cancel').onclick = () => finish(input === null ? false : null);
    inp.onkeydown = e => { if (e.key === 'Enter') finish(inp.value); };
    openModal('m-dialog');
    setTimeout(() => (input === null ? okBtn : inp).focus(), 60);
  });
}

/* ---------- Settings ---------- */
function syncThemeOpts() {
  const m = themeMode();
  $$('input[name=theme]').forEach(i => { i.checked = i.value === m; });
  const t = sunTimes(new Date(), lastFix[0], lastFix[1]);
  $('#sunTimes').textContent = t ? `Today: day map from ${fmtTime(t.rise)}, night map from ${fmtTime(t.set)}` : 'Day map in daylight, night map after dark';
}
$$('input[name=theme]').forEach(i => i.onchange = () => setThemeMode(i.value));
$('#brand').onclick = () => {
  syncThemeOpts();
  const a = lib.all(), r = a.filter(w => w.type !== 'walk').length, j = a.length - r;
  $('#backupInfo').textContent = `${r} ${r === 1 ? 'route' : 'routes'} and ${j} ${j === 1 ? 'journey' : 'journeys'} are stored on this phone only. Export a backup to keep them safe in Files or iCloud Drive.`;
  $('#ver').textContent = 'v' + APP_VERSION;
  openModal('m-settings');
};

/* ---------- Files: share sheet or download ---------- */
function shareFile(file, title) {
  if (!file) return;
  const data = { files: [file], title };
  if (navigator.canShare && navigator.canShare(data)) {
    navigator.share(data).catch(e => { if (e.name !== 'AbortError') downloadFile(file); });
  } else downloadFile(file);
}
function downloadFile(file) {
  const u = URL.createObjectURL(file), a = document.createElement('a');
  a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
  toast(`Saved ${file.name}`);
}

$('#exportBtn').onclick = () => {
  const data = { app: 'loopline-walks', version: 2, exported: new Date().toISOString(), saved: lib.all(),
                 settings: { theme: themeMode(), style: mapStyle, pace: pace() } };
  const name = `loopline-walks-backup-${new Date().toISOString().slice(0, 10)}.json`;
  shareFile(new File([JSON.stringify(data)], name, { type: 'application/json' }), 'Loopline Walks backup');
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const incoming = (Array.isArray(data) ? data : data.saved || []).filter(w =>
      w && Array.isArray(w.pts) && w.pts.length > 1 && w.pts.every(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])));
    if (!incoming.length) { toast('That file has no routes or journeys in it'); return; }
    const have = lib.all(), ids = new Set(have.map(w => w.id));
    const added = incoming.filter(w => !ids.has(w.id)).map((w, i) => ({
      id: typeof w.id === 'number' ? w.id : Date.now() + i, type: w.type === 'walk' ? 'walk' : 'plan',
      name: String(w.name || 'Imported walk').slice(0, 60), pts: w.pts, geom: Array.isArray(w.geom) ? w.geom : null,
      ts: Array.isArray(w.ts) ? w.ts : undefined, dist: +w.dist || Math.round(pathLen(w.pts)), ms: +w.ms || 0,
      date: w.date || new Date().toISOString()
    }));
    lib.set(added.concat(have));
    toast(added.length ? `Restored ${added.length} ${added.length === 1 ? 'item' : 'items'}` : 'Everything in that backup is already here');
    closeModal('m-settings');
    if (tab === 'routes' || tab === 'journeys') renderList(tab);
  } catch (err) { toast('That file isn’t a Loopline Walks backup'); }
};

/* ---------- Share card ---------- */
let shareState = null;
function openShare(id) {
  const w = lib.get(id); if (!w) return;
  shareState = { w: ensureLines(w), story: false, gen: 0, img: null, gpx: null, url: null };
  $$('input[name=shape]').forEach(i => { i.checked = i.value === 'post'; });
  $('#optHide').checked = store.get('ll_share_hide') !== false;
  $('#optNet').checked = store.get('ll_share_net') !== false;
  openModal('m-share');
  prepareShare();
}
$('#m-share').onclose = () => { if (shareState && shareState.url) URL.revokeObjectURL(shareState.url); shareState = null; };
$$('input[name=shape]').forEach(i => i.onchange = prepareShare);
$('#optHide').onchange = () => { store.set('ll_share_hide', $('#optHide').checked); prepareShare(); };
$('#optNet').onchange = () => { store.set('ll_share_net', $('#optNet').checked); prepareShare(); };
// Files are drawn ahead of time, so tapping Share opens the share sheet straight away (iOS needs that)
$('#shareImg').onclick = () => shareState && shareFile(shareState.img, shareState.w.name);
$('#shareGpx').onclick = () => shareState && shareFile(shareState.gpx, shareState.w.name);

async function prepareShare() {
  const s = shareState; if (!s) return;
  const gen = ++s.gen;
  $('#shareImg').disabled = true; $('#shareGpx').disabled = true;
  const opts = { story: (document.querySelector('input[name=shape]:checked') || {}).value === 'story', hide: $('#optHide').checked, net: $('#optNet').checked };
  const path = itemPath(s.w);
  const shown = opts.hide ? trimEnds(path) : { pts: path.slice(), idx: path.map((_, i) => i) };
  try {
    const canvas = await drawCard(s.w, shown.pts, opts);
    if (gen !== s.gen || shareState !== s) return;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (gen !== s.gen || shareState !== s || !blob) return;
    s.img = new File([blob], `${slug(s.w.name)}.png`, { type: 'image/png' });
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = URL.createObjectURL(blob);
    $('#sharePreview').innerHTML = `<img alt="Share card for ${esc(s.w.name)}" src="${s.url}">`;
    s.gpx = new File([buildGpx(s.w, shown)], `${slug(s.w.name)}.gpx`, { type: 'application/gpx+xml' });
    $('#shareImg').disabled = false; $('#shareGpx').disabled = false;
  } catch (e) {
    $('#sharePreview').innerHTML = '<span class="hint">Couldn’t draw the card on this device.</span>';
  }
}

function buildGpx(w, shown) {
  const start = toDate(w.date).getTime();
  const hasTime = w.type === 'walk' && Array.isArray(w.ts) && w.ts.length === w.pts.length;
  const pts = shown.pts.map((p, k) => {
    const i = shown.idx[k];
    const t = hasTime ? `<time>${new Date(start + w.ts[i]).toISOString()}</time>` : '';
    return `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${t}</trkpt>`;
  }).join('\n      ');
  const name = esc(w.name).replace(/'/g, '&apos;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Loopline Walks" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name><time>${toDate(w.date).toISOString()}</time></metadata>
  <trk><name>${name}</name><type>${w.type === 'walk' ? 'walking' : 'route'}</type>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

const MARK = new Path2D('M4 17c0-6 5-10 9-10 3.3 0 6 2.2 6 5s-2.2 4.5-4.5 4.5S10 15 10 13');
async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.race([
      Promise.all(['900 30px Overpass', '800 70px Overpass', '600 32px Overpass', '700 26px Overpass', '700 90px "Overpass Mono"', '500 30px "Overpass Mono"'].map(f => document.fonts.load(f))),
      sleep(2500)
    ]);
  } catch (e) {}
}
function spaced(g, text, x, y, gap) { for (const ch of text) { g.fillText(ch, x, y); x += g.measureText(ch).width + gap; } return x; }
function wrap(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/), out = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  if (out.length > maxLines) { out.length = maxLines; let l = out[maxLines - 1]; while (l && g.measureText(l + '…').width > maxW) l = l.slice(0, -1); out[maxLines - 1] = l + '…'; }
  return out;
}
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

async function drawCard(w, path, o) {
  await fontsReady();
  const W = 1080, H = o.story ? 1920 : 1350, P = 72, isWalk = w.type === 'walk';
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const SANS = 'Overpass, system-ui, sans-serif', MONO = '"Overpass Mono", ui-monospace, monospace';
  const ACC = '#ff8a5c', RAIL = '#5cd39a';

  // Background: deep railway green with a soft light from the top
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#163f30'); bg.addColorStop(1, '#0a1d15');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.75, 0, 0, W * 0.75, 0, W); glow.addColorStop(0, 'rgba(92,211,154,.16)'); glow.addColorStop(1, 'rgba(92,211,154,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  // Header: mark + app name (stories keep clear of Instagram's top and bottom bars)
  let y = P + (o.story ? 150 : 0);
  g.fillStyle = RAIL; rrect(g, P, y, 64, 64, 18); g.fill();
  g.save(); g.translate(P + 8, y + 8); g.scale(2, 2);
  g.strokeStyle = '#0a1d15'; g.lineWidth = 2.6; g.lineCap = 'round'; g.stroke(MARK);
  g.fillStyle = '#0a1d15'; g.beginPath(); g.arc(4, 17, 2.2, 0, Math.PI * 2); g.fill(); g.restore();
  g.fillStyle = 'rgba(255,255,255,.72)'; g.font = `900 28px ${SANS}`; g.textBaseline = 'middle';
  spaced(g, 'LOOPLINE WALKS', P + 88, y + 34, 4);
  g.textBaseline = 'alphabetic';

  // Title and date
  y += 140;
  g.fillStyle = '#fff'; g.font = `800 70px ${SANS}`;
  const titleLines = wrap(g, w.name, W - P * 2, 2);
  titleLines.forEach(l => { g.fillText(l, P, y); y += 80; });
  const d = toDate(w.date);
  g.fillStyle = 'rgba(255,255,255,.66)'; g.font = `600 32px ${SANS}`;
  g.fillText(isWalk ? `${fmtDayYear(d)} · ${fmtTime(d)}` : 'Planned route · Worsley & Walkden', P, y - 18);

  // Map panel
  const statsH = o.story ? 640 : 330;
  const box = { x: P, y: y + 22, w: W - P * 2, h: H - statsH - (y + 22) };
  g.fillStyle = 'rgba(255,255,255,.045)'; rrect(g, box.x, box.y, box.w, box.h, 28); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 2; g.stroke();

  // Fit the path into the panel (equirectangular, fine at this scale)
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  path.forEach(p => { la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); lo0 = Math.min(lo0, p[1]); lo1 = Math.max(lo1, p[1]); });
  const k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
  const minSpan = 0.004; // never zoom closer than ~450 m across
  if (la1 - la0 < minSpan) { const m = (la0 + la1) / 2; la0 = m - minSpan / 2; la1 = m + minSpan / 2; }
  if ((lo1 - lo0) * k < minSpan) { const m = (lo0 + lo1) / 2; lo0 = m - minSpan / k / 2; lo1 = m + minSpan / k / 2; }
  const pad = 70, sc = Math.min((box.w - pad * 2) / ((lo1 - lo0) * k), (box.h - pad * 2) / (la1 - la0));
  const ox = box.x + (box.w - (lo1 - lo0) * k * sc) / 2, oy = box.y + (box.h - (la1 - la0) * sc) / 2;
  const X = p => ox + (p[1] - lo0) * k * sc, Y = p => oy + (la1 - p[0]) * sc;
  const stroke = (pp) => { g.beginPath(); pp.forEach((p, i) => (i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p)))); g.stroke(); };

  g.save(); rrect(g, box.x, box.y, box.w, box.h, 28); g.clip();
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (o.net) {
    g.strokeStyle = 'rgba(92,211,154,.26)'; g.lineWidth = 10;
    Object.values(lines).forEach(l => l.ways.forEach(stroke));
  }
  g.shadowColor = 'rgba(255,138,92,.6)'; g.shadowBlur = 28;
  g.strokeStyle = ACC; g.lineWidth = 15; stroke(path);
  g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; stroke(path);
  const s = path[0], f = path[path.length - 1];
  g.fillStyle = '#fff'; g.beginPath(); g.arc(X(s), Y(s), 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0a1d15'; g.beginPath(); g.arc(X(s), Y(s), 7, 0, Math.PI * 2); g.fill();
  if (hav(s, f) > 20) { g.fillStyle = ACC; g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(X(f), Y(f), 15, 0, Math.PI * 2); g.fill(); g.stroke(); }
  g.restore();

  // Stats
  const sy = box.y + box.h + (o.story ? 130 : 112);
  const cols = isWalk
    ? [[km(w.dist, 2), 'KM'], [dur(w.ms || 0), 'TIME'], [w.dist > 50 ? dur((w.ms || 0) / (w.dist / 1000)) : '–', 'MIN / KM']]
    : [[km(w.dist, 1), 'KM'], [mi(w.dist), 'MILES'], [mins(w.dist / 1000 / 5 * 60), 'WALKING']];
  const cw = (W - P * 2) / 3;
  cols.forEach(([v, l], i) => {
    const x = P + i * cw;
    g.fillStyle = '#fff'; g.font = `700 ${i ? 66 : 90}px ${MONO}`; g.fillText(v, x, sy);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `700 26px ${SANS}`; spaced(g, l, x + 2, sy + 46, 3);
  });

  // Footer: which Looplines
  const used = (w.lines || []).map(u => shortLine(u.name));
  const foot = used.length ? `${used.join(' · ')} Loopline${used.length > 1 ? 's' : ''}` : 'Worsley & Walkden';
  g.fillStyle = RAIL; g.font = `700 30px ${SANS}`;
  const fl = wrap(g, foot, W - P * 2, 1)[0];
  g.fillText(fl, P, o.story ? sy + 190 : H - P);
  return c;
}

/* ---------- Start up ---------- */
const draft = store.get('ll_draft'); if (Array.isArray(draft) && draft.length) { pts = draft; route(); }
let startTab = store.get('ll_tab'); if (startTab === 'saved') startTab = 'journeys';
selectTab(TABS.includes(startTab) && startTab !== 'walk' ? startTab : 'lines', false, true);
loadLines().then(() => { if (tab === 'routes' || tab === 'journeys') renderList(tab); });
themeHooks.push(() => { if (tab === 'routes' || tab === 'journeys') { if (!detailId) renderList(tab); } });
window.addEventListener('offline', () => toast('You’re offline. Saved paths and map areas you’ve viewed still work.'));
})();
