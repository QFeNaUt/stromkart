// js/layers/plants.js
// Kraftverk-laget: de største vann- og vindkraftverkene som ikon-markører.
// Avhengighetsregel: importerer KUN nedover (map + plants-data). Hover/klikk
// håndteres i interaction.js; orkestratoren (main.js) kaller addPlantsLayer()
// i addOverlays. Ikonene (plant-magasin/elv/vind) lastes fra /img/ ved behov.

import { map } from '../map.js';
import { POWER_PLANTS } from '../plants-data.js';

// PNG-markørene (256 px-kilder, forminskes via icon-size). Ligger i
// frontend/public/img/ → tilgjengelig på /img/... i både lokal dev og Pages.
const PLANT_ICONS = [
  ['plant-magasin', '/img/plant-magasin.png'],
  ['plant-elv',     '/img/plant-elv.png'],
  ['plant-vind',    '/img/plant-vind.png'],
];

// --- Størrelse: areal ∝ MW  ⇒  radius ∝ √MW -------------------------------
// icon-size skalerer 256 px-kilden. Vi mapper √MW lineært fra datasettets
// min/max til [MIN_SIZE, MAX_SIZE], så det største anlegget blir størst uten
// å dominere. Forhåndsregnet i JS (enklere enn et MapLibre-uttrykk), og trygt
// fordi POWER_PLANTS er statisk.
const MIN_SIZE = 0.095;   // ~24 px (minste, ~112 MW)
const MAX_SIZE = 0.18;    // ~46 px (Kvilldal, 1240 MW)
const _sqrts = POWER_PLANTS.map(p => Math.sqrt(p.mw));
const _sMin = Math.min(..._sqrts);
const _sMax = Math.max(..._sqrts);
function sizeFor(mw) {
  const t = (Math.sqrt(mw) - _sMin) / ((_sMax - _sMin) || 1);
  return +(MIN_SIZE + t * (MAX_SIZE - MIN_SIZE)).toFixed(4);
}

// GeoJSON bygges én gang (statiske data). iconSize/sortKey forhåndsregnes:
// sortKey = −MW gjør at største anlegg vinner kollisjonstesten (symbol-sort-key
// plasserer laveste verdi først), så oversikten viser de største, og de mindre
// folder seg ut med zoom. members flates til én streng (MapLibre-properties
// tar ikke arrays).
const PLANTS_GEOJSON = {
  type: 'FeatureCollection',
  features: POWER_PLANTS.map(p => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: p.coord },
    properties: {
      id: p.id, name: p.name, type: p.type,
      mw: p.mw, gwh: p.gwh, zone: p.zone,
      owner: p.owner, municipality: p.municipality,
      members: p.members ? p.members.join(' + ') : null,
      icon: `plant-${p.type}`,
      iconSize: sizeFor(p.mw),
      sortKey: -p.mw,
    },
  })),
};

// Laster de tre PNG-ene inn i kartet (idempotent via hasImage-vakt). Async:
// når addImage kjører, repainter MapLibre og ikonene dukker opp — vi trenger
// derfor ikke å await her, laget kan legges før bildene er ferdig lastet.
async function ensurePlantImages() {
  for (const [id, url] of PLANT_ICONS) {
    if (map.hasImage(id)) continue;
    try {
      const img = await map.loadImage(url);
      // MapLibre 4 returnerer { data }, men vær defensiv mot begge former.
      if (!map.hasImage(id)) map.addImage(id, img.data ?? img);
    } catch (e) {
      console.error(`Kunne ikke laste kraftverk-ikon ${url}:`, e);
    }
  }
}

export function addPlantsLayer() {
  ensurePlantImages();   // fire-and-forget; repaint når bildene er inne

  const src = map.getSource('plants');
  if (src) src.setData(PLANTS_GEOJSON);
  else map.addSource('plants', { type: 'geojson', data: PLANTS_GEOJSON });

  if (!map.getLayer('plants-layer')) {
    map.addLayer({
      id: 'plants-layer', type: 'symbol', source: 'plants',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['get', 'iconSize'],
        'icon-allow-overlap': false,          // kollisjon aktiv → ren oversikt
        'icon-ignore-placement': false,
        'symbol-sort-key': ['get', 'sortKey'], // størst MW vinner kollisjonen
        // Navn vises først fra zoom 6.5; ikonet vises alltid (text-optional).
        'text-field': ['step', ['zoom'], '', 6.5, ['get', 'name']],
        'text-font': ['Open Sans Semibold', 'Open Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': '#e6edf3',
        'text-halo-color': '#0d1117',
        'text-halo-width': 1.4,
      },
    });
  }
}
