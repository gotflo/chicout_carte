// Zone 5 — Carte interactive des sous-zones
const DEFAULT_PALETTE = [
  '#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#264653',
  '#8338ec', '#3a86ff', '#ff006e', '#06a77d', '#ef476f',
  '#118ab2', '#ffd166'
];

const BASEMAPS = {
  light: {
    version: 8,
    sources: { carto: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: '© OSM · © CARTO' } },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }]
  },
  osm: {
    version: 8,
    sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
  },
  sat: {
    version: 8,
    sources: { esri: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri' } },
    layers: [{ id: 'esri', type: 'raster', source: 'esri' }]
  }
};

const STORAGE_KEY = 'zone5.style.v1';

const state = {
  zoneset: '9',
  basemap: 'osm',
  layers: { zones: true, numbers: true, landmarks: true, rues: false, rueLabels: false },
  data: {},
  colors: { '9': [...DEFAULT_PALETTE], '12': [...DEFAULT_PALETTE] },
  fillOpacity: 0.30,
  lineOpacity: 1.0,
  lineWidth: 2.5,
  activeZone: null,
  ruesEnriched: false,
};

function loadSavedStyle() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (s) Object.assign(state, s);
  } catch {}
}
function saveStyle() {
  const { colors, fillOpacity, lineOpacity, lineWidth } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ colors, fillOpacity, lineOpacity, lineWidth }));
}

const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAPS.osm,
  center: [-71.07, 48.42],
  zoom: 11,
  preserveDrawingBuffer: true   // nécessaire pour l'export PNG
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '280px' });

// ---------- chargement ---------- //

async function loadData() {
  const files = {
    z9:  'data/zone5_9_zones.geojson',
    z12: 'data/zone5_12_zones.geojson',
    l9:  'data/zone5_9_landmarks.geojson',
    l12: 'data/zone5_12_landmarks.geojson',
    rues: 'data/zone5_rues.geojson',
  };
  const entries = await Promise.all(Object.entries(files).map(
    async ([k, p]) => [k, await (await fetch(p)).json()]));
  state.data = Object.fromEntries(entries);

  // id stable + _idx _num pour les sous-zones
  for (const k of ['z9', 'z12', 'l9', 'l12']) {
    state.data[k].features.forEach((f, i) => {
      f.id = i;
      if (!f.properties) f.properties = {};
      if (f.properties._idx === undefined) f.properties._idx = i;
      if (!f.properties._num) f.properties._num = i + 1;
    });
  }

  // points pour les numéros
  for (const k of ['z9', 'z12']) {
    state.data[k + '_labels'] = {
      type: 'FeatureCollection',
      features: state.data[k].features.map((f, i) => ({
        type: 'Feature',
        properties: { _idx: i, _num: i + 1, color: f.properties.color || DEFAULT_PALETTE[i] },
        geometry: { type: 'Point', coordinates: polygonCenter(f.geometry) }
      }))
    };
  }

  // enrichir les rues : sz9 et sz12 par point-in-polygon
  enrichRues();
}

function enrichRues() {
  if (state.ruesEnriched) return;
  const z9 = state.data.z9.features;
  const z12 = state.data.z12.features;
  for (const r of state.data.rues.features) {
    const c = r.geometry.coordinates;
    r.properties.sz9 = whichZone(c, z9);
    r.properties.sz12 = whichZone(c, z12);
    if (r.properties.sz9 != null)
      r.properties.color9 = z9[r.properties.sz9 - 1].properties.color;
    if (r.properties.sz12 != null)
      r.properties.color12 = z12[r.properties.sz12 - 1].properties.color;
  }
  state.ruesEnriched = true;
}

function whichZone(coord, features) {
  for (const f of features) {
    if (pointInPoly(coord, f.geometry)) return f.properties._num;
  }
  return null;
}

// ---------- géométrie ---------- //

function polygonCenter(geom) {
  const rings = geom.type === 'MultiPolygon' ? geom.coordinates.flat() : geom.coordinates;
  let best = null, bestArea = -1;
  for (const ring of rings) {
    const b = bboxOfRing(ring);
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    if (area > bestArea) { bestArea = area; best = b; }
  }
  return [(best[0] + best[2]) / 2, (best[1] + best[3]) / 2];
}
function bboxOfRing(ring) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of ring) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return [minx, miny, maxx, maxy];
}
function featureBbox(feature) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minx) minx = c[0]; if (c[0] > maxx) maxx = c[0];
      if (c[1] < miny) miny = c[1]; if (c[1] > maxy) maxy = c[1];
    } else c.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  return [minx, miny, maxx, maxy];
}
function fcBbox(fc) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of fc.features) {
    const b = featureBbox(f);
    if (b[0] < minx) minx = b[0]; if (b[2] > maxx) maxx = b[2];
    if (b[1] < miny) miny = b[1]; if (b[3] > maxy) maxy = b[3];
  }
  return [minx, miny, maxx, maxy];
}
function pointInPoly(pt, geom) {
  if (geom.type === 'Polygon') return pointInRings(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(rings => pointInRings(pt, rings));
  return false;
}
function pointInRings(pt, rings) {
  if (!pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false;
  return true;
}
function pointInRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// ---------- couleurs ---------- //

function colorExpression() {
  const cols = state.colors[state.zoneset];
  const expr = ['match', ['get', '_idx']];
  cols.forEach((c, i) => expr.push(i, c));
  expr.push('#888');
  return expr;
}
function ruesColorExpression() {
  const cols = state.colors[state.zoneset];
  const field = 'sz' + state.zoneset;
  const expr = ['match', ['get', field]];
  cols.forEach((c, i) => expr.push(i + 1, c));
  expr.push('#888');
  return expr;
}

// ---------- couches MapLibre ---------- //

function buildLayers() {
  const zk = 'z' + state.zoneset;
  const lk = 'l' + state.zoneset;

  map.addSource('zones', { type: 'geojson', data: state.data[zk], promoteId: 'id' });
  map.addSource('zone-labels', { type: 'geojson', data: state.data[zk + '_labels'] });
  map.addSource('landmarks', { type: 'geojson', data: state.data[lk] });
  map.addSource('rues', { type: 'geojson', data: state.data.rues });

  map.addLayer({
    id: 'zones-fill', type: 'fill', source: 'zones',
    paint: {
      'fill-color': colorExpression(),
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false],
                       Math.min(1, state.fillOpacity + 0.18), state.fillOpacity]
    }
  });
  map.addLayer({
    id: 'zones-line', type: 'line', source: 'zones',
    paint: {
      'line-color': colorExpression(),
      'line-width': ['case', ['boolean', ['feature-state', 'active'], false],
                     state.lineWidth + 2, state.lineWidth],
      'line-opacity': state.lineOpacity
    }
  });

  map.addLayer({
    id: 'rues-pt', type: 'circle', source: 'rues',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 15, 4],
      'circle-color': ruesColorExpression(),
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 0.6,
      'circle-opacity': 0.9
    }
  });

  buildZoneMarkers();
  buildLandmarkMarkers();
  buildRueLabels();
  attachInteractions();
  applyVisibility();
}

