import { map } from '../map.js';
import { state } from '../state.js';
import { ZONE_CENTROIDS } from '../config.js';

export function addReservoirLayer() {
  if (!state.reservoirsData) return;
  const features = [];
  for (const [zoneCode, info] of Object.entries(state.reservoirsData)) {
    const coords = ZONE_CENTROIDS[zoneCode];
    if (!coords || info.fill_percent == null) continue;
    const bucket = Math.round(info.fill_percent / 5) * 5;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { zone: zoneCode, fill_percent: info.fill_percent, bucket, icon: `battery-${bucket}` } });
  }
  const geojson = { type: 'FeatureCollection', features };
  
  const src = map.getSource('reservoirs');
  if (src) src.setData(geojson); else map.addSource('reservoirs', { type: 'geojson', data: geojson });
  const beforeId = map.getLayer('cities-dot') ? 'cities-dot' : undefined;
  if (!map.getLayer('reservoirs-layer')) map.addLayer({ id: 'reservoirs-layer', type: 'symbol', source: 'reservoirs', layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, beforeId);
}

// renderReservoirSection er pensjonert (steg 2.7): panelet eies av
// <ReservoirPanel/> (src/components/ReservoirPanel.jsx). Denne modulen
// beholder kun addReservoirLayer — imperativ kartkode som skal FORBLI (A2).
