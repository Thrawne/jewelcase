import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { S, DISC, loadTemplate, render, stickerSize, handlePos, HANDLE_R } from './render.js';
import { loadTape, inLabel, ORIGINAL_COLOR } from './tape.js';
import { normalize, loadImageFile, removeBg, trim, bake } from './stickers.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');
const DEG = Math.PI / 180;

// The case/cassette photo is fixed. Only the cover image and the stickers can move.
// The cover image is shared by both modes; each mode keeps its own placement of it.
const state = { mode: 'cd', tapeColor: ORIGINAL_COLOR, art: null, stickers: [], selected: null };
const freshFit = () => ({ zoom: 1, ox: 0, oy: 0, rot: 0, flip: false });
const fit = () => state.art[state.mode];

let raf = 0;
function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    render(ctx, state, cv.width / S, true);
    // keep animating the shimmer while any sticker is being cut out
    if (state.stickers.some((s) => s.busy)) draw();
  });
}
new ResizeObserver(() => {
  const px = Math.round(Math.min(S * 1.5, cv.getBoundingClientRect().width * Math.min(2, devicePixelRatio || 1))) || S;
  if (cv.width !== px) {
    cv.width = cv.height = px;
    draw();
  }
}).observe(cv);

const say = (msg) => ($('status').textContent = msg);

/** Progress bar under the panel. pct = number → fills to that %, null → indeterminate wipe, false → hide. */
function progress(msg, pct) {
  const box = $('progress');
  box.hidden = pct === false;
  if (pct === false) return;
  box.classList.toggle('indeterminate', pct == null);
  if (pct != null) $('progressBar').style.width = `${pct}%`;
  $('progressText').textContent = msg;
}

/* =================== panel (Tweakpane) =================== */

const pane = new Pane({ container: $('pane'), title: 'Canvas' });
let syncing = false; // true while the panel is being refreshed from the canvas
const quiet = (fn) => {
  syncing = true;
  try { fn(); } finally { syncing = false; }
};

// ---- format ----
const fmt = { mode: state.mode, color: state.tapeColor };
pane
  .addBinding(fmt, 'mode', { label: 'format', options: { CD: 'cd', Mixtape: 'tape' } })
  .on('change', (e) => {
    state.mode = e.value;
    colorBlade.hidden = resetColor.hidden = e.value !== 'tape';
    fArt.title = e.value === 'tape' ? 'Label image' : 'Cover image';
    syncArt();
    draw();
  });
const colorBlade = pane.addBinding(fmt, 'color', { label: 'tape colour', view: 'color' });
colorBlade.hidden = true;
colorBlade.on('change', (e) => {
  state.tapeColor = e.value;
  draw();
});
const resetColor = pane.addButton({ title: 'Original tape colour' });
resetColor.hidden = true;
resetColor.on('click', () => {
  fmt.color = state.tapeColor = ORIGINAL_COLOR;
  quiet(() => colorBlade.refresh());
  draw();
});

// ---- cover image ----
const artP = { x: 0, y: 0, zoom: 1, rotate: 0, flip: false };
const fArt = pane.addFolder({ title: 'Cover image' });
fArt.addBinding(artP, 'x', { min: -700, max: 700, step: 1 });
fArt.addBinding(artP, 'y', { min: -700, max: 700, step: 1 });
fArt.addBinding(artP, 'zoom', { min: 0.2, max: 5, step: 0.01 });
fArt.addBinding(artP, 'rotate', { label: 'rotate °', min: -180, max: 180, step: 1 });
fArt.addBinding(artP, 'flip');
fArt.addButton({ title: 'Reset fit' }).on('click', () => {
  if (!state.art) return;
  state.art[state.mode] = freshFit();
  syncArt();
  draw();
});
fArt.on('change', () => {
  if (syncing || !state.art) return;
  Object.assign(fit(), { ox: artP.x, oy: artP.y, zoom: artP.zoom, rot: artP.rotate * DEG, flip: artP.flip });
  draw();
});
fArt.disabled = true;

function syncArt() {
  fArt.disabled = !state.art;
  if (!state.art) return;
  const a = fit();
  Object.assign(artP, { x: Math.round(a.ox), y: Math.round(a.oy), zoom: a.zoom, rotate: Math.round(a.rot / DEG), flip: !!a.flip });
  quiet(() => fArt.refresh());
}

// ---- stickers ----
let fSt = null;
const stP = {};

function stickerLabel(s, i) {
  const n = s.name.replace(/\.[a-z0-9]+$/i, '');
  return `${i + 1}. ${n.length > 18 ? n.slice(0, 17) + '…' : n}`;
}

