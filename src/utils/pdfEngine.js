// 🔹 PDF 렌더링 엔진 어댑터 (IPC 기반)
//    - 내부 엔진: pdfium-native (네이티브 Chromium PDFium)
//    - 위치: 메인 프로세스에서 동작 (Edge/Chrome과 동일한 아키텍처)
//    - 렌더러 ↔ 메인: ipcRenderer.invoke 로 통신
//    - 외부 API: PDF.js 호환 형태 (getDocument, page.getViewport, page.render, page.getTextContent 등)

let ipcRenderer = null;
try {
  if (typeof window !== "undefined" && window.require) {
    ipcRenderer = window.require("electron").ipcRenderer;
  }
} catch (e) {
  console.error("electron.ipcRenderer 로드 실패:", e);
  ipcRenderer = null;
}

// 🔹 PDF.js의 Util.transform과 동일한 2D 아핀 행렬 곱
//    [a, b, c, d, e, f] = [[a, c, e],[b, d, f],[0, 0, 1]]
export function matrixTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

// PDF.js의 RenderingCancelledException과 호환되는 에러
export class RenderingCancelledException extends Error {
  constructor(message = "Rendering cancelled") {
    super(message);
    this.name = "RenderingCancelledException";
    this.type = "canvas";
  }
}

function isCancelled(flag) {
  return !!(flag && flag.cancelled);
}

// 동일 페이지·스케일 동시 렌더 요청 dedupe (IPC/파일 I/O 중복 방지)
const renderInflight = new Map();

// 렌더러 프로세스: getPageMeta IPC 캐시 상한
const MAX_PAGE_META_CACHE = 48;

function renderInflightKey(docId, pageIndex, scale, format) {
  return `${docId}:${pageIndex}:${scale}:${format}`;
}

function clearRenderInflightForDoc(docId) {
  const prefix = `${docId}:`;
  for (const key of renderInflight.keys()) {
    if (key.startsWith(prefix)) renderInflight.delete(key);
  }
}

// 한 페이지 어댑터
//   - 메인 프로세스의 PDFium 페이지 핸들은 docId + pageIndex로 식별
//   - 메타데이터(width/height/rotation)는 생성 시점에 1회 조회 후 캐싱
class PdfPageAdapter {
  constructor(doc, pageIndex, meta) {
    this._doc = doc;
    this._pageIndex = pageIndex;
    this.pageNumber = pageIndex + 1;
    this._widthPt = meta.width;
    this._heightPt = meta.height;
    this._rotation = meta.rotation || 0;
    // PDFium rotation: 0/1/2/3 = 0°/90°/180°/270° CW
    this.rotate = this._rotation * 90;
  }

  // PDF.js의 getViewport({scale, rotation}) 호환
  getViewport({ scale = 1, rotation = 0 } = {}) {
    const w_pt = this._widthPt;
    const h_pt = this._heightPt;
    const r = (((rotation || 0) % 360) + 360) % 360;

    let width;
    let height;
    let transform;
    if (r === 0) {
      width = w_pt * scale;
      height = h_pt * scale;
      transform = [scale, 0, 0, -scale, 0, height];
    } else if (r === 90) {
      width = h_pt * scale;
      height = w_pt * scale;
      transform = [0, scale, scale, 0, 0, 0];
    } else if (r === 180) {
      width = w_pt * scale;
      height = h_pt * scale;
      transform = [-scale, 0, 0, scale, width, 0];
    } else {
      // 270
      width = h_pt * scale;
      height = w_pt * scale;
      transform = [0, -scale, -scale, 0, width, height];
    }
    return { width, height, transform, scale, rotation: r };
  }

