// Фото или картинка → яркость пикселей. Большие снимки уменьшаем до maxSide по длинной стороне.
// Прозрачный фон (PNG, SVG) считается белой бумагой — иначе он становится чёрным и весь рисунок «заливается».
import type { Gray } from './templateImport.ts';

const isSvg = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

/** SVG рисует сам браузер (как на экране), со всеми заливками и цветами. */
async function loadSvg(file: File, maxSide: number): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('это не SVG');
  // размер: из viewBox или width/height; рисуем крупно, чтобы тонкие линии не терялись
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  let w = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(svg.getAttribute('width') ?? '') || 0;
  let h = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(svg.getAttribute('height') ?? '') || 0;
  if (!(w > 0 && h > 0)) { w = 1000; h = 1000; }
  const k = maxSide / Math.max(w, h);
  w = Math.round(w * k);
  h = Math.round(h * k);
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w / k} ${h / k}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error('браузер не смог нарисовать этот SVG'));
    img.src = url;
  });
  return { src: img, w, h, done: () => URL.revokeObjectURL(url) };
}

export async function imageFileToGray(file: File, maxSide = 4000): Promise<Gray> {
  let src: CanvasImageSource, sw: number, sh: number, done: () => void;
  if (isSvg(file)) {
    const s = await loadSvg(file, Math.min(maxSide, 2000));
    ({ src, done } = s);
    sw = s.w;
    sh = s.h;
  } else {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error('браузер не открыл картинку (HEIC не поддерживается — сохраните как JPEG или PNG)');
    }
    src = bmp;
    sw = bmp.width;
    sh = bmp.height;
    done = () => bmp.close();
  }
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  done();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  return { w, h, data };
}
