/** 캔버스를 흰 배경으로 채움 (투명 → JPEG 시 검게 보이는 현상 방지) */
export function fillCanvasWhite(ctx, width, height) {
  if (!ctx || width <= 0 || height <= 0) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
}

/** 렌더 실패·초기화 직후 등으로 거의 검은 썸네일인지 샘플링 검사 */
export function isCanvasMostlyBlank(canvas) {
  if (!canvas?.width || !canvas?.height) return true;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;

  const w = canvas.width;
  const h = canvas.height;
  const step = Math.max(4, Math.floor(Math.min(w, h) / 20));
  let dark = 0;
  let samples = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      if (d[0] < 18 && d[1] < 18 && d[2] < 18) dark += 1;
      samples += 1;
    }
  }
  return samples > 0 && dark / samples >= 0.88;
}

/** data URL 썸네일이 유효한지 비동기 검사 (캐시된 검은 썸네일 제거용) */
export function validateThumbDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 32;
        c.height = Math.max(1, Math.round(32 * (img.height / img.width)));
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(false);
          return;
        }
        fillCanvasWhite(ctx, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(!isCanvasMostlyBlank(c));
      } catch (_) {
        resolve(false);
      }
      img.onload = null;
      img.onerror = null;
      img.src = "";
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}
