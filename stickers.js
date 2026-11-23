// Sticker pipeline: image → optional background removal → trim → white die-cut border.

const AI_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Any image → canvas no larger than `max` on its long side. */
export function normalize(img, max = 1200) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(iw, ih));
  const c = makeCanvas(iw * k, ih * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't read ${file.name || 'that image'}`));
    img.src = URL.createObjectURL(file);
  });
}

let aiLib = null;
/** In-browser background removal. The model downloads once, then the browser caches it. */
export async function removeBg(src, onProgress) {
  // onProgress(message, percent|null) — percent is null while there's nothing to measure
  if (!aiLib) {
    onProgress?.('Loading background remover…', null);
    aiLib = await import(AI_LIB);
  }
  const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
  const res = await aiLib.removeBackground(blob, {
    model: 'isnet_quint8', // smallest model — quickest first download
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      if (key.startsWith('fetch')) {
        const pct = Math.round((cur / total) * 100);
        onProgress?.(`Downloading cutout model · ${pct}% (first time only)`, pct);
      } else onProgress?.('Removing background…', null);
    },
  });
  onProgress?.('Cleaning up edges…', null);
  const bmp = await createImageBitmap(res);
  const c = makeCanvas(bmp.width, bmp.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height);
  cleanIslands(id);
  x.putImageData(id, 0, 0);
  return c;
}

/** Remove the haze and small detached specks a cutout leaves behind; keep the main subject(s). */
function cleanIslands(id) {
  const { width: w, height: h, data: d } = id;
  const n = w * h;
  const label = new Int32Array(n);
  const sizes = [0];
  const stack = [];
  for (let p = 0; p < n; p++) {
    if (label[p] || d[p * 4 + 3] < 60) continue;
    const L = sizes.length;
    let size = 0;
    label[p] = L;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop();
      size++;
      const qx = q % w;
      for (const r of [q - 1, q + 1, q - w, q + w]) {
        if (r < 0 || r >= n || label[r] || d[r * 4 + 3] < 60) continue;
        if ((r === q - 1 && qx === 0) || (r === q + 1 && qx === w - 1)) continue;
        label[r] = L;
        stack.push(r);
      }
    }
    sizes.push(size);
  }
  const keep = Math.max(...sizes) * 0.04;
  for (let p = 0; p < n; p++) if (!label[p] || sizes[label[p]] < keep) d[p * 4 + 3] = 0;
}

/** Crop away fully transparent margins. */
export function trim(src) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) return src;
  const c = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  c.getContext('2d').drawImage(src, -x0, -y0);
  return c;
}

/** White border that follows the sticker's outline (like a die-cut sticker). */
export function bake(s) {
  const src = s.cut;
  const w = src.width, h = src.height;
  const b = Math.round(s.border * Math.max(w, h));
  const pad = b + 2;
  const out = makeCanvas(w + pad * 2, h + pad * 2);
  const o = out.getContext('2d');
  if (b > 0) {
    const sil = makeCanvas(w, h);
    const sc = sil.getContext('2d');
    // solid white silhouette of only the clearly-opaque pixels, so faint specks don't grow blobs
    sc.drawImage(src, 0, 0);
    const id = sc.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = d[i + 3] > 110 ? 255 : 0;
    }
    sc.putImageData(id, 0, 0);
    for (const f of [1, 0.66, 0.33]) {
      const rr = b * f;
      const steps = Math.min(72, Math.max(16, Math.ceil(rr * 0.9)));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        o.drawImage(sil, pad + Math.cos(a) * rr, pad + Math.sin(a) * rr);
      }
    }
    o.drawImage(sil, pad, pad);
  }
  o.drawImage(src, pad, pad);
  s.baked = out;
}
