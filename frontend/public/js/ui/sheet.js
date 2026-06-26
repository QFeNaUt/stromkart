// ---------------------------------------------------------
// ui/sheet.js — Bunnsheet (mobil)
// ---------------------------------------------------------
// "Dum" UI-komponent: eier kun sin egen drag-/snap-tilstand og DOM.
// Vet ingenting om kartlogikk. Varsler oppover via injisert onPeek-
// callback når brukeren drar sheetet helt ned (dismiss). Det bryter
// sheet↔interaksjon-sykelen (jf. arkitekturbeslutning 24.06):
// orkestratoren injiserer clearMobileSelection som onPeek, og sheeten
// importerer den aldri selv.
//
// Null import fra config/map/state — ren DOM + modul-lokal tilstand.
// ---------------------------------------------------------

const sheet = document.getElementById('bottom-sheet');
const dragZone = document.getElementById('sheet-drag-zone');

// Modul-lokal tilstand (kryssgår ikke — blir her, ikke i state.js)
let sheetSnapPoints = { peek: 0, half: 0, full: 0 };
let currentSheetState = 'peek';
let isDragging = false;
let startY = 0;
let startTransformY = 0;

export function initSheetGeometry() {
  if (window.innerWidth > 768) return;
  const h = sheet.getBoundingClientRect().height; // 90dvh
  sheetSnapPoints = {
    peek: h - 85, // Viser akkurat context-header
    half: h * 0.5,
    full: 0
  };
  setSheetState(currentSheetState, false);
}

export function setSheetState(state, animate = true) {
  if (window.innerWidth > 768) return;
  currentSheetState = state;
  sheet.style.transition = animate ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
  sheet.style.transform = `translateY(${sheetSnapPoints[state]}px)`;

  // Skjul mobil-slider ved 'full' (kartet er ikke synlig — slideren har ikke mening da).
  // Løs DOM-kobling (getElementById + classList), bevisst ingen import av slider.js.
  const mobileSlider = document.getElementById('time-slider-mobile');
  if (mobileSlider) mobileSlider.classList.toggle('full-hidden', state === 'full');
}

// Oppstart: fester lyttere + geometri-init. Orkestratoren (senere main.js)
// kaller denne én gang og injiserer onPeek for dismiss-gesten.
export function initSheet({ onPeek } = {}) {
  window.addEventListener('resize', initSheetGeometry);
  setTimeout(initSheetGeometry, 100);

  dragZone.addEventListener('touchstart', e => {
    isDragging = true;
    startY = e.touches[0].clientY;
    const matrix = new DOMMatrix(getComputedStyle(sheet).transform);
    startTransformY = matrix.m42;
    sheet.style.transition = 'none';
  }, {passive: true});

  dragZone.addEventListener('touchmove', e => {
    if (!isDragging) return;
    const dy = e.touches[0].clientY - startY;
    let newY = startTransformY + dy;
    if (newY < 0) newY = 0;
    if (newY > sheetSnapPoints.peek) newY = sheetSnapPoints.peek;
    sheet.style.transform = `translateY(${newY}px)`;
  }, {passive: true});

  dragZone.addEventListener('touchend', e => {
    if (!isDragging) return;
    isDragging = false;
    const matrix = new DOMMatrix(getComputedStyle(sheet).transform);
    const endY = matrix.m42;

    let closest = 'peek';
    let minDist = Infinity;
    for (const [state, y] of Object.entries(sheetSnapPoints)) {
      const dist = Math.abs(endY - y);
      if (dist < minDist) { minDist = dist; closest = state; }
    }

    // Hvis vi smeller sheetet helt ned, fjern eventuell aktiv map-markering.
    // onPeek injiseres av orkestratoren (= clearMobileSelection). Guard mot
    // manglende wiring, så en "dum" komponent aldri kaster ReferenceError.
    if (closest === 'peek' && onPeek) onPeek();
    setSheetState(closest);
  });
}
