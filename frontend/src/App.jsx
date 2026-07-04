// src/App.jsx — rot-komponenten
// Eier app-livssyklusen: AppState-provider + datahenting/polling
// (mikrobeslutning A, låst 04.07). Komponent-treet vokser herfra i
// takt med migreringsrekkefølgen: HelpOverlay → PricesPanel →
// Controls → TimeSlider → sheet → balance/reservoir.

import { useEffect } from 'react';
import { AppStateProvider } from './store.jsx';
import { MapCanvas } from './components/MapCanvas.jsx';
import { HelpOverlay } from './components/HelpOverlay.jsx';
import { PricesPanel } from './components/PricesPanel.jsx';
import { loadData } from './js/main.js';

export function App() {
  // Polling flyttet hit fra initApp. Cleanup-funksjonen rydder intervallet
  // ved unmount — det fikser HMR-sårbarheten i dev (uten cleanup stables
  // intervaller ved hot reload) og gjør effekten StrictMode-korrekt.
  // Effekt-rekkefølge: barns effekter kjører før foreldres i React, så
  // MapCanvas' initApp() har alltid kjørt før første loadData() — samme
  // rekkefølge som dagens bootstrap.
  //
  // Forventet i dev-konsollen: StrictMode dobbeltkjører effekten
  // (mount → cleanup → mount), så to fetch-runder ved oppstart er normalt.
  // loadData er idempotent, og intervallet fra første runde ryddes.
  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <AppStateProvider>
      <MapCanvas />
      <HelpOverlay />
      <PricesPanel />
    </AppStateProvider>
  );
}