function buildStickerPanel() {
  fSt?.dispose();
  fSt = null;
  if (!state.stickers.length) return;
  fSt = pane.addFolder({ title: `Stickers (${state.stickers.length})` });

  const pick = { which: state.selected ? state.selected.id : 0 };
  const options = { '— none —': 0 };
  state.stickers.forEach((s, i) => (options[stickerLabel(s, i)] = s.id));
  fSt.addBinding(pick, 'which', { label: 'selected', options }).on('change', (e) => {
    if (!syncing) select(state.stickers.find((s) => s.id === e.value) || null);
  });

  const s = state.selected;
  if (!s) return;
  fillStickerParams(s);
  const b = (key, opt, apply) =>
    fSt.addBinding(stP, key, opt).on('change', (e) => {
      if (!syncing) apply(e.value);
    });

  fSt.addBlade({ view: 'separator' });
  b('x', { min: -200, max: S + 200, step: 1 }, (v) => { s.x = v; draw(); });
  b('y', { min: -200, max: S + 200, step: 1 }, (v) => { s.y = v; draw(); });
  b('size', { min: 30, max: 1400, step: 1 }, (v) => { s.scale = v; draw(); });
  b('rotate', { label: 'rotate °', min: -180, max: 180, step: 1 }, (v) => { s.rot = v * DEG; draw(); });
  b('opacity', { min: 0.1, max: 1, step: 0.01 }, (v) => { s.opacity = v; draw(); });
  b('flip', {}, (v) => { s.flip = v; draw(); });

  fSt.addBlade({ view: 'separator' });
  b('removeBg', { label: 'remove bg' }, (v) => setRemoveBg(s, v));
  b('border', { label: 'border', min: 0, max: 0.1, step: 0.002 }, (v) => { s.border = v; bake(s); draw(); });
  b('shadow', {}, (v) => { s.shadow = v; draw(); });

  fSt.addBlade({ view: 'separator' });
  fSt.addButton({ title: 'Bring forward' }).on('click', () => moveLayer(s, 1));
  fSt.addButton({ title: 'Send back' }).on('click', () => moveLayer(s, -1));
  fSt.addButton({ title: 'Duplicate' }).on('click', () => duplicate(s));
  fSt.addButton({ title: 'Delete' }).on('click', deleteSelected);
}

function fillStickerParams(s) {
  Object.assign(stP, {
    x: Math.round(s.x),
    y: Math.round(s.y),
    size: Math.round(s.scale),
    rotate: Math.round((((s.rot / DEG + 540) % 360) - 180)),
    opacity: s.opacity ?? 1,
    flip: !!s.flip,
    removeBg: s.removeBg,
    border: s.border,
    shadow: s.shadow !== false,
  });
}

function syncSticker() {
  const s = state.selected;
  if (!s || !fSt) return;
  fillStickerParams(s);
  quiet(() => fSt.refresh());
}

/* =================== cover image =================== */

// download name follows the cover image's file name until you type your own
let nameEdited = false;
$('fileName').addEventListener('input', () => (nameEdited = true));
const cleanName = (n) =>
  n.replace(/\.(jpe?g|png|webp|gif|heic|avif)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'playlist-cover';

async function setArt(file) {
  try {
    const img = normalize(await loadImageFile(file), 2400);
    if (!nameEdited && file.name) $('fileName').value = cleanName(file.name);
    state.art = { img, cd: freshFit(), tape: freshFit() };
    syncArt();
    draw();
  } catch (e) {
    say(e.message);
  }
}
$('artFile').addEventListener('change', (e) => {
  if (e.target.files[0]) setArt(e.target.files[0]);
  e.target.value = '';
});

/* =================== stickers =================== */

let uid = 0;
const spots = [[800, 220], [280, 870], [820, 860], [270, 220]];

async function addSticker(file, at) {
  try {
    const src = normalize(await loadImageFile(file));
    const [x, y] = at || spots[state.stickers.length % spots.length];
    const s = {
      id: ++uid, name: file.name || 'sticker', src, cut: trim(src), noBg: null,
      removeBg: false, border: 0.04, shadow: true, opacity: 1, flip: false,
      scale: 260, x, y, rot: (Math.random() - 0.5) * 0.3,
    };
    bake(s);
    state.stickers.push(s);
    select(s);
  } catch (e) {
    say(e.message);
  }
}

function select(s) {
  state.selected = s;
  buildStickerPanel();
  draw();
}

async function setRemoveBg(s, on) {
  if (s.busy) return syncSticker(); // already cutting this one out
  s.removeBg = on;
  if (on && !s.noBg) {
    s.busy = true;
    s.busyStart = performance.now();
    say('');
    progress('Starting…', null);
    draw(); // starts the shimmer on the sticker
    try {
      s.noBg = trim(await removeBg(s.src, (m, pct) => progress(m, pct)));
    } catch (err) {
      console.error(err);
      s.removeBg = false;
      say("Couldn't load the background remover — check your connection and try again.");
      syncSticker();
      return;
    } finally {
      s.busy = false;
      if (!state.stickers.some((x) => x.busy)) progress('', false);
      draw();
    }
  }
  s.cut = s.removeBg ? s.noBg : trim(s.src);
  bake(s);
  draw();
}

function moveLayer(s, dir) {
  const a = state.stickers;
  const i = a.indexOf(s);
  const j = Math.max(0, Math.min(a.length - 1, i + dir));
  a.splice(i, 1);
  a.splice(j, 0, s);
  buildStickerPanel();
  draw();
}

function duplicate(s) {
  const c = { ...s, id: ++uid, x: s.x + 40, y: s.y + 40 };
  state.stickers.push(c);
  select(c);
}

function deleteSelected() {
  const s = state.selected;
  if (!s) return;
  state.stickers.splice(state.stickers.indexOf(s), 1);
  select(null);
}

$('stickerFile').addEventListener('change', async (e) => {
  for (const f of e.target.files) await addSticker(f);
  e.target.value = '';
});

/* =================== canvas interaction =================== */

function toCanvas(e) {
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S };
}
function hitSticker(p) {
  for (let i = state.stickers.length - 1; i >= 0; i--) {
    const s = state.stickers[i];
    const { w, h } = stickerSize(s);
    const dx = p.x - s.x, dy = p.y - s.y;
    const c = Math.cos(-s.rot), sn = Math.sin(-s.rot);
    if (Math.abs(dx * c - dy * sn) <= w / 2 && Math.abs(dx * sn + dy * c) <= h / 2) return s;
  }
  return null;
}
// is the point on the printable area (disc or tape label) for the current mode?
const onArt = (p) => (state.mode === "tape" ? inLabel(p) : Math.hypot(p.x - DISC.x, p.y - DISC.y) <= DISC.r);

