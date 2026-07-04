// src/store.jsx — AppState: useReducer + Context (arkitekturvalg B1)
// ---------------------------------------------------------
// Reduceren speiler klasse 1+2 fra js/state.js (15 felt), eier de fem
// React-nye feltene (selection, help, slider-play/-collapse), pluss
// snapshot-stillaset priceSnapshot (midlertidig, P1/B) = 21 felt. Klasse 3 (zonesData, flowsData, flowsFlagsData,
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
// REACT_OWNED er fortsatt tom — ingen migrerte felt har legacy-lesere
// (helpOpen/helpFocusKey fantes aldri i state.js). Actions defineres per
// komponent-commit, aldri på forskudd; først ut: openHelp/closeHelp (2.2).
// ---------------------------------------------------------

import { createContext, useContext, useEffect, useReducer } from 'react';
import { state as legacyState } from './js/state.js';
import { setAppDispatch } from './js/bridge.js';

// Felt reduceren eier. Vokser med én linje per migrert komponent-commit.
// Kun felt som OGSÅ finnes i legacy state.js trenger speiling; de
// React-nye feltene (selection, helpOpen, ...) har ingen legacy-lesere.
export const REACT_OWNED = [
  // Controls (steg 2.4) — synlighetsflaggene. Eneste tidligere skriver
  // (bindToggle) er pensjonert; legacy-lesere (updateOverlayVisibility,
  // panel-/lag-modulene) betjenes av det synkrone speilet i reduceren.
  'spotPriceVisible',
  'flowsVisible',
  'reservoirsVisible',
  'balanceVisible',
  'plantsVisible',
];

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

  // MIDLERTIDIG STILLAS (P1/B, låst 04.07): ferdig-derivert prissnapshot
  // { NO1..NO5: { price_ore_kwh, price_eur_mwh, timestamp } } | null.
  // Dispatches av de to legacy-beregningsstedene (renderPriceLayer i
  // main.js, renderAtIndex i slider.js). SLETTES når TimeSlider-migreringen
  // gir React eierskap til todayPrices/currentIndex og PricesPanel kan
  // derivere selv.
  priceSnapshot: null,

  // --- React-nye felt (fantes ikke i state.js) ---
  // Funn 2: sheet-tittel/desc var skjult tilstand i DOM-en. Nå deriveres
  // de av selection: { kind: 'zone'|'flow'|'plant'|'reservoir', props: {...} }
  selection: null,
  // Funn 4: help må kunne åpnes fra hele treet (badges i Controls/Legend/Sheet).
  // helpFocusKey: null | { key, ts } — ts settes av dispatch-stedet (Date.now()),
  // så to klikk på samme begrep gir nytt objekt og flash/scroll-effekten
  // re-kjører (tro mot dagens re-flash-oppførsel). Reduceren forblir ren.
  helpOpen: false,
  helpFocusKey: null,
  // Funn 3: var modul-lokale i slider.js, men delt mellom begge instanser —
  // løftes hit for å bevare dagens synkroniserte oppførsel eksakt.
  isPlaying: false,
  sliderCollapsed: false,
};

// Engangs-speiling ved modul-last: legacy-defaults og initialState er
// definert identisk, men invarianten skal ikke hvile på disiplin alene.
for (const key of REACT_OWNED) legacyState[key] = initialState[key];

// ---------------------------------------------------------
// Reducer med synkront legacy-speil (revidert C1, låst 04.07)
// ---------------------------------------------------------
// Speilingen skjer HER — ikke i en effekt — fordi effekter kjører etter
// paint: en MapLibre-hendelse i vinduet mellom commit og effekt-flush
// ville lest utdatert speil. transition() er den rene tilstandsmaskinen;
// reducer() er bevisst «uren» på ett kontrollert punkt: den skriver
// REACT_OWNED-feltene til legacy-objektet før retur. Trygt fordi
// tilordningen er idempotent (StrictModes dobbeltkjøring er ufarlig) og
// React kjører reduceren med korrekt prev-state også ved batchede
// dispatches — speilet konvergerer alltid til sluttilstanden.
export function reducer(state, action) {
  const next = transition(state, action);
  if (next !== state) {
    for (const key of REACT_OWNED) legacyState[key] = next[key];
  }
  return next;
}

function transition(state, action) {
  switch (action.type) {
    // --- HelpOverlay (steg 2.2) ---
    case 'openHelp':
      // focusKey (valgfri): begrep som skal åpnes + flashes i ordlista.
      // ts kommer fra dispatch-stedet — se helpFocusKey-noten i initialState.
      return {
        ...state,
        helpOpen: true,
        helpFocusKey: action.focusKey ? { key: action.focusKey, ts: action.ts ?? 0 } : null,
      };
    case 'closeHelp':
      return { ...state, helpOpen: false };

    // --- Controls (steg 2.4) ---
    case 'setLayerVisible': {
      // Whitelist: lag-navnene i dispatch-kallene er kompileringstids-
      // konstanter — et ukjent navn er en programmeringsfeil og skal dø
      // i første røyktest, ikke overleve som en stille død toggle.
      const ALLOWED = ['spotPriceVisible', 'flowsVisible', 'reservoirsVisible', 'balanceVisible', 'plantsVisible'];
      if (!ALLOWED.includes(action.field)) {
        throw new Error(`setLayerVisible: ukjent lag-felt '${action.field}'`);
      }
      return { ...state, [action.field]: action.visible };
    }

    // --- PricesPanel (steg 2.3) ---
    case 'setPriceSnapshot':
      // Snapshot-stillaset — se initialState-noten. Legacy beregner,
      // reduceren lagrer kun.
      return { ...state, priceSnapshot: action.snapshot };
    case 'setReservoirs':
      // Dual-skriv-kopi fra api.js: legacy-lageret er fortsatt kilden for
      // synkrone lesere (addOverlays-stien samme tick); denne kopien driver
      // React-re-render (magasin-subprisen). Feltet skal IKKE i REACT_OWNED —
      // broen må ikke speile den tilbake over legacy-skriverens verdi.
      return { ...state, reservoirsData: action.reservoirs };

    default:
      // Ukjent action er en feil i migreringsrekkefølgen — fail-fast,
      // ikke stille ignorering.
      throw new Error(`Ukjent action i AppState-reducer: ${action.type}`);
  }
}

// ---------------------------------------------------------
// Dispatch-broen (F3, siste ledd) bor i src/js/bridge.js (ren JS):
// legacy-moduler importerer appDispatch derfra og rører aldri .jsx.
// Provideren setter referansen ved mount via setAppDispatch (under).
// ---------------------------------------------------------

// ---------------------------------------------------------
// Provider + hooks
// ---------------------------------------------------------
// To contexts (state / dispatch) er standardmønsteret: komponenter som
// kun dispatcher (toggles, knapper) re-rendres ikke når state endres.
const StateContext = createContext(null);
const DispatchContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Eksponer dispatch for imperativ kode via broen. Idempotent og
  // StrictMode-trygg: dispatch-identiteten fra useReducer er stabil.
  useEffect(() => {
    setAppDispatch(dispatch);
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