// HTML markers — numéros
const zoneNumMarkers = [];
function buildZoneMarkers() {
  zoneNumMarkers.forEach(m => m.remove());
  zoneNumMarkers.length = 0;
  if (!state.layers.numbers || !state.layers.zones) return;
  const fc = state.data['z' + state.zoneset + '_labels'];
  fc.features.forEach(f => {
    const el = document.createElement('div');
    el.className = 'zone-num-marker';
    el.style.borderColor = f.properties.color;
    el.textContent = f.properties._num;
    zoneNumMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(f.geometry.coordinates).addTo(map));
  });
}

// HTML markers — landmarks (étoile)
const landmarkMarkers = [];
function buildLandmarkMarkers() {
  landmarkMarkers.forEach(m => m.remove());
  landmarkMarkers.length = 0;
  if (!state.layers.landmarks) return;
  const fc = state.data['l' + state.zoneset];
  fc.features.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'lm-marker';
    wrap.innerHTML = `
      <div class="lm-star">★</div>
      <div class="lm-label">${escapeHtml(f.properties.name)}</div>
    `;
    wrap.title = `Sous-zone ${f.properties._num} — ${f.properties.kind} : ${f.properties.name}`;
    wrap.onclick = () => {
      openZoneDetail(f.properties._idx);
    };
    landmarkMarkers.push(new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
      .setLngLat(f.geometry.coordinates).addTo(map));
  });
}

// labels rues (DOM, visible à zoom élevé seulement)
const rueLabelMarkers = [];
function buildRueLabels() {
  rueLabelMarkers.forEach(m => m.remove());
  rueLabelMarkers.length = 0;
  if (!state.layers.rueLabels || !state.layers.rues) return;
  for (const r of state.data.rues.features) {
    const el = document.createElement('div');
    el.className = 'rue-label';
    el.textContent = r.properties.name;
    rueLabelMarkers.push(new maplibregl.Marker({ element: el, anchor: 'top' })
      .setLngLat(r.geometry.coordinates).addTo(map));
  }
  refreshRueLabelVisibility();
}
function refreshRueLabelVisibility() {
  const z = map.getZoom();
  const visible = z >= 13;
  for (const m of rueLabelMarkers) {
    m.getElement().style.display = visible ? '' : 'none';
  }
}
map.on('zoom', refreshRueLabelVisibility);

// ---------- interactions ---------- //

let hoveredZone = null;
function attachInteractions() {
  map.on('mousemove', 'zones-fill', (e) => {
    if (!e.features.length) return;
    map.getCanvas().style.cursor = 'pointer';
    const fid = e.features[0].id;
    if (fid === undefined || fid === null) return;
    if (hoveredZone !== null && hoveredZone !== fid)
      map.setFeatureState({ source: 'zones', id: hoveredZone }, { hover: false });
    hoveredZone = fid;
    map.setFeatureState({ source: 'zones', id: hoveredZone }, { hover: true });
  });
  map.on('mouseleave', 'zones-fill', () => {
    map.getCanvas().style.cursor = '';
    if (hoveredZone !== null) map.setFeatureState({ source: 'zones', id: hoveredZone }, { hover: false });
    hoveredZone = null;
  });
  map.on('click', 'zones-fill', (e) => {
    const f = e.features[0];
    showZonePopup(f.properties._idx, e.lngLat);
    setActiveZone(f.properties._idx);
  });
  map.on('click', 'rues-pt', (e) => {
    const f = e.features[0];
    popup.setLngLat(e.lngLat).setHTML(`
      <div class="popup-title">${escapeHtml(f.properties.name)}</div>
      <div class="popup-meta">${escapeHtml(f.properties.kind || '')} · sous-zone ${f.properties['sz' + state.zoneset] ?? '?'}</div>
    `).addTo(map);
  });
  map.on('mouseenter', 'rues-pt', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'rues-pt', () => map.getCanvas().style.cursor = '');
}

