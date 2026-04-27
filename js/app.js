// Chicoutimi — Carte interactive des zones
const DEFAULT_PALETTE = [
  '#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#264653',
  '#8338ec', '#3a86ff', '#ff006e', '#06a77d', '#ef476f',
  '#118ab2', '#ffd166'
];

const BASEMAPS = {
  light: {
    version: 8,
    sources: { carto: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: '© OSM · © CARTO' } },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
  },
  osm: {
    version: 8,
    sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
  },
  sat: {
    version: 8,
    sources: { esri: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri · World Imagery' } },
    layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
  }
};

const STORAGE_KEY = 'chicoutimi.style.v1';

const state = {
  zoneset: '9',
  basemap: 'osm',
  layers: { zones: true, limit: true, quartiers: true, rues: false },
  data: {},
  // per-zoneset color overrides: { '9': ['#xxx', ...], '12': [...] }
  colors: { '9': [...DEFAULT_PALETTE], '12': [...DEFAULT_PALETTE] },
  fillOpacity: 0.30,
  lineOpacity: 1.0,
  lineWidth: 3,
  showLabels: true,
  activeZone: null
};

function loadSavedStyle() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (s) Object.assign(state, s);
  } catch {}
}
function saveStyle() {
  const { colors, fillOpacity, lineOpacity, lineWidth, showLabels } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ colors, fillOpacity, lineOpacity, lineWidth, showLabels }));
}

const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAPS.osm,
  center: [-71.07, 48.42],
  zoom: 10.5
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '280px' });

async function loadData() {
  const files = {
    limit: 'data/chicoutimi_limite.geojson',
    z9: 'data/chicoutimi_9_zones.geojson',
    z12: 'data/chicoutimi_12_zones.geojson',
    quartiers: 'data/quartiers_dans_zones.geojson',
    rues: 'data/rues_dans_zones.geojson'
  };
  const entries = await Promise.all(Object.entries(files).map(async ([k, p]) => [k, await (await fetch(p)).json()]));
  state.data = Object.fromEntries(entries);
  // ensure each zone has a stable numeric id and a label point
  for (const key of ['z9', 'z12']) {
    state.data[key].features.forEach((f, i) => {
      f.id = i;
      f.properties._idx = i;
      f.properties._num = i + 1;
    });
  }
  // build a FeatureCollection of label points (centroids) for zone numbers
  for (const key of ['z9', 'z12']) {
    const labels = {
      type: 'FeatureCollection',
      features: state.data[key].features.map((f, i) => ({
        type: 'Feature',
        properties: { _idx: i, _num: i + 1 },
        geometry: { type: 'Point', coordinates: polygonCenter(f.geometry) }
      }))
    };
    state.data[key + '_labels'] = labels;
  }
}

function polygonCenter(geom) {
  // pole-of-inaccessibility approximation: use centroid of largest ring's bbox center
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

function colorExpression() {
  const cols = state.colors[state.zoneset];
  const expr = ['match', ['get', '_idx']];
  cols.forEach((c, i) => expr.push(i, c));
  expr.push('#888');
  return expr;
}

function buildLayers() {
  const zk = 'z' + state.zoneset;

  map.addSource('limit', { type: 'geojson', data: state.data.limit });
  map.addSource('zones', { type: 'geojson', data: state.data[zk], promoteId: 'id' });
  map.addSource('zone-labels', { type: 'geojson', data: state.data[zk + '_labels'] });
  map.addSource('quartiers', { type: 'geojson', data: state.data.quartiers });
  map.addSource('rues', { type: 'geojson', data: state.data.rues });

  map.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: 'zones',
    paint: {
      'fill-color': colorExpression(),
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, state.fillOpacity + 0.2), state.fillOpacity]
    }
  });

  map.addLayer({
    id: 'zones-line',
    type: 'line',
    source: 'zones',
    paint: {
      'line-color': colorExpression(),
      'line-width': ['case', ['boolean', ['feature-state', 'active'], false], state.lineWidth + 2, state.lineWidth],
      'line-opacity': state.lineOpacity
    }
  });

  map.addLayer({
    id: 'limit-line',
    type: 'line',
    source: 'limit',
    paint: { 'line-color': '#111', 'line-width': 2.5, 'line-dasharray': [2, 2] }
  });

  map.addLayer({
    id: 'zones-label',
    type: 'symbol',
    source: 'zone-labels',
    layout: {
      'text-field': ['to-string', ['get', '_num']],
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 18, 14, 36],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular']
    },
    paint: {
      'text-color': '#111',
      'text-halo-color': '#fff',
      'text-halo-width': 3,
      'text-halo-blur': 0.5
    }
  });

  map.addLayer({
    id: 'rues-pt',
    type: 'circle',
    source: 'rues',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 3.5],
      'circle-color': '#444',
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 0.6,
      'circle-opacity': 0.9
    }
  });

  map.addLayer({
    id: 'quartiers-pt',
    type: 'circle',
    source: 'quartiers',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 10],
      'circle-color': '#7c2eb8',
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.5
    }
  });

  map.addLayer({
    id: 'quartiers-label',
    type: 'symbol',
    source: 'quartiers',
    minzoom: 11,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular']
    },
    paint: { 'text-color': '#1a1a1a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 }
  });

  map.addLayer({
    id: 'rues-label',
    type: 'symbol',
    source: 'rues',
    minzoom: 14,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 10,
      'text-offset': [0, 0.8],
      'text-anchor': 'top',
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular']
    },
    paint: { 'text-color': '#444', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
  });

  attachInteractions();
  applyVisibility();
}

