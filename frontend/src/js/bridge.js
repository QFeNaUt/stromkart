// ---------------------------------------------------------
// js/bridge.js — dispatch-broen fra legacy til React (F3, siste ledd)
// ---------------------------------------------------------
// Ren JS, null React-import: legacy-moduler (main.js, slider.js, api.js,
// interaction.js) importerer appDispatch HERFRA og rører aldri .jsx —
// lagdelingsregelen «legacy importerer aldri React-land» holder dermed
// hele overgangsfasen.
//
// Provideren i src/store.jsx setter referansen ved mount (setAppDispatch).
// Boot-rekkefølgen garanterer at den er satt før første dispatch:
//   1) Reacts effekter kjører bunn-opp — providerens effekt (setAppDispatch)
//      kjører FØR App-effekten som starter loadData.
//   2) Alle dispatch-steder ligger uansett bak et await på nettverk
//      (fetchCore/fetchOptional) eller bak brukerinteraksjon (slider).
// Skulle begge garantiene ryke: fail-fast-initialverdien under kaster
// høylytt i stedet for å stille sluke actionen.
// ---------------------------------------------------------

let dispatchRef = (action) => {
  throw new Error(`appDispatch kalt før AppStateProvider er montert (action: ${action && action.type})`);
};

// Kalles kun av AppStateProvider (store.jsx) ved mount.
export function setAppDispatch(fn) {
  dispatchRef = fn;
}

// Importeres av legacy-moduler. Wrapper-funksjon (ikke re-eksportert let)
// så kallstedene alltid treffer gjeldende referanse.
export function appDispatch(action) {
  return dispatchRef(action);
}