function showZonePopup(idx, lngLat) {
  const c = computeZoneContents(idx);
  const lm = state.data['l' + state.zoneset].features[idx];
  const color = state.colors[state.zoneset][idx];
  popup.setLngLat(lngLat).setHTML(`
    <div class="popup-title"><span class="popup-swatch" style="background:${color}"></span>Sous-zone ${idx + 1}</div>
    <div class="popup-meta">${c.rues.length} rue(s) nommée(s)</div>
    <div class="popup-meta"><strong>${escapeHtml(lm.properties.kind)} :</strong> ${escapeHtml(lm.properties.name)}</div>
    <button class="popup-btn" data-zone="${idx}">Voir le détail</button>
  `).addTo(map);
  setTimeout(() => {
    const btn = document.querySelector('.maplibregl-popup-content .popup-btn');
    if (btn) btn.onclick = () => openZoneDetail(idx);
  }, 0);
}

const zoneCache = new Map();
function computeZoneContents(idx) {
  const key = state.zoneset + ':' + idx;
  if (zoneCache.has(key)) return zoneCache.get(key);
  const num = idx + 1;
  const field = 'sz' + state.zoneset;
  const ruesSet = new Map();
  for (const r of state.data.rues.features) {
    if (r.properties[field] === num) {
      const n = r.properties.name || '';
      if (!ruesSet.has(n)) ruesSet.set(n, r);
    }
  }
  const result = {
    rues: [...ruesSet.values()].sort(
      (a, b) => (a.properties.name || '').localeCompare(b.properties.name || ''))
  };
  zoneCache.set(key, result);
  return result;
}

function openZoneDetail(idx) {
  const c = computeZoneContents(idx);
  const lm = state.data['l' + state.zoneset].features[idx];
  const color = state.colors[state.zoneset][idx];
  const panel = document.getElementById('detail-panel');
  panel.innerHTML = `
    <div class="detail__header" style="border-color:${color}">
      <div>
        <h3><span class="popup-swatch" style="background:${color}"></span>Sous-zone ${idx + 1}</h3>
        <div class="muted-inline">${c.rues.length} rue(s) · ${escapeHtml(lm.properties.kind)} : <strong>${escapeHtml(lm.properties.name)}</strong></div>
      </div>
      <button class="detail__close" id="detail-close" aria-label="Fermer">×</button>
    </div>
    <div class="detail__body">
      <h4>Point stratégique</h4>
      <ul class="detail__list">
        <li data-kind="lm"><span>${escapeHtml(lm.properties.name)}</span><span class="tag">${escapeHtml(lm.properties.kind)}</span></li>
      </ul>
      <h4>Rues nommées (${c.rues.length})</h4>
      <ul class="detail__list">
        ${c.rues.length ? c.rues.map((r, i) =>
          `<li data-kind="r" data-i="${i}"><span>${escapeHtml(r.properties.name)}</span><span class="tag">${escapeHtml(r.properties.kind || '')}</span></li>`
        ).join('') : '<li class="muted">Aucune</li>'}
      </ul>
    </div>
  `;
  panel.hidden = false;
  panel.querySelector('#detail-close').addEventListener('click', (e) => {
    e.stopPropagation(); panel.hidden = true;
  });
  panel.querySelectorAll('li[data-kind]').forEach(li => {
    li.onclick = () => {
      const f = li.dataset.kind === 'lm' ? lm : c.rues[+li.dataset.i];
      const coord = f.geometry.coordinates;
      map.flyTo({ center: coord, zoom: 16, duration: 700 });
      popup.setLngLat(coord).setHTML(`
        <div class="popup-title">${escapeHtml(f.properties.name)}</div>
        <div class="popup-meta">${escapeHtml(f.properties.kind || '')}</div>
      `).addTo(map);
    };
  });
}

// ---------- visibilité / repaint ---------- //

function applyVisibility() {
  const v = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  v('zones-fill', state.layers.zones);
  v('zones-line', state.layers.zones);
  v('rues-pt',    state.layers.rues);
  buildZoneMarkers();
  buildLandmarkMarkers();
  buildRueLabels();
}

function refreshZonePaint() {
  if (!map.getLayer('zones-fill')) return;
  map.setPaintProperty('zones-fill', 'fill-color', colorExpression());
  map.setPaintProperty('zones-line', 'line-color', colorExpression());
  map.setPaintProperty('rues-pt', 'circle-color', ruesColorExpression());
  map.setPaintProperty('zones-fill', 'fill-opacity',
    ['case', ['boolean', ['feature-state', 'hover'], false],
     Math.min(1, state.fillOpacity + 0.18), state.fillOpacity]);
  map.setPaintProperty('zones-line', 'line-width',
    ['case', ['boolean', ['feature-state', 'active'], false],
     state.lineWidth + 2, state.lineWidth]);
  map.setPaintProperty('zones-line', 'line-opacity', state.lineOpacity);
}

function switchZoneset(n) {
  state.zoneset = n;
  state.activeZone = null;
  zoneCache.clear();
  map.getSource('zones').setData(state.data['z' + n]);
  map.getSource('zone-labels').setData(state.data['z' + n + '_labels']);
  map.getSource('landmarks').setData(state.data['l' + n]);
  refreshZonePaint();
  buildZoneMarkers();
  buildLandmarkMarkers();
  buildZoneGrid();
}

// ---------- grille latérale ---------- //

