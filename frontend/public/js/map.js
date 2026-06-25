// ---------------------------------------------------------
// map.js — MapLibre-instansen og kart-tilknyttede singletons
// ---------------------------------------------------------
// Leser den globale `maplibregl` (lastet som klassisk <script> i
// index.html) uten å importere den. Eksporterer KUN const-er, så
// ingen live-binding-/reassignment-problemer. mapLoaded ligger i
// state.js (muterbar, lest av flere lag).
//
// Tredje steg i ES-modul-migreringen.
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

// Gjenbrukte popup-instanser (hover-tooltip for sone og kraftflyt).
// Opprettes én gang; konsumeres av både hover-handlerne og toggle-
// handlerne, derfor på dette lave nivået begge kan importere fra.
export const zonePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
export const flowPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
