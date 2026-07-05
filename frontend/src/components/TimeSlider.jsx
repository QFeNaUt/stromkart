// src/components/TimeSlider.jsx — Time-slideren (steg 2.5)
// ---------------------------------------------------------
// Portal-tvillinger (S1, låst 05.07): ÉN forelder eier all tilstand og
// rendrer identisk visning via createPortal inn i de to legacy-
// containerne #time-slider-desktop og #time-slider-mobile. Hele
// querySelectorAll-synkroniseringen fra gamle ui/slider.js forsvinner:
// begge instansene rendrer fra samme props og kan aldri komme i utakt.
//
// Tilstandsfordeling:
//   - timeAxis/currentIndex/nowIndex/userPinned: reducer (REACT_OWNED,
//     steg 2.5) — leses her, endres via dispatch (scrubTo/playTick/
//     snapToNow/pinUser).
//   - isPlaying/sliderCollapsed: useState HER (S2, låst 05.07) — ekte
//     lokal UI-tilstand uten legacy-lesere. Play-intervallet er en
//     effekt med cleanup (StrictMode-trygg: dobbeltkjøring i dev gir
//     clearInterval + nytt interval, aldri to samtidige).
//
// Container-klassene (hidden/collapsed) settes med en effekt på de to
// legacy-divene: CSS-en i index.html selekterer på wrapperen
// (.time-slider-wrap.hidden/.collapsed), og sheet.js toggler
// .full-hidden på #time-slider-mobile imperativt — containerne må
// derfor beholde ID + klasser og forbli legacy-DOM til sheetet selv
// migreres. React eier INNHOLDET, effekten oversetter tilstand til
// container-klasser (samme mønster som MapCanvas' kart-effekter).
// ---------------------------------------------------------

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PLAY_SPEED_MS } from '../js/config.js';
import { useAppState, useAppDispatch } from '../store.jsx';

const CONTAINER_IDS = ['time-slider-desktop', 'time-slider-mobile'];

// Ren hjelper (portert fra slider.js): indeksen der aksen krysser til
// neste døgn, eller -1 hvis aksen er innen ett døgn.
function findDayBoundaryIndex(timeAxis) {
  if (timeAxis.length < 2) return -1;
  const firstDay = timeAxis[0].toDateString();
  for (let i = 1; i < timeAxis.length; i++) {
    if (timeAxis[i].toDateString() !== firstDay) return i;
  }
  return -1;
}

