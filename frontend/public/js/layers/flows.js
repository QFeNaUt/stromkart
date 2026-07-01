import { map } from '../map.js';
import { state } from '../state.js';
import { FLOW_COLORS, FLOW_WIDTH, FLOW_OPACITY, FLOW_OPACITY_STALE, FLOW_HIT_WIDTH } from '../config.js';

export function buildFlowGeoJSON(payload) {
  if (!payload || !payload.edges) return { type: 'FeatureCollection', features: [] };
  const isNorwegian = (z) => z && z.startsWith('NO_');
  const features = [];
  for (const e of payload.edges) {
    if (!e.from_point || !e.to_point) continue;
    let direction = 'internal';
    if (e.kind !== 'internal') {
      if (isNorwegian(e.from) && !isNorwegian(e.to)) direction = 'export';
      else if (!isNorwegian(e.from) && isNorwegian(e.to)) direction = 'import';
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [e.from_point, ...(Array.isArray(e.via_points) ? e.via_points : []), e.to_point] },
      properties: { id: e.id, from: e.from, to: e.to, mw: e.mw, kind: e.kind, cable: e.cable, direction, timestamp: e.timestamp },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function buildFlagGeoJSON(payload) {
  if (!payload || !payload.edges) return { type: 'FeatureCollection', features: [] };
  const isNorwegian = (z) => z && z.startsWith('NO_');
  const features = [];
  for (const e of payload.edges) {
    if (e.kind !== 'external' || !e.from_point || !e.to_point) continue;
    let foreignZone = !isNorwegian(e.from) ? e.from : (!isNorwegian(e.to) ? e.to : null);
    let foreignPoint = !isNorwegian(e.from) ? e.from_point : (!isNorwegian(e.to) ? e.to_point : null);
    if (!foreignZone) continue;
    const countryCode = foreignZone.split('_')[0];
    if (!['SE', 'FI', 'DK', 'DE', 'NL', 'GB'].includes(countryCode)) continue;
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: foreignPoint },
      properties: { country: countryCode, cable: e.cable || '' },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function renderFlows(payload) {
  state.flowsIsStale = payload?.is_stale === true;
  state.flowsData = buildFlowGeoJSON(payload);
  state.flowsFlagsData = buildFlagGeoJSON(payload);
  if (state.mapLoaded) addFlowLayers();
}

export function addFlowLayers() {
  if (!state.flowsData) return;
  const src = map.getSource('flows');
  if (src) src.setData(state.flowsData); else map.addSource('flows', { type: 'geojson', data: state.flowsData });

  const beforeId = map.getLayer('cities-dot') ? 'cities-dot' : undefined;

  if (!map.getLayer('flows-highlight')) {
    map.addLayer({
      id: 'flows-highlight', type: 'line', source: 'flows',
      filter: ['==', ['get', 'id'], ''],
      paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.8 }
    }, beforeId);
  }

  if (!map.getLayer('flows-line')) map.addLayer({ id: 'flows-line', type: 'line', source: 'flows', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'direction'], 'export', FLOW_COLORS.export, 'import', FLOW_COLORS.import, 'internal', FLOW_COLORS.internal, FLOW_COLORS.internal], 'line-width': FLOW_WIDTH } }, beforeId);
  if (!map.getLayer('flows-arrow')) map.addLayer({ id: 'flows-arrow', type: 'symbol', source: 'flows', layout: { 'symbol-placement': 'line-center', 'icon-image': 'flow-arrow', 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['coalesce', ['get', 'mw'], 0], 0, 0.55, 400, 0.85, 1400, 1.20] } }, beforeId);

  // Usynlig treff-lag med konstant bredde — ligger øverst i flyt-stabelen så
  // også lavt lastede (tynne) kabler er lette å treffe. line-opacity: 0 er
  // fortsatt hit-testbar i MapLibre (til forskjell fra visibility: none).
  // Hover-/klikk-handlerne peker mot dette laget i stedet for det tynne flows-line.
  if (!map.getLayer('flows-hit')) map.addLayer({ id: 'flows-hit', type: 'line', source: 'flows', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': FLOW_HIT_WIDTH } }, beforeId);

  const lineOpacity = state.flowsIsStale ? FLOW_OPACITY_STALE : FLOW_OPACITY;
  map.setPaintProperty('flows-line', 'line-opacity', lineOpacity);
  map.setPaintProperty('flows-arrow', 'icon-opacity', lineOpacity);

  if (state.flowsFlagsData) {
    const flagSrc = map.getSource('flows-flags');
    if (flagSrc) flagSrc.setData(state.flowsFlagsData); else map.addSource('flows-flags', { type: 'geojson', data: state.flowsFlagsData });
    if (!map.getLayer('flows-flags-layer')) map.addLayer({ id: 'flows-flags-layer', type: 'symbol', source: 'flows-flags', layout: { 'icon-image': ['concat', 'flag-', ['get', 'country']], 'icon-size': 1, 'icon-offset': [0, -14], 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, beforeId);
  }
}
