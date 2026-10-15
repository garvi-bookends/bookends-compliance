// Shrinks a phone photo off the main thread, so the audit screen never freezes while a 12-megapixel photo is opened.
// In: { id, file, max, quality }. Out: { id, blob } (a JPEG at most `max` px on its longest side) or { id, error }.
// Needs createImageBitmap and OffscreenCanvas in workers (iPhone Safari 16.4+, Android Chrome); app.js falls back to the
// main thread when they are missing.
self.onmessage = async (e) => {
  const { id, file, max = 1280, quality = 0.78 } = e.data || {};
  try {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(file); }
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