function buildZoneGrid() {
  const grid = document.getElementById('zone-grid');
  grid.innerHTML = '';
  const cols = state.colors[state.zoneset];
  const lms  = state.data['l' + state.zoneset].features;
  state.data['z' + state.zoneset].features.forEach((f, i) => {
    const lm = lms[i];
    const wrap = document.createElement('div');
    wrap.className = 'zone-cell';
    wrap.title = lm ? `${lm.properties.kind} : ${lm.properties.name}` : '';
    wrap.innerHTML = `
      <button class="zone-btn" style="--zone-color:${cols[i]}" data-idx="${i}" title="Zoomer sur la sous-zone ${i + 1}">
        <span>${i + 1}</span>
      </button>
      <input type="color" class="zone-color" value="${cols[i]}" data-idx="${i}" title="Changer la couleur" />
      <button class="zone-info" data-idx="${i}" title="Détails de la sous-zone">i</button>
    `;
    grid.appendChild(wrap);
  });
  grid.querySelectorAll('.zone-btn').forEach(b => {
    b.onclick = () => zoomToZone(+b.dataset.idx);
  });
  grid.querySelectorAll('.zone-info').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openZoneDetail(+b.dataset.idx); };
  });
  grid.querySelectorAll('.zone-color').forEach(inp => {
    inp.oninput = () => {
      const idx = +inp.dataset.idx;
      state.colors[state.zoneset][idx] = inp.value;
      inp.parentElement.querySelector('.zone-btn')
         .style.setProperty('--zone-color', inp.value);
      refreshZonePaint();
      buildZoneMarkers();
      saveStyle();
    };
  });
}

function zoomToZone(idx) {
  const f = state.data['z' + state.zoneset].features[idx];
  const b = featureBbox(f);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, duration: 800 });
  setActiveZone(idx);
}
function setActiveZone(idx) {
  if (state.activeZone !== null)
    map.setFeatureState({ source: 'zones', id: state.activeZone }, { active: false });
  state.activeZone = idx;
  if (idx !== null) map.setFeatureState({ source: 'zones', id: idx }, { active: true });
  document.querySelectorAll('.zone-btn').forEach(btn =>
    btn.classList.toggle('is-active', +btn.dataset.idx === idx));
}
function recenter() {
  const bb = fcBbox(state.data['z' + state.zoneset]);
  map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 50, duration: 800 });
  setActiveZone(null);
}

function setBasemap(key) {
  state.basemap = key;
  map.setStyle(BASEMAPS[key]);
  map.once('styledata', () => { buildLayers(); buildZoneGrid(); });
}

// ---------- recherche ---------- //

function setupSearch() {
  const input = document.getElementById('search');
  const results = document.getElementById('results');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { results.hidden = true; return; }
    const matches = [];
    // landmarks d'abord
    for (const f of state.data['l' + state.zoneset].features) {
      if ((f.properties.name || '').toLowerCase().includes(q))
        matches.push({ f, type: f.properties.kind });
      if (matches.length >= 30) break;
    }
    if (matches.length < 30) {
      const seen = new Set();
      for (const f of state.data.rues.features) {
        const n = f.properties.name || '';
        if (n.toLowerCase().includes(q) && !seen.has(n)) {
          seen.add(n); matches.push({ f, type: 'Rue' });
          if (matches.length >= 30) break;
        }
      }
    }
    if (!matches.length) {
      results.innerHTML = '<div class="result-item">Aucun résultat</div>';
      results.hidden = false; return;
    }
    results.innerHTML = matches.map((m, i) =>
      `<div class="result-item" data-idx="${i}">
        <span>${escapeHtml(m.f.properties.name)}</span>
        <span class="tag">${escapeHtml(m.type)}</span>
       </div>`).join('');
    results.hidden = false;
    results.querySelectorAll('.result-item').forEach((el, i) => {
      el.onclick = () => {
        const c = matches[i].f.geometry.coordinates;
        map.flyTo({ center: c, zoom: 16, duration: 800 });
        popup.setLngLat(c).setHTML(`
          <div class="popup-title">${escapeHtml(matches[i].f.properties.name)}</div>
          <div class="popup-meta">${escapeHtml(matches[i].type)}</div>
        `).addTo(map);
        results.hidden = true; input.value = '';
      };
    });
  });
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.hidden = true;
  });
}

// ---------- export SVG haute qualité ---------- //

function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

// Polygon|MultiPolygon → chaîne de path SVG ("M x,y L x,y Z …"), via une fonction de projection
function geomToSVGPath(geom, project) {
  const rings = geom.type === 'MultiPolygon'
    ? geom.coordinates.flat() : geom.coordinates;
  const parts = [];
  for (const ring of rings) {
    if (!ring.length) continue;
    const segs = ring.map((c, i) => {
      const [x, y] = project(c);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    });
    parts.push(segs.join(' ') + ' Z');
  }
  return parts.join(' ');
}

// étoile à 5 branches centrée en (cx,cy), rayon outer R
function starPath(cx, cy, R) {
  const r = R * 0.42;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? R : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return 'M' + pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L') + ' Z';
}

