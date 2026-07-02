// src/main.jsx — Vite-entry (steg 1: ren shim, ingen React ennå)
// Importerer MapLibre-CSS-en (erstatter unpkg-<link>-en) og starter appen
// nøyaktig som det gamle inline-scriptet gjorde. React-oversettelsen
// (steg 2+) skjer her senere, panel for panel.

import 'maplibre-gl/dist/maplibre-gl.css';
import { initApp } from './js/main.js';

initApp();
