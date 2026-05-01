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

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

// projette [lng,lat] en pixels (relatif au canvas courant)
function projectLngLat(coord) {
  const p = map.project(coord);
  return [p.x, p.y];
}

// Polygon|MultiPolygon → chaîne de path SVG ("M x,y L x,y Z …")
function geomToSVGPath(geom) {
  const rings = geom.type === 'MultiPolygon'
    ? geom.coordinates.flat() : geom.coordinates;
  const parts = [];
  for (const ring of rings) {
    if (!ring.length) continue;
    const segs = ring.map((c, i) => {
      const [x, y] = projectLngLat(c);
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
  toast('Génération du SVG…', 6000);
  await new Promise(r => setTimeout(r, 50));   // laisser le toast s'afficher

  const canvas = map.getCanvas();
  const w = canvas.width;
  const h = canvas.height;

  // 1) basemap snapshot en haute résolution (data URL PNG)
  // Le canvas WebGL est déjà à devicePixelRatio, donc déjà en haute déf.
  let bgPNG = '';
  try { bgPNG = canvas.toDataURL('image/png'); } catch (e) { console.warn(e); }

  const zk = 'z' + state.zoneset;
  const lk = 'l' + state.zoneset;
  const cols = state.colors[state.zoneset];

  const svg = [];
  svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
         + `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif">`);

  // métadonnées
  svg.push(`<title>Zone 5 — ${state.zoneset} sous-zones</title>`);
  svg.push(`<desc>Carte vectorielle générée le ${new Date().toLocaleString('fr-CA')}</desc>`);

  // 2) basemap (rasterisé)
  if (bgPNG) {
    svg.push(`<image x="0" y="0" width="${w}" height="${h}" href="${bgPNG}" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    svg.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#f5f5f5"/>`);
  }

  // 3) sous-zones (vectoriel — zoom infini)
  if (state.layers.zones) {
    svg.push(`<g id="sous-zones" stroke-linejoin="round" stroke-linecap="round">`);
    for (const f of state.data[zk].features) {
      const idx = f.properties._idx;
      const color = cols[idx];
      const d = geomToSVGPath(f.geometry);
      svg.push(`<path d="${d}" fill="${color}" fill-opacity="${state.fillOpacity}" `
             + `stroke="${color}" stroke-width="${state.lineWidth}" stroke-opacity="${state.lineOpacity}"/>`);
    }
    svg.push(`</g>`);
  }

  // 4) rues (si activées)
  if (state.layers.rues) {
    svg.push(`<g id="rues">`);
    for (const r of state.data.rues.features) {
      const sz = r.properties['sz' + state.zoneset];
      if (sz == null) continue;
      const color = cols[sz - 1];
      const [x, y] = projectLngLat(r.geometry.coordinates);
      svg.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3" fill="${color}" stroke="#fff" stroke-width="0.7"/>`);
    }
    svg.push(`</g>`);

    if (state.layers.rueLabels) {
      svg.push(`<g id="rues-labels" font-size="11" fill="#222" paint-order="stroke" stroke="#fff" stroke-width="2" stroke-linejoin="round">`);
      for (const r of state.data.rues.features) {
        const sz = r.properties['sz' + state.zoneset];
        if (sz == null) continue;
        const [x, y] = projectLngLat(r.geometry.coordinates);
        svg.push(`<text x="${x.toFixed(2)}" y="${(y + 12).toFixed(2)}" text-anchor="middle">${escapeXml(r.properties.name)}</text>`);
      }
      svg.push(`</g>`);
    }
  }

  // 5) numéros de sous-zones (badges blancs, bordure couleur, gros chiffre)
  if (state.layers.numbers && state.layers.zones) {
    svg.push(`<g id="zone-numbers" font-weight="800" font-size="22">`);
    for (const f of state.data[zk + '_labels'].features) {
      const [x, y] = projectLngLat(f.geometry.coordinates);
      const color = f.properties.color;
      svg.push(`<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})">`
             + `<circle r="22" fill="#ffffff" fill-opacity="0.95" stroke="${color}" stroke-width="3"/>`
             + `<text text-anchor="middle" dominant-baseline="central" fill="#111">${f.properties._num}</text>`
             + `</g>`);
    }
    svg.push(`</g>`);
  }

  // 6) points stratégiques : étoile orange + nom encadré (toujours lisible)
  if (state.layers.landmarks) {
    svg.push(`<g id="landmarks">`);
    for (const f of state.data[lk].features) {
      const [x, y] = projectLngLat(f.geometry.coordinates);
      const name = f.properties.name;
      // étoile
      svg.push(`<path d="${starPath(x, y - 4, 14)}" fill="#ffb703" stroke="#1a1a1a" stroke-width="1.2"/>`);
      // étiquette : rectangle blanc + texte en deux lignes (numéro + nom)
      const padX = 6, padY = 3;
      const fontSize = 11;
      const approxW = name.length * 6.2 + padX * 2;
      const lblY = y + 16;
      svg.push(
        `<g transform="translate(${x.toFixed(2)},${lblY.toFixed(2)})">`
        + `<rect x="${(-approxW/2).toFixed(2)}" y="0" width="${approxW.toFixed(2)}" height="${(fontSize + padY*2).toFixed(2)}" `
        + `rx="4" ry="4" fill="#ffffff" stroke="#1a1a1a" stroke-width="0.6" fill-opacity="0.97"/>`
        + `<text x="0" y="${(fontSize + padY - 1).toFixed(2)}" text-anchor="middle" font-size="${fontSize}" font-weight="600" fill="#1a1a1a">`
        + `Z${f.properties._num} · ${escapeXml(name)}`
        + `</text>`
        + `</g>`);
    }
    svg.push(`</g>`);
  }

  svg.push(`</svg>`);

  const blob = new Blob([svg.join('\n')], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `zone5_${state.zoneset}_sous-zones.svg`);
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
  document.getElementById('exp-svg').onclick = exportSVG;
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