async function exportSVG() {
  toast('Génération du SVG haute définition…', 60000);
  await new Promise(r => setTimeout(r, 50));

  const onlyZoneIdx = exportState.area === 'all' ? null : exportState.area;
  const bbox = exportBbox();
  const q = EXPORT_QUALITY[exportState.quality];
  const padding = onlyZoneIdx === null ? 60 : 40;
  const cssWidth = q.width;
  const aspectInner = mercatorBboxAspect(bbox);
  const innerW = cssWidth - 2 * padding;
  const cssHeight = Math.max(600, Math.round(innerW * aspectInner + 2 * padding));

  const { center, zoom } = computeFitView(bbox, cssWidth, cssHeight, padding);

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:${cssWidth}px;height:${cssHeight}px;visibility:hidden;pointer-events:none;z-index:-1;`;
  document.body.appendChild(host);
  const m = new maplibregl.Map({
    container: host,
    style: BASEMAPS[state.basemap],
    center,
    zoom,
    pixelRatio: q.pixelRatio,
    preserveDrawingBuffer: true,
    interactive: false,
    fadeDuration: 0,
    attributionControl: false,
  });

  const w = Math.round(cssWidth * q.pixelRatio);
  const h = Math.round(cssHeight * q.pixelRatio);

  let svgText;
  try {
    await new Promise(res => m.once('load', res));
    m.resize();
    m.jumpTo({ center, zoom });
    m.resize();
    await waitForIdle(m, 20000);

    const canvas = m.getCanvas();
    let bgPNG = '';
    try { bgPNG = canvas.toDataURL('image/png'); } catch (e) { console.warn(e); }

    const project = (coord) => {
      const p = m.project(coord);
      return [p.x * q.pixelRatio, p.y * q.pixelRatio];
    };

    const zk = 'z' + state.zoneset;
    const lk = 'l' + state.zoneset;
    const cols = state.colors[state.zoneset];
    const features = state.data[zk].features;
    const labels   = state.data[zk + '_labels'].features;
    const lms      = state.data[lk].features;
    const inScope  = (idx) => onlyZoneIdx === null || idx === onlyZoneIdx;
    const sw = q.pixelRatio;

    const svg = [];
    svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    svg.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
           + `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif">`);
    svg.push(`<title>Zone 5 — ${onlyZoneIdx === null ? state.zoneset + ' sous-zones' : 'sous-zone ' + (onlyZoneIdx + 1)}</title>`);
    svg.push(`<desc>Carte vectorielle générée le ${new Date().toLocaleString('fr-CA')}</desc>`);

    if (bgPNG) {
      svg.push(`<image x="0" y="0" width="${w}" height="${h}" href="${bgPNG}" preserveAspectRatio="xMidYMid slice"/>`);
    } else {
      svg.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#f5f5f5"/>`);
    }

    // voile blanc hors sous-zone choisie
    if (onlyZoneIdx !== null && state.layers.zones) {
      const f = features[onlyZoneIdx];
      const d = geomToSVGPath(f.geometry, project);
      svg.push(`<defs><mask id="zone-mask"><rect width="${w}" height="${h}" fill="white"/>`
             + `<path d="${d}" fill="black" fill-rule="evenodd"/></mask></defs>`);
      svg.push(`<rect width="${w}" height="${h}" fill="white" fill-opacity="0.55" mask="url(#zone-mask)"/>`);
    }

    if (state.layers.zones) {
      svg.push(`<g id="sous-zones" stroke-linejoin="round" stroke-linecap="round">`);
      for (const f of features) {
        const idx = f.properties._idx;
        if (!inScope(idx)) continue;
        const color = cols[idx];
        const d = geomToSVGPath(f.geometry, project);
        svg.push(`<path d="${d}" fill="${color}" fill-opacity="${state.fillOpacity}" `
               + `stroke="${color}" stroke-width="${(state.lineWidth * sw).toFixed(2)}" stroke-opacity="${state.lineOpacity}" fill-rule="evenodd"/>`);
      }
      svg.push(`</g>`);
    }

    if (state.layers.rues) {
      svg.push(`<g id="rues">`);
      for (const r of state.data.rues.features) {
        const sz = r.properties['sz' + state.zoneset];
        if (sz == null) continue;
        if (!inScope(sz - 1)) continue;
        const color = cols[sz - 1];
        const [x, y] = project(r.geometry.coordinates);
        svg.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(3 * sw).toFixed(2)}" fill="${color}" stroke="#fff" stroke-width="${(0.7 * sw).toFixed(2)}"/>`);
      }
      svg.push(`</g>`);

      if (state.layers.rueLabels) {
        svg.push(`<g id="rues-labels" font-size="${(11 * sw).toFixed(1)}" fill="#222" paint-order="stroke" stroke="#fff" stroke-width="${(2 * sw).toFixed(1)}" stroke-linejoin="round">`);
        for (const r of state.data.rues.features) {
          const sz = r.properties['sz' + state.zoneset];
          if (sz == null) continue;
          if (!inScope(sz - 1)) continue;
          const [x, y] = project(r.geometry.coordinates);
          svg.push(`<text x="${x.toFixed(2)}" y="${(y + 12 * sw).toFixed(2)}" text-anchor="middle">${escapeXml(r.properties.name)}</text>`);
        }
        svg.push(`</g>`);
      }
    }

    if (state.layers.numbers && state.layers.zones) {
      svg.push(`<g id="zone-numbers" font-weight="800" font-size="${(22 * sw).toFixed(1)}">`);
      for (const f of labels) {
        if (!inScope(f.properties._idx)) continue;
        const [x, y] = project(f.geometry.coordinates);
        const color = f.properties.color;
        svg.push(`<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})">`
               + `<circle r="${(22 * sw).toFixed(2)}" fill="#ffffff" fill-opacity="0.95" stroke="${color}" stroke-width="${(3 * sw).toFixed(2)}"/>`
               + `<text text-anchor="middle" dominant-baseline="central" fill="#111">${f.properties._num}</text>`
               + `</g>`);
      }
      svg.push(`</g>`);
    }

    if (state.layers.landmarks) {
      svg.push(`<g id="landmarks">`);
      for (const f of lms) {
        if (!inScope(f.properties._idx)) continue;
        const [x, y] = project(f.geometry.coordinates);
        const name = f.properties.name;
        svg.push(`<path d="${starPath(x, y - 4 * sw, 14 * sw)}" fill="#ffb703" stroke="#1a1a1a" stroke-width="${(1.2 * sw).toFixed(2)}"/>`);
        const padX = 6 * sw, padY = 3 * sw, fontSize = 11 * sw;
        const approxW = name.length * 6.2 * sw + padX * 2;
        const lblY = y + 16 * sw;
        svg.push(
          `<g transform="translate(${x.toFixed(2)},${lblY.toFixed(2)})">`
          + `<rect x="${(-approxW/2).toFixed(2)}" y="0" width="${approxW.toFixed(2)}" height="${(fontSize + padY * 2).toFixed(2)}" `
          + `rx="${(4 * sw).toFixed(2)}" ry="${(4 * sw).toFixed(2)}" fill="#ffffff" stroke="#1a1a1a" stroke-width="${(0.6 * sw).toFixed(2)}" fill-opacity="0.97"/>`
          + `<text x="0" y="${(fontSize + padY - sw).toFixed(2)}" text-anchor="middle" font-size="${fontSize.toFixed(1)}" font-weight="600" fill="#1a1a1a">`
          + `Z${f.properties._num} · ${escapeXml(name)}`
          + `</text>`
          + `</g>`);
      }
      svg.push(`</g>`);
    }

    svg.push(`</svg>`);
    svgText = svg.join('\n');
  } finally {
    m.remove();
    host.remove();
  }

  const onlyZoneIdx2 = exportState.area === 'all' ? null : exportState.area;
  const suffix = onlyZoneIdx2 === null ? `${state.zoneset}sz` : `sz${onlyZoneIdx2 + 1}`;
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `zone5_${suffix}_${exportState.quality}.svg`);
  toast('SVG exporté ✓');
}