let hoveredZone = null;
function attachInteractions() {
  map.on('mousemove', 'zones-fill', (e) => {
    if (!e.features.length) return;
    map.getCanvas().style.cursor = 'pointer';
    const fid = e.features[0].id;
    if (fid === undefined || fid === null) return;
    if (hoveredZone !== null && hoveredZone !== fid) {
      map.setFeatureState({ source: 'zones', id: hoveredZone }, { hover: false });
    }
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
    const idx = f.properties._idx;
    showZonePopup(idx, e.lngLat);
    setActiveZone(idx);
  });

  for (const lyr of ['quartiers-pt', 'rues-pt']) {
    map.on('click', lyr, (e) => {
      const f = e.features[0];
      popup.setLngLat(e.lngLat)
        .setHTML(`<div class="popup-title">${escapeHtml(f.properties.name || '?')}</div>
                  <div class="popup-meta">${escapeHtml(f.properties.kind || '')}</div>`).addTo(map);
    });
    map.on('mouseenter', lyr, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', lyr, () => map.getCanvas().style.cursor = '');
  }
}

function showZonePopup(idx, lngLat) {
  const contents = computeZoneContents(idx);
  const color = state.colors[state.zoneset][idx];
  popup.setLngLat(lngLat).setHTML(`
    <div class="popup-title"><span class="popup-swatch" style="background:${color}"></span>Zone ${idx + 1}</div>
    <div class="popup-meta">${contents.quartiers.length} quartier(s) · ${contents.rues.length} rue(s) nommée(s)</div>
    <button class="popup-btn" data-zone="${idx}">Voir le détail</button>
  `).addTo(map);
  // popup content is added to DOM async — bind after a tick
  setTimeout(() => {
    const btn = document.querySelector('.maplibregl-popup-content .popup-btn');
    if (btn) btn.onclick = () => openZoneDetail(idx);
  }, 0);
}

const zoneCache = new Map();
function computeZoneContents(idx) {
  const key = state.zoneset + ':' + idx;
  if (zoneCache.has(key)) return zoneCache.get(key);
  const z = state.data['z' + state.zoneset].features[idx];
  const bbox = featureBbox(z);
  const quartiers = [], ruesSet = new Map();
  for (const p of state.data.quartiers.features) {
    if (pointInBbox(p.geometry.coordinates, bbox) && pointInPoly(p.geometry.coordinates, z.geometry))
      quartiers.push(p);
  }
  for (const p of state.data.rues.features) {
    if (pointInBbox(p.geometry.coordinates, bbox) && pointInPoly(p.geometry.coordinates, z.geometry)) {
      const n = p.properties.name || '';
      if (!ruesSet.has(n)) ruesSet.set(n, p);
    }
  }
  const result = {
    quartiers: quartiers.sort((a, b) => (a.properties.name || '').localeCompare(b.properties.name || '')),
    rues: [...ruesSet.values()].sort((a, b) => (a.properties.name || '').localeCompare(b.properties.name || ''))
  };
  zoneCache.set(key, result);
  return result;
}

function openZoneDetail(idx) {
  const c = computeZoneContents(idx);
  const color = state.colors[state.zoneset][idx];
  const panel = document.getElementById('detail-panel');
  panel.innerHTML = `
    <div class="detail__header" style="border-color:${color}">
      <div>
        <h3><span class="popup-swatch" style="background:${color}"></span>Zone ${idx + 1}</h3>
        <div class="muted-inline">${c.quartiers.length} quartier(s) · ${c.rues.length} rue(s)</div>
      </div>
      <button class="detail__close" id="detail-close" aria-label="Fermer">×</button>
    </div>
    <div class="detail__body">
      <h4>Quartiers (${c.quartiers.length})</h4>
      <ul class="detail__list">
        ${c.quartiers.length ? c.quartiers.map((q, i) =>
          `<li data-kind="q" data-i="${i}"><span>${escapeHtml(q.properties.name)}</span><span class="tag">${escapeHtml(q.properties.kind || '')}</span></li>`
        ).join('') : '<li class="muted">Aucun</li>'}
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
  panel.querySelector('#detail-close').onclick = () => { panel.hidden = true; };
  panel.querySelectorAll('li[data-kind]').forEach(li => {
    li.onclick = () => {
      const arr = li.dataset.kind === 'q' ? c.quartiers : c.rues;
      const f = arr[+li.dataset.i];
      const coord = f.geometry.coordinates;
      map.flyTo({ center: coord, zoom: 15, duration: 700 });
      popup.setLngLat(coord).setHTML(`<div class="popup-title">${escapeHtml(f.properties.name)}</div><div class="popup-meta">${escapeHtml(f.properties.kind || '')}</div>`).addTo(map);
    };
  });
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
function pointInBbox(p, b) { return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
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

function applyVisibility() {
  const v = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  v('zones-fill', state.layers.zones);
  v('zones-line', state.layers.zones);
  v('zones-label', state.layers.zones && state.showLabels);
  v('limit-line', state.layers.limit);
  v('quartiers-pt', state.layers.quartiers);
  v('quartiers-label', state.layers.quartiers);
  v('rues-pt', state.layers.rues);
  v('rues-label', state.layers.rues);
}

function refreshZonePaint() {
  if (!map.getLayer('zones-fill')) return;
  map.setPaintProperty('zones-fill', 'fill-color', colorExpression());
  map.setPaintProperty('zones-line', 'line-color', colorExpression());
  map.setPaintProperty('zones-fill', 'fill-opacity',
    ['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, state.fillOpacity + 0.2), state.fillOpacity]);
  map.setPaintProperty('zones-line', 'line-width',
    ['case', ['boolean', ['feature-state', 'active'], false], state.lineWidth + 2, state.lineWidth]);
  map.setPaintProperty('zones-line', 'line-opacity', state.lineOpacity);
}

function switchZoneset(n) {
  state.zoneset = n;
  const zk = 'z' + n;
  map.getSource('zones').setData(state.data[zk]);
  map.getSource('zone-labels').setData(state.data[zk + '_labels']);
  refreshZonePaint();
  buildZoneGrid();
  state.activeZone = null;
}

function buildZoneGrid() {
  const grid = document.getElementById('zone-grid');
  grid.innerHTML = '';
  const cols = state.colors[state.zoneset];
  state.data['z' + state.zoneset].features.forEach((f, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'zone-cell';
    wrap.innerHTML = `
      <button class="zone-btn" style="--zone-color:${cols[i]}" data-idx="${i}" title="Zoomer sur la zone ${i + 1}">
        <span>${i + 1}</span>
      </button>
      <input type="color" class="zone-color" value="${cols[i]}" data-idx="${i}" title="Changer la couleur" />
    `;
    grid.appendChild(wrap);
  });
  grid.querySelectorAll('.zone-btn').forEach(b => {
    b.onclick = () => zoomToZone(+b.dataset.idx);
  });
  grid.querySelectorAll('.zone-color').forEach(inp => {
    inp.oninput = () => {
      const idx = +inp.dataset.idx;
      state.colors[state.zoneset][idx] = inp.value;
      const sib = inp.parentElement.querySelector('.zone-btn');
      sib.style.setProperty('--zone-color', inp.value);
      refreshZonePaint();
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
  if (state.activeZone !== null) {
    map.setFeatureState({ source: 'zones', id: state.activeZone }, { active: false });
  }
  state.activeZone = idx;
  if (idx !== null) map.setFeatureState({ source: 'zones', id: idx }, { active: true });
  document.querySelectorAll('.zone-btn').forEach(btn => btn.classList.toggle('is-active', +btn.dataset.idx === idx));
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

function recenter() {
  if (!state.data.limit) return;
  const bb = fcBbox(state.data.limit);
  map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 50, duration: 800 });
  setActiveZone(null);
}

function setBasemap(key) {
  state.basemap = key;
  map.setStyle(BASEMAPS[key]);
  map.once('styledata', () => { buildLayers(); buildZoneGrid(); });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setupSearch() {
  const input = document.getElementById('search');
  const results = document.getElementById('results');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { results.hidden = true; return; }
    const matches = [];
    for (const f of state.data.quartiers.features) {
      if ((f.properties.name || '').toLowerCase().includes(q)) matches.push({ f, type: 'Quartier' });
      if (matches.length >= 30) break;
    }
    if (matches.length < 30) {
      const seen = new Set();
      for (const f of state.data.rues.features) {
        const n = f.properties.name || '';
        if (n.toLowerCase().includes(q) && !seen.has(n)) { seen.add(n); matches.push({ f, type: 'Rue' }); if (matches.length >= 30) break; }
      }
    }
    if (!matches.length) { results.innerHTML = '<div class="result-item">Aucun résultat</div>'; results.hidden = false; return; }
    results.innerHTML = matches.map((m, i) =>
      `<div class="result-item" data-idx="${i}"><span>${escapeHtml(m.f.properties.name)}</span><span class="tag">${m.type}</span></div>`).join('');
    results.hidden = false;
    results.querySelectorAll('.result-item').forEach((el, i) => {
      el.onclick = () => {
        const c = matches[i].f.geometry.coordinates;
        map.flyTo({ center: c, zoom: 15, duration: 800 });
        popup.setLngLat(c).setHTML(`<div class="popup-title">${escapeHtml(matches[i].f.properties.name)}</div><div class="popup-meta">${matches[i].type}</div>`).addTo(map);
        results.hidden = true; input.value = '';
      };
    });
  });
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.hidden = true;
  });
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
    input.onchange = () => { state.layers[input.dataset.layer] = input.checked; applyVisibility(); };
  });

  // Style controls
  const fillOp = document.getElementById('fill-opacity');
  const lineOp = document.getElementById('line-opacity');
  const lineW = document.getElementById('line-width');
  const labels = document.getElementById('show-labels');
  if (fillOp) {
    fillOp.value = state.fillOpacity;
    fillOp.oninput = () => { state.fillOpacity = +fillOp.value; refreshZonePaint(); saveStyle(); };
  }
  if (lineOp) {
    lineOp.value = state.lineOpacity;
    lineOp.oninput = () => { state.lineOpacity = +lineOp.value; refreshZonePaint(); saveStyle(); };
  }
  if (lineW) {
    lineW.value = state.lineWidth;
    lineW.oninput = () => { state.lineWidth = +lineW.value; refreshZonePaint(); saveStyle(); };
  }
  if (labels) {
    labels.checked = state.showLabels;
    labels.onchange = () => { state.showLabels = labels.checked; applyVisibility(); saveStyle(); };
  }
  const resetColors = document.getElementById('reset-colors');
  if (resetColors) {
    resetColors.onclick = () => {
      state.colors[state.zoneset] = [...DEFAULT_PALETTE];
      buildZoneGrid(); refreshZonePaint(); saveStyle();
    };
  }

  document.getElementById('sidebar-toggle').onclick = () => {
    document.body.classList.toggle('sidebar-collapsed');
    setTimeout(() => map.resize(), 220);
  };
  document.getElementById('reset-btn').onclick = recenter;
}

function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.hidden = true, ms);
}

(async function init() {
  try {
    loadSavedStyle();
    await loadData();
    map.on('load', () => {
      buildLayers();
      buildZoneGrid();
      recenter();
      toast(`${state.data.quartiers.features.length} quartiers · ${state.data.rues.features.length} rues chargés`);
    });
    setupUI();
    setupSearch();
  } catch (err) {
    console.error(err);
    toast('Erreur de chargement des données');
  }
})();