let drag = null;
cv.addEventListener('pointerdown', (e) => {
  const p = toCanvas(e);
  const sel = state.selected;
  if (sel) {
    const hp = handlePos(sel);
    if (Math.hypot(p.x - hp.x, p.y - hp.y) <= HANDLE_R + 10)
      drag = { kind: 'handle', s: sel, d0: Math.hypot(p.x - sel.x, p.y - sel.y), a0: Math.atan2(p.y - sel.y, p.x - sel.x), scale0: sel.scale, rot0: sel.rot };
  }
  if (!drag) {
    const s = hitSticker(p);
    if (s) {
      if (s !== sel) select(s);
      drag = { kind: 'sticker', s, dx: p.x - s.x, dy: p.y - s.y };
    } else {
      if (sel) select(null);
      if (state.art && onArt(p)) drag = { kind: 'art', px: p.x, py: p.y, ox: fit().ox, oy: fit().oy };
    }
  }
  if (drag) {
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('dragging');
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCanvas(e);
  if (drag.kind === 'sticker') {
    drag.s.x = p.x - drag.dx;
    drag.s.y = p.y - drag.dy;
    syncSticker();
  } else if (drag.kind === 'handle') {
    const s = drag.s;
    s.scale = Math.max(30, Math.min(1400, drag.scale0 * (Math.hypot(p.x - s.x, p.y - s.y) / Math.max(1, drag.d0))));
    let rot = drag.rot0 + Math.atan2(p.y - s.y, p.x - s.x) - drag.a0;
    if (e.shiftKey) rot = Math.round(rot / (15 * DEG)) * 15 * DEG;
    s.rot = rot;
    syncSticker();
  } else {
    fit().ox = drag.ox + (p.x - drag.px);
    fit().oy = drag.oy + (p.y - drag.py);
    syncArt();
  }
  draw();
});
const endDrag = () => {
  drag = null;
  cv.classList.remove('dragging');
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

cv.addEventListener(
  'wheel',
  (e) => {
    const p = toCanvas(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    const s = hitSticker(p);
    if (s) {
      s.scale = Math.max(30, Math.min(1400, s.scale * f));
      if (s === state.selected) syncSticker();
    } else if (state.art && onArt(p)) {
      fit().zoom = Math.max(0.2, Math.min(5, fit().zoom * f));
      syncArt();
    } else return;
    e.preventDefault();
    draw();
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, .tp-rotv')) return;
  const s = state.selected;
  if ((e.key === 'Delete' || e.key === 'Backspace') && s) {
    e.preventDefault();
    deleteSelected();
    return;
  }
  if (e.key === 'Escape') return select(null);
  if (!e.key.startsWith('Arrow')) return;
  const step = e.shiftKey ? 10 : 1;
  const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
  const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
  if (s) {
    s.x += dx;
    s.y += dy;
    syncSticker();
  } else if (state.art) {
    fit().ox += dx;
    fit().oy += dy;
    syncArt();
  } else return;
  e.preventDefault();
  draw();
});

/* =================== drop & paste =================== */

const stage = $('stage');
let depth = 0;
stage.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; stage.classList.add('over'); });
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; stage.classList.remove('over'); } });
stage.addEventListener('drop', async (e) => {
  e.preventDefault();
  depth = 0;
  stage.classList.remove('over');
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  const p = toCanvas(e);
  if (!state.art || onArt(p)) {
    await setArt(files.shift());
    for (const f of files) await addSticker(f);
  } else for (const f of files) await addSticker(f, [p.x, p.y]);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
window.addEventListener('paste', async (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  for (const f of files) state.art ? await addSticker(f) : await setArt(f);
});

/* =================== download =================== */

$('download').addEventListener('click', () => {
  const out = document.createElement('canvas');
  out.width = out.height = S;
  render(out.getContext('2d'), state, 1, false);
  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cleanName($('fileName').value)}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/jpeg', 0.93);
});

await Promise.all([loadTemplate(), loadTape()]);
draw();
window.jewelcase = { state, draw };