  // PDF.js의 page.render({canvasContext, viewport, transform})와 동일한 인터페이스
  //   - 반환: { promise, cancel() } (PDF.js의 RenderTask와 호환)
  // intent: 'preview' — 스크롤/점프 시 저해상도 빠른 렌더, 'display' — 최종 화질
  render({ canvasContext, viewport, transform: matrixTransformArr, intent }) {
    const flag = { cancelled: false };
    const isThumbnail = intent === "thumbnail";
    const isJump = intent === "jump";
    const isPreview = intent === "preview" || isJump;
    const scaleFactor = isThumbnail ? 1 : isJump ? 0.28 : isPreview ? 0.42 : 1;
    const jpegQuality = isThumbnail ? 82 : isJump ? 62 : isPreview ? 72 : 85;

    const outputScale =
      Array.isArray(matrixTransformArr) && matrixTransformArr[0]
        ? matrixTransformArr[0]
        : 1;

    const canvas = canvasContext?.canvas;
    const targetWidthPx =
      canvas?.width || viewport.width * outputScale;
    const targetHeightPx =
      canvas?.height || viewport.height * outputScale;

    const rotQ = ((viewport.rotation || 0) / 90) % 4;
    const baseWidthPt =
      rotQ === 1 || rotQ === 3 ? this._heightPt : this._widthPt;
    const renderScale = (targetWidthPx / baseWidthPt) * scaleFactor;
    const renderFormat = "jpeg";

    const inflightKey = renderInflightKey(
      this._doc._docId,
      this._pageIndex,
      renderScale,
      renderFormat,
    );

    if (this._doc._destroyed) {
      const p = Promise.reject(new RenderingCancelledException());
      return { promise: p, cancel() {} };
    }

    let corePromise = renderInflight.get(inflightKey);
    if (!corePromise) {
      corePromise = ipcRenderer.invoke(
        "pdfium:renderPage",
        this._doc._docId,
        this._pageIndex,
        renderScale,
        {
          format: renderFormat,
          quality: jpegQuality,
        },
      );
      renderInflight.set(inflightKey, corePromise);
      corePromise.finally(() => {
        if (renderInflight.get(inflightKey) === corePromise) {
          renderInflight.delete(inflightKey);
        }
      });
    }

    const promise = (async () => {
      if (!canvasContext) {
        throw new Error("canvasContext is required");
      }
      if (!canvas) {
        throw new Error("canvas is required on canvasContext");
      }

      if (isCancelled(flag)) throw new RenderingCancelledException();

      let payload;
      try {
        payload = await corePromise;
      } catch (e) {
        if (isCancelled(flag)) throw new RenderingCancelledException();
        if (this._doc._destroyed) throw new RenderingCancelledException();
        throw e;
      }

      if (isCancelled(flag)) throw new RenderingCancelledException();
      if (this._doc._destroyed) throw new RenderingCancelledException();
      // 문서가 닫힌 뒤 도착한 IPC 응답 (Invalid docId 등)
      if (!payload) throw new RenderingCancelledException();

      const bytes = payload?.data;
      const mime = payload?.mime || "image/jpeg";
      if (!bytes || !bytes.byteLength) {
        throw new Error("pdfium:renderPage returned empty image");
      }

      let bitmap;
      try {
        const blob = new Blob([bytes], { type: mime });
        bitmap = await createImageBitmap(blob);
      } catch (e) {
        if (isCancelled(flag)) throw new RenderingCancelledException();
        throw e;
      }

      if (isCancelled(flag)) {
        try {
          bitmap.close?.();
        } catch (_) {
          /* ignore */
        }
        throw new RenderingCancelledException();
      }

      try {
        canvasContext.fillStyle = "#ffffff";
        canvasContext.fillRect(0, 0, targetWidthPx, targetHeightPx);
        canvasContext.drawImage(bitmap, 0, 0, targetWidthPx, targetHeightPx);
      } finally {
        try {
          bitmap.close?.();
        } catch (_) {
          /* ignore */
        }
      }
      void targetHeightPx;
    })();

    return {
      promise,
      cancel() {
        flag.cancelled = true;
      },
    };
  }

  // PDF.js의 page.getTextContent() 호환
  //   - PDFium의 text 객체 목록을 PDF.js 형태({items, styles})로 변환
  async getTextContent() {
    const items = [];
    const styles = {};
    if (!ipcRenderer) return { items, styles };
    let textObjs;
    try {
      textObjs = await ipcRenderer.invoke(
        "pdfium:getTextObjects",
        this._doc._docId,
        this._pageIndex,
      );
    } catch (e) {
      console.warn("getTextContent failed:", e);
      return { items, styles };
    }
    if (!Array.isArray(textObjs)) return { items, styles };
    for (const obj of textObjs) {
      const text = obj?.text;
      if (!text) continue;
      const fs =
        obj.fontSize || Math.max(1, (obj.top || 0) - (obj.bottom || 0)) || 10;
      const fontName = obj.fontName || "default";
      items.push({
        str: text,
        transform: [fs, 0, 0, fs, obj.left || 0, obj.bottom || 0],
        width: (obj.right || 0) - (obj.left || 0),
        height: (obj.top || 0) - (obj.bottom || 0),
        fontName,
      });
      if (!styles[fontName]) {
        styles[fontName] = {
          fontFamily: obj.fontFamily || fontName,
        };
      }
    }
    return { items, styles };
  }
}