// ---------- UI globale ---------- //

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function setupUI() {
  document.querySelectorAll('#basemap-seg .seg__btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#basemap-seg .seg__btn').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active'); setBasemap(b.dataset.basemap);
    };
  });
  document.querySelectorAll('#zoneset-seg .seg__btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#zoneset-seg .seg__btn').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active'); switchZoneset(b.dataset.zoneset);
    };
  });
  document.querySelectorAll('input[data-layer]').forEach(input => {
    input.checked = state.layers[input.dataset.layer];
    input.onchange = () => {
      state.layers[input.dataset.layer] = input.checked;
      applyVisibility();
    };
  });

  const fillOp = document.getElementById('fill-opacity');
  const lineOp = document.getElementById('line-opacity');
  const lineW  = document.getElementById('line-width');
  fillOp.value = state.fillOpacity;
  lineOp.value = state.lineOpacity;
  lineW.value  = state.lineWidth;
  fillOp.oninput = () => { state.fillOpacity = +fillOp.value; refreshZonePaint(); saveStyle(); };
  lineOp.oninput = () => { state.lineOpacity = +lineOp.value; refreshZonePaint(); saveStyle(); };
  lineW.oninput  = () => { state.lineWidth  = +lineW.value;  refreshZonePaint(); saveStyle(); };

  document.getElementById('reset-colors').onclick = () => {
    state.colors[state.zoneset] = [...DEFAULT_PALETTE];
    buildZoneGrid(); refreshZonePaint(); buildZoneMarkers(); saveStyle();
  };

  document.getElementById('sidebar-toggle').onclick = () => {
    document.body.classList.toggle('sidebar-collapsed');
    setTimeout(() => map.resize(), 220);
  };
  document.getElementById('reset-btn').onclick = recenter;

  // export
  const expOpen = document.getElementById('exp-open');
  if (expOpen) {
    expOpen.onclick = openExportDialog;
    setupExportDialog();
  } else {
    console.warn('Bouton #exp-open introuvable — index.html en cache ?');
  }
}

// ---------- export haute définition ---------- //

const EXPORT_QUALITY = {
  standard: { width: 1400, pixelRatio: 2, label: '≈ 2800 px' },
};

const exportState = {
  area: 'all',     // 'all' ou index numérique de sous-zone
  quality: 'standard',
  format: 'png',
};

function openExportDialog() {
  buildExportAreaGrid();
  updateExportInfo();
  document.getElementById('export-modal').hidden = false;
}
function closeExportDialog() {
  document.getElementById('export-modal').hidden = true;
}

function buildExportAreaGrid() {
  const grid = document.getElementById('exp-area');
  const cols = state.colors[state.zoneset];
  const n = state.data['z' + state.zoneset].features.length;
  const buttons = [`<button type="button" class="exp-area__all${exportState.area === 'all' ? ' is-active' : ''}" data-area="all">Toute la carte</button>`];
  for (let i = 0; i < n; i++) {
    const active = exportState.area === i ? ' is-active' : '';
    buttons.push(`<button type="button" class="exp-zone${active}" style="--zone-color:${cols[i]}" data-area="${i}">${i + 1}</button>`);
  }
  grid.innerHTML = buttons.join('');
  grid.querySelectorAll('[data-area]').forEach(b => {
    b.onclick = () => {
      const v = b.dataset.area;
      exportState.area = v === 'all' ? 'all' : +v;
      grid.querySelectorAll('[data-area]').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      updateExportInfo();
    };
  });
}

function setupExportDialog() {
  const modal = document.getElementById('export-modal');
  modal.querySelectorAll('[data-close]').forEach(el => el.onclick = closeExportDialog);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeExportDialog();
  });
  document.querySelectorAll('#exp-format .seg__btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#exp-format .seg__btn').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      exportState.format = b.dataset.fmt;
      updateExportInfo();
    };
  });
  document.getElementById('exp-go').onclick = runExport;
}

function updateExportInfo() {
  const target = exportState.area === 'all'
    ? `Toute la zone 5 (${state.zoneset} sous-zones)`
    : `Sous-zone ${exportState.area + 1} uniquement`;
  const fmt = exportState.format.toUpperCase();
  const info = exportState.format === 'svg'
    ? `${target} — vectoriel, zoom infini.`
    : `${target} — ${fmt}, basemap “${state.basemap}” haute résolution.`;
  document.getElementById('exp-info').textContent = info;
}

