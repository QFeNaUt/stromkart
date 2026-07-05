// js/interaction.js
// Interaksjonslag (steg 2.6): tynne dispatch-triggere — ingen bivirkninger.
// Hover-popupene eies nå av React (<MapPopups/>): innholdet er en ren
// funksjon av (hoveredFeature, currentIndex) og re-rendres automatisk
// under avspilling — det er dette som dreper frossen-popup-buggen.
// Klikk-handleren under gjør kun queryRenderedFeatures → dispatch('select').
// Alle bivirkninger som tidligere bodde her (highlight-filtre, sheet-
// state, DOM-skriving av sheet-tittel) er sentralisert i MapCanvas'
// selection-effekt og <SheetHeader/>-portalen. Tilbakeknappen bor fra
// steg 2.7 som ren onClick i <ReservoirPanel/> — initInteraction er
// pensjonert, og modulen eksporterer kun handleMapClick.
// Avhengighetsregel: importerer KUN map.js + bridge.js (ren JS, aldri .jsx).

import { map } from './map.js';
import { appDispatch } from './bridge.js';

// Klikk-håndtering (mobil + desktop)
export function handleMapClick(e) {
  // Defensiv filtrering: hvis brukeren tapper før alle lag er rendret,
  // unngå å sende lag-IDer som ikke finnes (MapLibre advarer / returnerer tomt).
  const candidateLayers = ['plants-layer', 'flows-hit', 'flows-arrow', 'flows-line', 'reservoirs-layer', 'zones-fill'];
  const layers = candidateLayers.filter(id => map.getLayer(id));
  if (!layers.length) return;
  const features = map.queryRenderedFeatures(e.point, { layers });

  // Tomt treff → fjern aktiv markering. Reduceren er no-op hvis ingenting
  // er valgt (ingen state-endring → ingen effekt-kjøring), se lærdomsnotat.
  if (!features.length) { appDispatch({ type: 'clearSelection' }); return; }

  const f = features[0], p = f.properties;
  if (f.layer.id === 'zones-fill')            appDispatch({ type: 'select', kind: 'zone',      props: p });
  else if (f.layer.id.startsWith('flows-'))   appDispatch({ type: 'select', kind: 'flow',      props: p });
  else if (f.layer.id === 'plants-layer')     appDispatch({ type: 'select', kind: 'plant',     props: p });
  else if (f.layer.id === 'reservoirs-layer') appDispatch({ type: 'select', kind: 'reservoir', props: p });
}