// 문서 어댑터
//   - 메인 프로세스에 docId 핸들을 보관하고, 페이지 어댑터들을 캐싱
class PdfDocumentAdapter {
  constructor(docId, pageCount, firstPageMeta) {
    this._docId = docId;
    this.numPages = pageCount;
    this._destroyed = false;
    this._pageCache = new Map(); // pageIdx -> Promise<PdfPageAdapter>
    this._pageCacheOrder = [];
    if (firstPageMeta && typeof firstPageMeta.width === "number") {
      this._pageCache.set(
        0,
        Promise.resolve(new PdfPageAdapter(this, 0, firstPageMeta)),
      );
    }
  }

  _trimPageCache() {
    while (this._pageCache.size > MAX_PAGE_META_CACHE && this._pageCacheOrder.length) {
      const victim = this._pageCacheOrder.shift();
      this._pageCache.delete(victim);
    }
  }

  getPage(num) {
    if (this._destroyed) {
      return Promise.reject(new RenderingCancelledException());
    }
    const idx = num - 1;
    if (this._pageCache.has(idx)) {
      const ord = this._pageCacheOrder.indexOf(idx);
      if (ord >= 0) {
        this._pageCacheOrder.splice(ord, 1);
        this._pageCacheOrder.push(idx);
      }
      return this._pageCache.get(idx);
    }
    const promise = (async () => {
      if (this._destroyed) {
        throw new RenderingCancelledException();
      }
      if (!ipcRenderer) {
        throw new Error("ipcRenderer is not available");
      }
      const meta = await ipcRenderer.invoke(
        "pdfium:getPageMeta",
        this._docId,
        idx,
      );
      if (!meta || this._destroyed) {
        throw new RenderingCancelledException();
      }
      return new PdfPageAdapter(this, idx, meta);
    })();
    this._pageCache.set(idx, promise);
    this._pageCacheOrder.push(idx);
    this._trimPageCache();
    promise.catch(() => {
      if (this._pageCache.get(idx) === promise) {
        this._pageCache.delete(idx);
        const ord = this._pageCacheOrder.indexOf(idx);
        if (ord >= 0) this._pageCacheOrder.splice(ord, 1);
      }
    });
    return promise;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    clearRenderInflightForDoc(this._docId);
    this._pageCache.clear();
    this._pageCacheOrder = [];
    if (ipcRenderer) {
      ipcRenderer.invoke("pdfium:destroyDocument", this._docId).catch(() => {
        /* ignore */
      });
    }
  }
}

// PDF.js의 pdfjsLib.getDocument({data}).promise와 호환
//   path: 로컬 파일 경로 (Electron에서 readFile + IPC 복사 생략)
export function getDocument({ data, path: filePath } = {}) {
  const promise = (async () => {
    if (!ipcRenderer) {
      throw new Error(
        "Electron ipcRenderer is not available. Check nodeIntegration setting.",
      );
    }
    let ipcArg;
    if (typeof filePath === "string" && filePath) {
      ipcArg = filePath;
    } else {
      if (data instanceof Uint8Array) {
        ipcArg = data;
      } else if (data instanceof ArrayBuffer) {
        ipcArg = new Uint8Array(data);
      } else if (data && data.buffer instanceof ArrayBuffer) {
        ipcArg = new Uint8Array(
          data.buffer,
          data.byteOffset || 0,
          data.byteLength,
        );
      } else {
        ipcArg = new Uint8Array(data);
      }
    }
    const result = await ipcRenderer.invoke("pdfium:loadDocument", ipcArg);
    if (!result || typeof result.docId !== "number") {
      throw new Error("pdfium:loadDocument returned invalid result");
    }
    return new PdfDocumentAdapter(
      result.docId,
      result.pageCount,
      result.firstPage || null,
    );
  })();
  return { promise };
}

export async function isEngineAvailable() {
  if (!ipcRenderer) return false;
  try {
    const res = await ipcRenderer.invoke("pdfium:isAvailable");
    return !!(res && res.ok);
  } catch (_) {
    return false;
  }
}

// PDF.js의 isRenderCancelledError와 동일한 의미
export function isRenderCancelledError(err) {
  if (!err) return false;
  if (err instanceof RenderingCancelledException) return true;
  return (
    err.name === "RenderingCancelledException" ||
    /cancel/i.test(err.message || "") ||
    err.message === "Document is destroyed"
  );
}
