export async function imageFileToGray(file, maxSide = 4000) {
    let bmp;
    try {
        bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    catch {
        throw new Error('браузер не открыл фото (HEIC не поддерживается — сохраните как JPEG или PNG)');
    }
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++)
        data[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    return { w, h, data };
}
