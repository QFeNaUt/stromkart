// src/main.jsx — Vite-entry (steg 2: React-fundamentet)
// Importerer MapLibre-CSS-en (erstatter unpkg-<link>-en) og monterer
// React-treet i #root. Kart-bootstrapen (initApp) kjøres nå av
// <MapCanvas/> bak en StrictMode-vakt — legacy-løypen er uendret,
// bare flyttet inn bak escape-hatchen. Oversettelsen skjer herfra
// panel for panel; UI blir en funksjon av tilstand.

import 'maplibre-gl/dist/maplibre-gl.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
