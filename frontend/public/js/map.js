// ---------------------------------------------------------
// map.js — MapLibre-instansen og kart-tilknyttede singletons
// ---------------------------------------------------------

export const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [12.5, 64.5],
  zoom: 3.8,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

export const zonePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
export const flowPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
export const plantPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });