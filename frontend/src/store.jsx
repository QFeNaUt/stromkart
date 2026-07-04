// src/store.jsx — AppState: useReducer + Context (arkitekturvalg B1)
// ---------------------------------------------------------
// Reduceren speiler klasse 1+2 fra js/state.js (15 felt) og eier i
// tillegg de fem React-nye feltene (selection, help, slider-play/-
// collapse) = 20 felt. Klasse 3 (zonesData, flowsData, flowsFlagsData,
// mapLoaded) blir VÆRENDE i det muterbare legacy-objektet — kun
// imperativ kartkode konsumerer dem (reducer-opsjon C, låst 04.07).
//
// Eierskaps-modellen (F3, låst 04.07):
//   - Reduceren er KILDEN for feltene i REACT_OWNED. Broen speiler dem
//     énveis React → legacy, så umigrert imperativ kode leser ferske
//     verdier uten å vite at React finnes.
//   - Felt UTENFOR REACT_OWNED eies fortsatt av legacy-skriverne
//     (f.eks. slider.js → currentIndex). Broen rører dem IKKE — ellers
//     ville en urelatert dispatch (helpOpen) overskrevet legacy-verdien
//     med reducerens utdaterte kopi. Det er driftfellen i praksis.
//   - Hvert felt bytter eier i ÉN commit: skrivingen blir dispatch,
//     og feltet legges til REACT_OWNED i samme diff. Aldri to aktive
//     kilder samtidig.
//
// Fundament-tilstand: REACT_OWNED er tom og reduceren kaster på alle
// actions — røyktestens beviskrav er null dispatches og piksel-identisk
// app. Actions defineres per komponent-commit, aldri på forskudd.
// ---------------------------------------------------------

import { createContext, useContext, useEffect, useReducer } from 'react';
import { state as legacyState } from './js/state.js';

// Felt reduceren eier. Vokser med én linje per migrert komponent-commit.
// Kun felt som OGSÅ finnes i legacy state.js trenger bro-speiling; de
// React-nye feltene (selection, helpOpen, ...) har ingen legacy-lesere.
export const REACT_OWNED = [];

export const initialState = {
  // --- Klasse 1: UI-tilstand (speiler js/state.js 1:1) ---
  spotPriceVisible: true,
  flowsVisible: true,
  reservoirsVisible: true,
  balanceVisible: true,
  plantsVisible: false,   // Kraftverk av som standard (69 markører — opt-in)

  selectedZone: null,     // aktiv sone i panel-konteksten ("NO_x")
  selectedView: null,     // 'balance' | 'reservoir' | null

  timeAxis: [],           // Date[] — kanonisk tidsakse (lengste sone-serie)
  currentIndex: 0,        // hvilken 15-min-slot som vises
  nowIndex: 0,            // hvor i timeAxis "nå" befinner seg
  userPinned: false,      // true når brukeren har dratt slideren bort fra "nå"

  // --- Klasse 2: datacacher som React-paneler leser ---
  todayPrices: {},
  reservoirsData: null,   // strippet til .areas (jf. datakontrakten)
  balanceData: null,      // FULL wrapper { zones, fetched_at, is_stale }
  flowsIsStale: false,

  // --- React-nye felt (fantes ikke i state.js) ---
  // Funn 2: sheet-tittel/desc var skjult tilstand i DOM-en. Nå deriveres
  // de av selection: { kind: 'zone'|'flow'|'plant'|'reservoir', props: {...} }
  selection: null,
  // Funn 4: help må kunne åpnes fra hele treet (badges i Controls/Legend/Sheet)
  helpOpen: false,
  helpFocusKey: null,
  // Funn 3: var modul-lokale i slider.js, men delt mellom begge instanser —
  // løftes hit for å bevare dagens synkroniserte oppførsel eksakt.
  isPlaying: false,
  sliderCollapsed: false,
};

export function reducer(state, action) {
  switch (action.type) {
    // Actions legges til her, én komponent-commit av gangen.
    default:
      // Fundamentet skal ikke dispatche noe som helst. En dispatch nå er
      // en feil i migreringsrekkefølgen — fail-fast, ikke stille ignorering.
      throw new Error(`Ukjent action i AppState-reducer: ${action.type}`);
  }
}

// ---------------------------------------------------------
// Dispatch-referanse for imperativ kode (F3, siste ledd)
// ---------------------------------------------------------
// interaction.js-handlerne lever i imperativ land i overgangsfasen, men
// skal kunne dispatche uten React-import. Provideren setter referansen
// ved mount. Kall før mount er en bootstrap-rekkefølgefeil → fail-fast.
export let appDispatch = () => {
  throw new Error('appDispatch kalt før AppStateProvider er montert');
};

// ---------------------------------------------------------
// Provider + hooks
// ---------------------------------------------------------
// To contexts (state / dispatch) er standardmønsteret: komponenter som
// kun dispatcher (toggles, knapper) re-rendres ikke når state endres.
const StateContext = createContext(null);
const DispatchContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Eksponer dispatch for imperativ kode. Idempotent og StrictMode-trygg:
  // dispatch-identiteten fra useReducer er stabil over hele livssyklusen.
  useEffect(() => {
    appDispatch = dispatch;
  }, [dispatch]);

  // Broen (F3): énveis React → legacy for felt reduceren eier. Kjøres
  // etter hver state-endring; assign er billig (håndfull nøkler).
  useEffect(() => {
    for (const key of REACT_OWNED) {
      legacyState[key] = state[key];
    }
  }, [state]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(StateContext);
  if (ctx === null) throw new Error('useAppState må brukes innenfor <AppStateProvider>');
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(DispatchContext);
  if (ctx === null) throw new Error('useAppDispatch må brukes innenfor <AppStateProvider>');
  return ctx;
}
