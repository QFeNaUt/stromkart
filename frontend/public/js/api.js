// js/api.js
// Datalag: nettverkskall mot backend + initiell parsing og cache-skriv.
// Avhengighetsregel: importerer KUN nedover (API_BASE fra config, state).
// Ingen DOM, ingen render, ingen kart-/lag-import.

import { API_BASE } from './config.js';
import { state } from './state.js';

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
// fetch-kall), slik at fetchAll sin Promise.allSettled fanger feilen pr. endepunkt.
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
      if (attempt >= retries) throw err; // oppbrukt — la allSettled fange den
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
}

// Henter alle seks endepunkter parallelt med Promise.allSettled, slik at ETT
// tregt/dødt endepunkt ikke lenger blokkerer hele kartet fra å laste (var
// Promise.all, som ventet på at alle seks skulle settle).
//
// Skriver de kryssgående cachene (todayPrices/reservoirsData/balanceData) direkte
// til state — de leses senere av render-/panel-laget. Returnerer de tre umiddelbart
// konsumerte settene (zones/prices/flows) som loadData avleder fra lokalt.
//
// Kjernelagene (zones + prices/current) er harde krav: mangler de, kaster vi, og
// loadData fanger og viser "Venter på nettverk...". De fire valgfrie lagene
// degraderer grasiøst til {} / null hvis de timer ut eller feiler.
export async function fetchAll() {
  const results = await Promise.allSettled([
    fetchWithRetry(`${API_BASE}/api/zones/`),
    fetchWithRetry(`${API_BASE}/api/prices/current`),
    fetchWithRetry(`${API_BASE}/api/prices/today`),
    fetchWithRetry(`${API_BASE}/api/flows/current`),
    fetchWithRetry(`${API_BASE}/api/reservoirs/current`),
    fetchWithRetry(`${API_BASE}/api/balance/current`),
  ]);

  // Trekker ut JSON trygt: kun hvis kallet ble fulfilled OG svaret var ok.
  // .json() pakkes i try/catch så en korrupt body gir null i stedet for å kaste.
  const getJson = async (settled) => {
    if (settled.status === 'fulfilled' && settled.value && settled.value.ok) {
      try { return await settled.value.json(); } catch { return null; }
    }
    return null;
  };

  const zonesRes = results[0].status === 'fulfilled' ? results[0].value : null;
  const pricesRes = results[1].status === 'fulfilled' ? results[1].value : null;

  // Kjernelagene må fungere — ellers avbryter vi, og loadData viser feilmelding.
  if (!zonesRes?.ok) throw new Error(`/api/zones failed`);
  if (!pricesRes?.ok) throw new Error(`/api/prices/current failed`);

  const zones = await zonesRes.json();
  const prices = await pricesRes.json();

  // Valgfrie lag: fyll hvis de kom gjennom, ellers tomme fallbacks.
  state.todayPrices = (await getJson(results[2])) || {};
  const flows = await getJson(results[3]);

  const resData = await getJson(results[4]);
  state.reservoirsData = resData ? resData.areas : null;

  state.balanceData = await getJson(results[5]);

  return { zones, prices, flows };
}
