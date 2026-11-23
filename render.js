// Composites the user's image onto the real clear-case photo from the Pinterest template.
// Approach: photo as the base → user art clipped to the printable ring of the disc →
// the photo's own light/shadow detail on the disc (rings, glare, tab edges) laid back on top.

export const S = 1080; // output size

// Measurements in the original photo (assets/case.jpg, 675×1200)
const TEMPLATE = {
  src: 'assets/case.jpg',
  crop: { x: 80, y: 352, size: 522 }, // case fills the frame, like the TikTok covers
  // fitted against the disc's outer rim (top/right/bottom) and the clear centre ring at 4× zoom
  disc: { cx: 345.5, cy: 612, r: 205, hub: 95 }, // hub = clear unprinted centre
  base: 190, // average grey of the blank disc
};

const k = S / TEMPLATE.crop.size;
export const DISC = {
  x: (TEMPLATE.disc.cx - TEMPLATE.crop.x) * k,
  y: (TEMPLATE.disc.cy - TEMPLATE.crop.y) * k,
  r: TEMPLATE.disc.r * k,
  hub: TEMPLATE.disc.hub * k,
};

let photo = null; // cropped case photo at S×S
let detail = null; // light/shadow detail of the disc, at S×S

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function loadTemplate() {
  const img = new Image();
  img.src = TEMPLATE.src;
  await img.decode();
  const { x, y, size } = TEMPLATE.crop;

  // Upscale in two high-quality steps (smoother than one big jump)…
  const mid = canvas(Math.round((size + S) / 2));
  const m = mid.getContext('2d');
  m.imageSmoothingQuality = 'high';
  m.drawImage(img, x, y, size, size, 0, 0, mid.width, mid.height);
  photo = canvas(S);
  const p = photo.getContext('2d', { willReadFrequently: true });
  p.imageSmoothingQuality = 'high';
  p.drawImage(mid, 0, 0, S, S);

  // …then sharpen the plastic edges back up.
  const id = p.getImageData(0, 0, S, S);
  unsharp(id, 2, 1.1, 4);
  p.putImageData(id, 0, 0);

  // Detail map: how much each disc pixel deviates from the flat disc grey.
  // Brighter → white highlight, darker → black shade. Outside the disc → nothing.
  const d = id.data;
  const out = new ImageData(S, S);
  const o = out.data;
  const base = TEMPLATE.base;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dist = Math.hypot(px - DISC.x, py - DISC.y);
      if (dist > DISC.r + 2) continue;
      const i = (py * S + px) * 4;
      const L = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (L >= base) {
        o[i] = o[i + 1] = o[i + 2] = 255;
        o[i + 3] = Math.min(255, (L - base) * 3.2);
      } else {
        o[i + 3] = Math.min(255, (base - L) * 1.6);
      }
    }
  }
  detail = canvas(S);
  detail.getContext('2d').putImageData(out, 0, 0);
}

/** Unsharp mask: out = px + amount·(px − blur(px)), ignoring differences below `threshold`. */
function unsharp(id, radius, amount, threshold) {
  const { width: w, height: h, data: d } = id;
  const n = w * h;
  const blur = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    blur[i * 3] = d[i * 4];
    blur[i * 3 + 1] = d[i * 4 + 1];
    blur[i * 3 + 2] = d[i * 4 + 2];
  }
  const tmp = new Float32Array(n * 3);
  const pass = (src, dst, horizontal) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const win = radius * 2 + 1;
    for (let l = 0; l < lines; l++) {
      for (let c = 0; c < 3; c++) {
        const at = (k) => {
          const kk = Math.min(len - 1, Math.max(0, k));
          return ((horizontal ? l * w + kk : kk * w + l) * 3) + c;
        };
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += src[at(k)];
        for (let k = 0; k < len; k++) {
          dst[at(k)] = sum / win;
          sum += src[at(k + radius + 1)] - src[at(k - radius)];
        }
      }
    }
  };
  // two box passes ≈ gaussian
  for (let r = 0; r < 2; r++) {
    pass(blur, tmp, true);
    pass(tmp, blur, false);
  }
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = d[i * 4 + c];
      const diff = v - blur[i * 3 + c];
      if (Math.abs(diff) > threshold) d[i * 4 + c] = Math.max(0, Math.min(255, v + amount * diff));
    }
  }
}

export function coverScale(img) {
  return (2 * DISC.r) / Math.min(img.width, img.height);
}

function ring(c, outer, inner) {
  c.beginPath();
  c.arc(DISC.x, DISC.y, outer, 0, Math.PI * 2);
  c.arc(DISC.x, DISC.y, inner, 0, Math.PI * 2, true);
}

export function stickerSize(s) {
  return { w: s.scale, h: (s.scale * s.baked.height) / s.baked.width };
}

export const HANDLE_R = 20;
export function handlePos(s) {
  const { w, h } = stickerSize(s);
  const cos = Math.cos(s.rot), sin = Math.sin(s.rot);
  const lx = w / 2 + 6, ly = h / 2 + 6;
  return { x: s.x + lx * cos - ly * sin, y: s.y + lx * sin + ly * cos };
}

export function render(c, st, scale = 1, ui = false) {
  if (!photo) return;
  c.save();
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.imageSmoothingQuality = 'high';
  c.drawImage(photo, 0, 0);

  if (st.art) {
    const { img, zoom, ox, oy, rot = 0, flip = false } = st.art;
    const sc = coverScale(img) * zoom;
    c.save();
    ring(c, DISC.r - 1.5, DISC.hub);
    c.clip();
    c.save();
    c.translate(DISC.x + ox, DISC.y + oy);
    c.rotate(rot);
    if (flip) c.scale(-1, 1);
    c.drawImage(img, (-img.width * sc) / 2, (-img.height * sc) / 2, img.width * sc, img.height * sc);
    c.restore();
    c.drawImage(detail, 0, 0); // the case's own reflections back on top
    c.restore();
  }

  for (const s of st.stickers) {
    if (!s.baked) continue;
    const { w, h } = stickerSize(s);
    c.save();
    c.translate(s.x, s.y);
    c.rotate(s.rot);
    if (s.flip) c.scale(-1, 1);
    c.globalAlpha = s.opacity ?? 1;
    c.shadowColor = s.shadow === false ? 'transparent' : 'rgba(0,0,0,0.5)';
    c.shadowBlur = 16 * scale;
    c.shadowOffsetY = 5 * scale;
    c.drawImage(s.baked, -w / 2, -h / 2, w, h);
    c.restore();
  }

  const sel = ui && st.selected;
  if (sel && sel.baked) {
    const { w, h } = stickerSize(sel);
    c.save();
    c.translate(sel.x, sel.y);
    c.rotate(sel.rot);
    c.setLineDash([8, 7]);
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
    c.setLineDash([]);
    c.beginPath();
    c.arc(w / 2 + 6, h / 2 + 6, HANDLE_R, 0, Math.PI * 2);
    c.fillStyle = '#fff';
    c.fill();
    c.strokeStyle = '#000';
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(w / 2 + 6, h / 2 + 6, 8, -0.3, Math.PI * 1.3);
    c.stroke();
    c.restore();
  }
  c.restore();
}
