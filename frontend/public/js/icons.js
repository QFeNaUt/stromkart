// ---------------------------------------------------------
// icons.js — canvas-genererte kart-ikoner
// ---------------------------------------------------------
// Rene funksjoner: input inn, ImageData ut. Ingen avhengighet
// til kart-instansen eller delt tilstand. Registrering via
// map.addImage(...) skjer i main.js / oppstartskoden, ikke her.
//
// Første modul i ES-modul-migreringen (pilot). Brukes til å
// bekrefte at Cloudflare Pages serverer moduler riktig før
// resten av index.html splittes opp.
// ---------------------------------------------------------

// Pilhode for kraftflyt-laget. Hvit pil med mørk halo for
// kontrast over alle linjefarger. Font-uavhengig — CARTOs
// glyph-server mangler både ▶ (U+25B6) og → (U+2192).
export function createArrowIcon(size = 28) {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1117'; ctx.beginPath(); ctx.moveTo(size*0.1, size*0.2); ctx.lineTo(size*0.95, size*0.5); ctx.lineTo(size*0.1, size*0.8); ctx.lineTo(size*0.28, size*0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(size*0.18, size*0.28); ctx.lineTo(size*0.85, size*0.5); ctx.lineTo(size*0.18, size*0.72); ctx.lineTo(size*0.34, size*0.5); ctx.closePath(); ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

// Landflagg ved utenlandske endepunkter på kraftflyt-laget.
// 24×18 px med 1px mørk halo. GB er en abstrahert Union Jack
// (fullskala heraldikk umulig på 22×16 px).
export function createFlagIcon(country) {
  const W = 24, H = 18; const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(1, 1);
  if (country === 'SE') { ctx.fillStyle = '#004B87'; ctx.fillRect(0, 0, 22, 16); ctx.fillStyle = '#FFCD00'; ctx.fillRect(7, 0, 3, 16); ctx.fillRect(0, 6, 22, 3); }
  else if (country === 'FI') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 22, 16); ctx.fillStyle = '#002F6C'; ctx.fillRect(7, 0, 3, 16); ctx.fillRect(0, 6, 22, 3); }
  else if (country === 'DK') { ctx.fillStyle = '#C60C30'; ctx.fillRect(0, 0, 22, 16); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(7, 0, 3, 16); ctx.fillRect(0, 6, 22, 3); }
  else if (country === 'DE') { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 22, 5); ctx.fillStyle = '#DD0000'; ctx.fillRect(0, 5, 22, 6); ctx.fillStyle = '#FFCE00'; ctx.fillRect(0, 11, 22, 5); }
  else if (country === 'NL') { ctx.fillStyle = '#AE1C28'; ctx.fillRect(0, 0, 22, 5); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 5, 22, 6); ctx.fillStyle = '#21468B'; ctx.fillRect(0, 11, 22, 5); }
  else if (country === 'GB') {
    ctx.fillStyle = '#012169'; ctx.fillRect(0, 0, 22, 16);
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(22,16); ctx.moveTo(22,0); ctx.lineTo(0,16); ctx.stroke();
    ctx.strokeStyle = '#C8102E'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(22,16); ctx.moveTo(22,0); ctx.lineTo(0,16); ctx.stroke();
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(8, 0, 6, 16); ctx.fillRect(0, 5, 22, 6);
    ctx.fillStyle = '#C8102E'; ctx.fillRect(9, 0, 4, 16); ctx.fillRect(0, 6, 22, 4);
  }
  ctx.restore(); return ctx.getImageData(0, 0, W, H);
}

// Batteri-ikon for magasinfylling. 24×32 px, ensfarget
// vannblå (#3b82f6) med mørk halo og batteri-nubbin på toppen.
// Bevisst INGEN fargekoding etter nivå (rød/gul/grønn):
// magasinfylling er sterkt sesongavhengig, så faste terskler
// ville vært faglig misvisende. Høyden alene formidler tilstanden.
export function createBatteryIcon(fillPercent) {
  const W = 24, H = 32; const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const pct = Math.max(0, Math.min(100, Number(fillPercent) || 0));
  const NUB_W = 6, NUB_H = 3, BODY_X = 2, BODY_Y = NUB_H, BODY_W = 20, BODY_H = 27, FILL_PAD = 2;
  ctx.fillStyle = '#0d1117'; ctx.fillRect((W - NUB_W)/2 - 1, 0, NUB_W + 2, NUB_H + 1);
  ctx.fillStyle = '#e5e7eb'; ctx.fillRect((W - NUB_W)/2, 0, NUB_W, NUB_H);
  ctx.fillStyle = '#0d1117'; ctx.fillRect(BODY_X - 1, BODY_Y, BODY_W + 2, BODY_H + 1);
  ctx.fillStyle = '#e5e7eb'; ctx.fillRect(BODY_X, BODY_Y, BODY_W, BODY_H);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(BODY_X + FILL_PAD, BODY_Y + FILL_PAD, BODY_W - 2*FILL_PAD, BODY_H - 2*FILL_PAD);
  const fillH = Math.round((BODY_H - 2*FILL_PAD) * pct / 100);
  if (fillH > 0) {
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(BODY_X + FILL_PAD, BODY_Y + FILL_PAD + (BODY_H - 2*FILL_PAD) - fillH, BODY_W - 2*FILL_PAD, fillH);
  }
  return ctx.getImageData(0, 0, W, H);
}