// Tidslabelen (portert fra formatTimeLabel) — brukes både i full UI og
// i den kompakte pillen (collapsed-time-label).
function TimeLabel({ timeAxis, currentIndex, nowIndex }) {
  if (!timeAxis.length) return <>—</>;
  const t = timeAxis[currentIndex];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const timeStr = t.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

  if (currentIndex === nowIndex) {
    return <><span className="live-dot" />Nå · {timeStr}</>;
  }
  let prefix;
  if (t.toDateString() === now.toDateString()) {
    prefix = 'I dag';
  } else if (t.toDateString() === tomorrow.toDateString()) {
    prefix = 'I morgen';
  } else {
    prefix = t.toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return <>{prefix} · {timeStr}</>;
}

// Selve slider-markupen — klasse- og aria-tro mot gamle index.html-
// blokkene, så all eksisterende CSS treffer uendret. Rendres to ganger
// (én per portal) med identiske props.
function SliderView({
  timeAxis, currentIndex, nowIndex, isPlaying,
  onRangePointerDown, onRangeChange, onTogglePlay, onSnapNow, onToggleCollapse,
}) {
  const maxIdx = Math.max(0, timeAxis.length - 1);
  const atNow = currentIndex === nowIndex;
  const nowPct = maxIdx > 0 ? (nowIndex / maxIdx) * 100 : 0;
  const boundaryIdx = findDayBoundaryIndex(timeAxis);
  const boundaryPct = boundaryIdx > 0 && maxIdx > 0 ? (boundaryIdx / maxIdx) * 100 : 0;
  const label = <TimeLabel timeAxis={timeAxis} currentIndex={currentIndex} nowIndex={nowIndex} />;

  return (
    <>
      <button className="time-slider-collapse" type="button" aria-label="Minimer tidslinje"
              onClick={onToggleCollapse}>⌄</button>
      <div className="time-slider-top">
        <button className="time-slider-btn time-slider-play" type="button" aria-label="Spill av/pause"
                onClick={onTogglePlay}>{isPlaying ? '⏸' : '▶'}</button>
        <div className="time-slider-label">{label}</div>
        <button className={'time-slider-btn time-slider-now' + (atNow ? ' at-now' : '')}
                type="button" aria-label="Hopp til nå" onClick={onSnapNow}>Nå</button>
      </div>
      <div className="time-slider-track-wrap">
        <input type="range" className="time-slider-range" min="0" max={maxIdx}
               value={Math.min(currentIndex, maxIdx)} step="1" aria-label="Tidspunkt"
               onPointerDown={onRangePointerDown} onChange={onRangeChange} />
        <div className={'time-slider-now-marker' + (timeAxis.length ? ' visible' : '')}
             style={{ left: `${nowPct}%` }} aria-hidden="true" />
        <div className={'time-slider-day-marker' + (boundaryIdx > 0 ? ' visible' : '')}
             style={{ left: `${boundaryPct}%` }} aria-hidden="true" />
      </div>
      <div className="time-slider-ticks">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
      <button className="time-slider-expand" type="button" aria-label="Vis tidslinje"
              onClick={onToggleCollapse}>
        <span className="collapsed-time-label">{label}</span>
        <span className="chevron" aria-hidden="true">⌃</span>
      </button>
    </>
  );
}

export function TimeSlider() {
  const { timeAxis, currentIndex, nowIndex } = useAppState();
  const dispatch = useAppDispatch();

  // Lokal UI-tilstand (S2): delt automatisk mellom begge portal-
  // instansene fordi de rendres fra denne ene forelderen.
  const [isPlaying, setIsPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const visible = timeAxis.length > 0;

  // Avspilling: rent deklarativt interval. Cleanup dreper intervallet
  // ved pause OG ved unmount — playInterval-håndarbeidet fra slider.js
  // er borte.
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => dispatch({ type: 'playTick' }), PLAY_SPEED_MS);
    return () => clearInterval(id);
  }, [isPlaying, dispatch]);

  // Container-klasser (hidden/collapsed) på de to legacy-divene — se
  // filhodet. Idempotent (classList.toggle med boolsk flagg), og rører
  // aldri .full-hidden (den eies av sheet.js).
  useEffect(() => {
    for (const id of CONTAINER_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('hidden', !visible);
      el.classList.toggle('collapsed', collapsed);
    }
  }, [visible, collapsed]);

  // --- Handlere (felles for begge instanser) ---
  // pointerdown pinner umiddelbart når brukeren griper slideren, selv
  // før noen bevegelse skjer, og pauser avspilling (legacy-troskap).
  const onRangePointerDown = () => {
    setIsPlaying(false);
    dispatch({ type: 'pinUser' });
  };
  // Reacts onChange på range fyrer kontinuerlig under drag (som 'input').
  const onRangeChange = (e) => {
    dispatch({ type: 'scrubTo', index: parseInt(e.target.value, 10) });
  };
  const onTogglePlay = () => {
    if (!visible) return; // gamle startPlay-guarden: ingen akse, ingen avspilling
    setIsPlaying(p => !p);
  };
  const onSnapNow = () => {
    setIsPlaying(false);
    dispatch({ type: 'snapToNow' });
  };
  const onToggleCollapse = () => {
    // Pause ved minimering — ellers ville avspillingen fortsatt usynlig
    // (legacy-troskap fra toggleSliderCollapse).
    if (!collapsed) setIsPlaying(false);
    setCollapsed(!collapsed);
  };

  const viewProps = {
    timeAxis, currentIndex, nowIndex, isPlaying,
    onRangePointerDown, onRangeChange, onTogglePlay, onSnapNow, onToggleCollapse,
  };

  // Slot-ankrene er statiske i index.html og finnes garantert før React
  // mounter (module scripts er deferred). Guardene er defensive vakter.
  const desktopEl = document.getElementById('time-slider-desktop');
  const mobileEl = document.getElementById('time-slider-mobile');

  return (
    <>
      {desktopEl && createPortal(<SliderView {...viewProps} />, desktopEl)}
      {mobileEl && createPortal(<SliderView {...viewProps} />, mobileEl)}
    </>
  );
}