async function runExport() {
  const btn = document.getElementById('exp-go');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Génération…';
  try {
    if (exportState.format === 'svg') {
      await exportSVG();
    } else {
      await exportRasterHighRes();
    }
    closeExportDialog();
  } catch (err) {
    console.error(err);
    toast('Échec de l’export — voir la console.');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function exportBbox() {
  const raw = exportState.area === 'all'
    ? fcBbox(state.data['z' + state.zoneset])
    : featureBbox(state.data['z' + state.zoneset].features[exportState.area]);
  // 4 % de marge pour garantir que badges et étoiles ne sortent pas
  const dx = (raw[2] - raw[0]) * 0.04;
  const dy = (raw[3] - raw[1]) * 0.04;
  return [raw[0] - dx, raw[1] - dy, raw[2] + dx, raw[3] + dy];
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

async function exportRasterHighRes() {
  toast('Génération de l’image haute définition…', 60000);
  const q = EXPORT_QUALITY[exportState.quality];
  const bbox = exportBbox();
  const onlyZoneIdx = exportState.area === 'all' ? null : exportState.area;
  const padding = onlyZoneIdx === null ? 60 : 40;
  const cssWidth = q.width;
  // hauteur calculée pour que le bbox + padding rentre exactement dans le canvas
  const aspectInner = mercatorBboxAspect(bbox);
  const innerW = cssWidth - 2 * padding;
  const innerH = innerW * aspectInner;
  const cssHeight = Math.max(600, Math.round(innerH + 2 * padding));

  const blob = await renderMapImage({
    bbox, padding,
    cssWidth, cssHeight,
    pixelRatio: q.pixelRatio,
    onlyZoneIdx,
    format: exportState.format,
  });

  const suffix = onlyZoneIdx === null ? `${state.zoneset}sz` : `sz${onlyZoneIdx + 1}`;
  const ext = exportState.format === 'jpeg' ? 'jpg' : 'png';
  downloadBlob(blob, `zone5_${suffix}_${exportState.quality}.${ext}`);
  const w = Math.round(cssWidth * q.pixelRatio);
  const h = Math.round(cssHeight * q.pixelRatio);
  toast(`Image exportée — ${w}×${h} px ✓`);
}

// projection Mercator unitaire (0..1)
function mercY(lat) {
  const s = Math.sin(lat * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
function mercX(lng) { return (lng + 180) / 360; }

function mercatorBboxAspect(bbox) {
  const dx = mercX(bbox[2]) - mercX(bbox[0]);
  const dy = mercY(bbox[1]) - mercY(bbox[3]); // mercY décroît avec la latitude
  return dy / Math.max(dx, 1e-12);
}

// Zoom & centre qui font tenir bbox dans (cssWidth-2p)×(cssHeight-2p)
function computeFitView(bbox, cssWidth, cssHeight, padding) {
  const TILE_SIZE = 512; // taille du monde à zoom 0 dans le repère MapLibre
  const dx = mercX(bbox[2]) - mercX(bbox[0]);
  const dy = mercY(bbox[1]) - mercY(bbox[3]);
  const availW = Math.max(1, cssWidth - 2 * padding);
  const availH = Math.max(1, cssHeight - 2 * padding);
  const zx = Math.log2(availW / (dx * TILE_SIZE));
  const zy = Math.log2(availH / (dy * TILE_SIZE));
  const zoom = Math.min(zx, zy, 19);
  return { center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], zoom };
}

async function renderMapImage({ bbox, padding, cssWidth, cssHeight, pixelRatio, onlyZoneIdx, format }) {
  // Conteneur posé hors-écran, mais avec un layout fiable pour MapLibre.
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:${cssWidth}px;height:${cssHeight}px;visibility:hidden;pointer-events:none;z-index:-1;`;
  document.body.appendChild(host);

  // Centre + zoom calculés mathématiquement → la caméra est correcte dès la
  // construction. On ne dépend pas de fitBounds (qui se comporte mal avec
  // un conteneur visibility:hidden).
  const { center, zoom } = computeFitView(bbox, cssWidth, cssHeight, padding);

  const m = new maplibregl.Map({
    container: host,
    style: BASEMAPS[state.basemap],
    center,
    zoom,
    pixelRatio,
    preserveDrawingBuffer: true,
    interactive: false,
    fadeDuration: 0,
    attributionControl: false,
  });

  try {
    await new Promise(res => m.once('load', res));
    m.resize();                     // s'assurer que clientWidth/Height sont connus
    m.jumpTo({ center, zoom });     // re-cale la caméra exactement
    m.resize();
    await waitForIdle(m, 20000);

    const src = m.getCanvas();
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0);

    drawOverlaysOnCanvas(ctx, m, pixelRatio, onlyZoneIdx);

    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpeg' ? 0.93 : undefined;
    return await new Promise((res, rej) =>
      out.toBlob(b => b ? res(b) : rej(new Error('toBlob a échoué')), mime, quality)
    );
  } finally {
    m.remove();
    host.remove();
  }
}

function waitForIdle(m, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const tick = () => {
      try {
        if (m.areTilesLoaded() && m.loaded() && !m.isMoving() && !m.isZooming()) {
          finish();
        } else {
          m.once('idle', tick);
        }
      } catch { finish(); }
    };
    m.once('idle', tick);
    setTimeout(finish, timeoutMs);
  });
}

function drawOverlaysOnCanvas(ctx, m, scale, onlyZoneIdx) {
  const zk = 'z' + state.zoneset;
  const lk = 'l' + state.zoneset;
  const cols = state.colors[state.zoneset];
  const features = state.data[zk].features;
  const labels   = state.data[zk + '_labels'].features;
  const lms      = state.data[lk].features;

  // si on exporte une seule sous-zone : voile blanc à l'extérieur du polygone choisi.
  // On construit le voile sur un canvas séparé (sinon `destination-out` effacerait
  // aussi le fond de carte à l'intérieur du polygone).
  if (onlyZoneIdx !== null && state.layers.zones) {
    const f = features[onlyZoneIdx];
    const veil = document.createElement('canvas');
    veil.width = ctx.canvas.width;
    veil.height = ctx.canvas.height;
    const vctx = veil.getContext('2d');
    vctx.fillStyle = 'rgba(255,255,255,0.65)';
    vctx.fillRect(0, 0, veil.width, veil.height);
    vctx.globalCompositeOperation = 'destination-out';
    tracePolygonPath(vctx, m, f.geometry, scale);
    vctx.fill('evenodd');
    ctx.drawImage(veil, 0, 0);
  }

  // sous-zones (polygones)
  if (state.layers.zones) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const f of features) {
      const idx = f.properties._idx;
      if (onlyZoneIdx !== null && idx !== onlyZoneIdx) continue;
      const color = cols[idx];
      tracePolygonPath(ctx, m, f.geometry, scale);
      ctx.fillStyle = color;
      ctx.globalAlpha = state.fillOpacity;
      ctx.fill('evenodd');
      ctx.globalAlpha = state.lineOpacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = state.lineWidth * scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // rues (points)
  if (state.layers.rues) {
    for (const r of state.data.rues.features) {
      const sz = r.properties['sz' + state.zoneset];
      if (sz == null) continue;
      if (onlyZoneIdx !== null && (sz - 1) !== onlyZoneIdx) continue;
      const p = m.project(r.geometry.coordinates);
      const x = p.x * scale, y = p.y * scale;
      ctx.beginPath(); ctx.arc(x, y, 3 * scale, 0, Math.PI * 2);
      ctx.fillStyle = cols[sz - 1]; ctx.fill();
      ctx.lineWidth = 0.7 * scale; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    if (state.layers.rueLabels) {
      ctx.font = `500 ${11 * scale}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const r of state.data.rues.features) {
        const sz = r.properties['sz' + state.zoneset];
        if (sz == null) continue;
        if (onlyZoneIdx !== null && (sz - 1) !== onlyZoneIdx) continue;
        const p = m.project(r.geometry.coordinates);
        const x = p.x * scale, y = (p.y + 6) * scale;
        ctx.lineWidth = 3 * scale; ctx.strokeStyle = '#fff';
        ctx.lineJoin = 'round';
        ctx.strokeText(r.properties.name, x, y);
        ctx.fillStyle = '#222';
        ctx.fillText(r.properties.name, x, y);
      }
    }
  }

  // numéros de sous-zones
  if (state.layers.numbers && state.layers.zones) {
    ctx.font = `800 ${22 * scale}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of labels) {
      if (onlyZoneIdx !== null && f.properties._idx !== onlyZoneIdx) continue;
      const p = m.project(f.geometry.coordinates);
      const x = p.x * scale, y = p.y * scale;
      const r = 22 * scale;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
      ctx.lineWidth = 3 * scale; ctx.strokeStyle = f.properties.color; ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillText(String(f.properties._num), x, y);
    }
  }

  // points stratégiques
  if (state.layers.landmarks) {
    for (const f of lms) {
      if (onlyZoneIdx !== null && f.properties._idx !== onlyZoneIdx) continue;
      const p = m.project(f.geometry.coordinates);
      const x = p.x * scale, yStar = (p.y - 4) * scale;
      drawStarOnCanvas(ctx, x, yStar, 14 * scale, '#ffb703', '#1a1a1a', 1.2 * scale);

      const name = `Z${f.properties._num} · ${f.properties.name}`;
      const fs = 11 * scale, padX = 6 * scale, padY = 3 * scale;
      ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const metrics = ctx.measureText(name);
      const w = metrics.width + padX * 2;
      const h = fs + padY * 2;
      const lx = x - w / 2, ly = (p.y + 16) * scale;
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      traceRoundedRect(ctx, lx, ly, w, h, 4 * scale);
      ctx.fill();
      ctx.lineWidth = 0.6 * scale; ctx.strokeStyle = '#1a1a1a'; ctx.stroke();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(name, x, ly + h / 2);
    }
  }
}

function tracePolygonPath(ctx, m, geom, scale) {
  const rings = geom.type === 'MultiPolygon' ? geom.coordinates.flat() : geom.coordinates;
  ctx.beginPath();
  for (const ring of rings) {
    if (!ring.length) continue;
    ring.forEach((c, i) => {
      const p = m.project(c);
      const x = p.x * scale, y = p.y * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function drawStarOnCanvas(ctx, cx, cy, R, fill, stroke, sw) {
  const r = R * 0.42;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.stroke();
}

function traceRoundedRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.hidden = true, ms);
}

// ---------- init ---------- //

(async function init() {
  try {
    loadSavedStyle();
    await loadData();
    const ready = () => {
      buildLayers();
      buildZoneGrid();
      recenter();
      toast(`${state.data.rues.features.length} rues chargées · ${state.data['l9'].features.length} points stratégiques`);
    };
    if (map.loaded()) ready(); else map.on('load', ready);
    setupUI();
    setupSearch();
  } catch (err) {
    console.error(err);
    toast('Erreur de chargement des données');
  }
})();
