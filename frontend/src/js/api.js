// js/api.js
// Datalag: nettverkskall mot backend + initiell parsing og cache-skriv.
// Avhengighetsregel: importerer KUN nedover (API_BASE fra config, state).
// Ingen DOM, ingen render, ingen kart-/lag-import.

import { API_BASE } from './config.js';
import { state } from './state.js';
import { appDispatch } from './bridge.js';

// Robust fetch med per-request timeout (AbortController) og retry/backoff på
// transiente gateway-/tunnel-feil (502/504/530). Et hengende kall kappes nå av
// etter timeoutMs i stedet for å vente på nettleserens ~300s default — det er
// dette som hindrer at appen fryser på "Laster..." ved kald cache / ENTSO-E-treghet.
//
// Tak på ventetid pr. endepunkt: timeoutMs * (retries + 1) + backoffMs * retries.
// Med 12000 / 2 / 2000 => worst case ~40s for et fullstendig dødt endepunkt.
// Juster timeoutMs/retries her hvis du vil ha et strammere "Laster..."-tak.
//
// Ved oppbrukte forsøk KASTER funksjonen (i stedet for å returnere et bart
// fetch-kall), slik at allSettled-greinen i fetchOptional fanger feilen pr.
// endepunkt — og slik at fetchCore sin Promise.all feiler raskt på kjernefeil.
export async function fetchWithRetry(url, retries = 2, backoffMs = 2000, timeoutMs = 12000) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeoutId);
      // Retry kun på transiente gateway-/tunnel-feil, og kun hvis vi har forsøk igjen.
      if (!res.ok && [502, 504, 530].includes(res.status) && attempt < retries) {
        await new Promise(r => setTimeout(r, backoffMs)); continue;
      }
      return res; // ok, ikke-transient feil, eller siste forsøk
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt >= retries) throw err; // oppbrukt — la kalleren fange den
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
}

// Trekker ut JSON trygt: kun hvis kallet ble fulfilled OG svaret var ok.
// .json() pakkes i try/catch så en korrupt body gir null i stedet for å kaste.
// Delt helper for fetchOptional sine fire allSettled-resultater.
async function getJson(settled) {
  if (settled.status === 'fulfilled' && settled.value && settled.value.ok) {
    try { return await settled.value.json(); } catch { return null; }
  }
  return null;
}

// --- BØLGE 1: kjernekart -----------------------------------------------------
// Henter KUN de to harde kravene: zones (geometri) + prices/current (snapshot).
// Disse er ikke de laggy ENTSO-E-lagene, så kjernekartet kan males raskt og kan
// aldri lenger henge på et tregt valgfritt endepunkt — det venter ikke på dem.
//
// Promise.all (fail-fast): begge er obligatoriske, så hvis én feiler vil vi
// avbryte umiddelbart. Kaster da videre til loadData, som viser
// "Venter på nettverk..." og prøver på nytt ved neste poll-intervall.
export async function fetchCore() {
  const [zonesRes, pricesRes] = await Promise.all([
    fetchWithRetry(`${API_BASE}/api/zones/`),
    fetchWithRetry(`${API_BASE}/api/prices/current`),
  ]);

  // fetchWithRetry kan returnere en ikke-ok respons (ikke-transient feil / siste
  // forsøk) i stedet for å kaste — derfor sjekker vi .ok eksplisitt her også.
  if (!zonesRes?.ok) throw new Error(`/api/zones failed`);
  if (!pricesRes?.ok) throw new Error(`/api/prices/current failed`);

  const zones = await zonesRes.json();
  const prices = await pricesRes.json();
  return { zones, prices };
}

// --- BØLGE 2: valgfrie lag ---------------------------------------------------
// Henter de fire valgfrie lagene (today, flows, reservoirs, balance) med
// Promise.allSettled, slik at ETT tregt/dødt endepunkt ikke blokkerer de andre.
// Kjøres uten å blokkere kjernekartet — loadData kaller den med .then().
//
// Skriver de kryssgående cachene (todayPrices/reservoirsData/balanceData) direkte
// til state — de leses senere av render-/panel-laget. Returnerer flows, som
// loadData konsumerer lokalt via renderFlows. Hvert lag degraderer grasiøst til
// {} / null hvis det timer ut eller feiler.
export async function fetchOptional() {
  const results = await Promise.allSettled([
    fetchWithRetry(`${API_BASE}/api/prices/today`),
    fetchWithRetry(`${API_BASE}/api/flows/current`),
    fetchWithRetry(`${API_BASE}/api/reservoirs/current`),
    fetchWithRetry(`${API_BASE}/api/balance/current`),
  ]);

  state.todayPrices = (await getJson(results[0])) || {};
  const flows = await getJson(results[1]);

  const resData = await getJson(results[2]);
  state.reservoirsData = resData ? resData.areas : null;
  // Dual-skriv i overgangen (P1, steg 2.3): legacy-skrivingen over betjener
  // synkrone lesere (addOverlays-stien samme tick — broen er for treg for dem);
  // kopien under driver React-re-render (PricesPanel-subprisen). Én skriver
  // (denne), to lagre. Legacy-skrivingen fjernes når reservoir-laget migrerer.
  appDispatch({ type: 'setReservoirs', reservoirs: state.reservoirsData });

  state.balanceData = await getJson(results[3]);

  return { flows };
}
