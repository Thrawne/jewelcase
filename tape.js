// Mixtape mode: a real cassette photo (assets/cassette.png, label blanked) with
// a recolourable shell and the user's image printed on the paper label.

const S = 1080; // output size (same as render.js)
const SRC = 'assets/cassette.png';
const K = S / 1200; // template is 1200×1200

// label outline in template px (angled top corners) and the reel window that sits on top of it
const LABEL = [[216, 347], [970, 347], [1019, 392], [1019, 734], [176, 734], [176, 390]].map(([x, y]) => [x * K, y * K]);
const WIN = { x: 322 * K, y: 493 * K, w: 551 * K, h: 152 * K, r: 13 * K };
export const LABEL_BOX = { x: 176 * K, y: 347 * K, w: 843 * K, h: 387 * K };
export const ORIGINAL_COLOR = '#4398bd';

let photo = null; // template at S×S
let base = null; // ImageData of the template
let weight = null; // 0..1 per pixel: how much of the blue shell it is
let lum = null; // per-pixel lightness of the shell
let meanL = 0.5;
let tinted = null; // template with the current shell colour
let tintedFor = null;

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export async function loadTape() {
  const img = new Image();
  img.src = SRC;
  await img.decode();
  photo = canvas(S);
  const p = photo.getContext('2d', { willReadFrequently: true });
  p.imageSmoothingQuality = 'high';
  p.drawImage(img, 0, 0, S, S);
  base = p.getImageData(0, 0, S, S);

  // Find the blue shell: blue-cyan hue with some saturation. Screws, reels, label stay out.
  const d = base.data;
  const n = S * S;
  weight = new Float32Array(n);
  lum = new Float32Array(n);
  let sum = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const [h, s, l] = rgbToHsl(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const hueW = smooth(160, 178, h) * (1 - smooth(222, 240, h));
    const w = hueW * smooth(0.12, 0.3, s) * smooth(0.03, 0.09, l);
    weight[i] = w;
    lum[i] = l;
    sum += l * w;
    wsum += w;
  }
  meanL = sum / wsum;
  tinted = null;
}

/** The template with the shell recoloured, keeping the plastic's texture and shading. */
function shell(color) {
  if (!color || color.toLowerCase() === ORIGINAL_COLOR) return photo;
  if (tinted && tintedFor === color) return tinted;
  const r0 = parseInt(color.slice(1, 3), 16), g0 = parseInt(color.slice(3, 5), 16), b0 = parseInt(color.slice(5, 7), 16);
  const [ht, st, lt] = rgbToHsl(r0, g0, b0);
  const out = new ImageData(new Uint8ClampedArray(base.data), S, S);
  const d = out.data;
  // keep texture contrast, but squash it a bit for very light / very dark targets so they don't clip
  const contrast = 1 - Math.abs(lt - 0.5) * 0.8;
  for (let i = 0; i < S * S; i++) {
    const w = weight[i];
    if (w < 0.01) continue;
    const l = Math.min(1, Math.max(0, lt + (lum[i] - meanL) * contrast * 1.15));
    const [r, g, b] = hslToRgb(ht, st, l);
    const j = i * 4;
    d[j] = d[j] * (1 - w) + r * w;
    d[j + 1] = d[j + 1] * (1 - w) + g * w;
    d[j + 2] = d[j + 2] * (1 - w) + b * w;
  }
  tinted = canvas(S);
  tinted.getContext('2d').putImageData(out, 0, 0);
  tintedFor = color;
  return tinted;
}

function labelPath(c) {
  c.moveTo(...LABEL[0]);
  for (const pt of LABEL.slice(1)) c.lineTo(...pt);
  c.closePath();
}
function windowPath(c) {
  c.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
}

export function inLabel(p) {
  const c = canvas(1);
  const x = c.getContext('2d');
  x.beginPath();
  labelPath(x);
  windowPath(x);
  return x.isPointInPath(p.x, p.y, 'evenodd');
}

export function labelCoverScale(img) {
  return Math.max(LABEL_BOX.w / img.width, LABEL_BOX.h / img.height);
}

export function renderTape(c, st, scale) {
  if (!photo) return;
  c.drawImage(shell(st.tapeColor), 0, 0);

  const a = st.art;
  if (!a) return;
  const t = a.tape;
  const sc = labelCoverScale(a.img) * t.zoom;
  c.save();
  // the printable label = label outline minus the reel window
  c.beginPath();
  labelPath(c);
  windowPath(c);
  c.clip('evenodd');
  c.save();
  c.translate(LABEL_BOX.x + LABEL_BOX.w / 2 + t.ox, LABEL_BOX.y + LABEL_BOX.h / 2 + t.oy);
  c.rotate(t.rot);
  if (t.flip) c.scale(-1, 1);
  c.drawImage(a.img, (-a.img.width * sc) / 2, (-a.img.height * sc) / 2, a.img.width * sc, a.img.height * sc);
  c.restore();

  // the plastic lip over the label edge and around the window casts a soft shadow on the paper
  c.beginPath();
  c.rect(-50, -50, S + 100, S + 100);
  labelPath(c);
  windowPath(c);
  c.shadowColor = 'rgba(0,0,0,0.45)';
  c.shadowBlur = 9 * scale;
  c.shadowOffsetY = 2 * scale;
  c.fillStyle = '#000';
  c.fill('evenodd');
  c.shadowColor = 'transparent';

  // faint paper sheen
  const g = c.createLinearGradient(LABEL_BOX.x, LABEL_BOX.y, LABEL_BOX.x + LABEL_BOX.w, LABEL_BOX.y + LABEL_BOX.h);
  g.addColorStop(0, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  c.fillStyle = g;
  c.fillRect(LABEL_BOX.x, LABEL_BOX.y, LABEL_BOX.w, LABEL_BOX.h);
  c.restore();
}
