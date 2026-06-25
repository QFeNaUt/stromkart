// js/api.js
// Datalag: nettverkskall mot backend + initiell parsing og cache-skriv.
// Avhengighetsregel: importerer KUN nedover (API_BASE fra config, state).
// Ingen DOM, ingen render, ingen kart-/lag-import.

import { API_BASE } from './config.js';
import { state } from './state.js';

// Robust fetch med retry og backoff på transiente gateway-/tunnel-feil (502/504/530).
// Andre statuskoder returneres som de er; nettverks-exceptions venter og prøver igjen.
export async function fetchWithRetry(url, retries = 3, backoffMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if ([502, 504, 530].includes(res.status)) {
        await new Promise(r => setTimeout(r, backoffMs)); continue;
      }
      return res;
    } catch (err) { await new Promise(r => setTimeout(r, backoffMs)); }
  }
  return fetch(url);
}

// Henter alle seks endepunkter parallelt, parser, og skriver de kryssgående
// cachene (todayPrices/reservoirsData/balanceData) direkte til state — de leses
// senere av render-/panel-laget. Returnerer de tre umiddelbart konsumerte settene
// (zones/prices/flows) som loadData avleder fra lokalt i samme tick.
//
// Kaster ved manglende zones/prices (loadData fanger og viser "Venter på nettverk...").
export async function fetchAll() {
  const [zonesRes, pricesRes, todayRes, flowsRes, reservoirsRes, balanceRes] = await Promise.all([
    fetchWithRetry(`${API_BASE}/api/zones/`), fetchWithRetry(`${API_BASE}/api/prices/current`),
    fetchWithRetry(`${API_BASE}/api/prices/today`), fetchWithRetry(`${API_BASE}/api/flows/current`),
    fetchWithRetry(`${API_BASE}/api/reservoirs/current`),
    fetchWithRetry(`${API_BASE}/api/balance/current`),
  ]);

  if (!zonesRes.ok) throw new Error(`/api/zones failed`);
  if (!pricesRes.ok) throw new Error(`/api/prices/current failed`);

  const zones = await zonesRes.json();
  const prices = await pricesRes.json();
  state.todayPrices = todayRes.ok ? await todayRes.json() : {};
  const flows = flowsRes.ok ? await flowsRes.json() : null;
  state.reservoirsData = reservoirsRes.ok ? (await reservoirsRes.json()).areas : null;
  state.balanceData = balanceRes.ok ? await balanceRes.json() : null;

  return { zones, prices, flows };
}
