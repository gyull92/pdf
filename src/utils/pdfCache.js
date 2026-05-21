// 🔹 PDF 렌더링 결과를 IndexedDB에 영구 캐싱
// - 같은 PDF + 같은 scale/DPR로 다시 열 때 PDF.js 호출 없이 즉시 표시
// - 저장 항목: 렌더 이미지(Blob/JPEG) + 텍스트 레이어 데이터 + 페이지 메타
// - 한도 초과 시 가장 오래 쓰지 않은 페이지부터 삭제(LRU)

const DB_NAME = "gyul-pdf-cache";
const DB_VERSION = 2;
const STORE_RENDERS = "renders";
const STORE_DOC_META = "docMeta";
const STORE_THUMBS = "thumbs";

// 캐시 한도 (대략). 사용자의 디스크 상황에 맞게 조정.
const MAX_CACHE_BYTES = 800 * 1024 * 1024; // 800MB

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RENDERS)) {
        const store = db.createObjectStore(STORE_RENDERS);
        store.createIndex("docKey", "docKey", { unique: false });
        store.createIndex("lastAccess", "lastAccess", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DOC_META)) {
        db.createObjectStore(STORE_DOC_META);
      }
      // v2: 썸네일 전용 저장소
      if (!db.objectStoreNames.contains(STORE_THUMBS)) {
        const tStore = db.createObjectStore(STORE_THUMBS);
        tStore.createIndex("docKey", "docKey", { unique: false });
      }
      void event;
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const complete = new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
    return { store, complete };
  });
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 캐시 사용량 추정 (장기 누적되면 정리)
let approxBytes = -1;
async function getApproxBytes() {
  if (approxBytes >= 0) return approxBytes;
  try {
    const { store } = await tx(STORE_RENDERS, "readonly");
    let total = 0;
    await new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) {
          resolve();
          return;
        }
        total += cur.value?.size || 0;
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    approxBytes = total;
  } catch (_) {
    approxBytes = 0;
  }
  return approxBytes;
}

async function evictLRU(targetBytes) {
  try {
    const { store, complete } = await tx(STORE_RENDERS, "readwrite");
    const idx = store.index("lastAccess");
    let freed = 0;
    await new Promise((resolve, reject) => {
      const req = idx.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) {
          resolve();
          return;
        }
        if (freed >= targetBytes) {
          resolve();
          return;
        }
        freed += cur.value?.size || 0;
        cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await complete;
    approxBytes = Math.max(0, approxBytes - freed);
  } catch (e) {
    console.warn("캐시 evict 실패:", e);
  }
}

export const pdfCache = {
  async getRender(key) {
    try {
      const { store } = await tx(STORE_RENDERS, "readonly");
      const value = await reqAsPromise(store.get(key));
      if (!value) return null;
      // lastAccess 갱신은 별도 트랜잭션
      this._touchAsync(key).catch(() => {});
      return value;
    } catch (_) {
      return null;
    }
  },

  async _touchAsync(key) {
    try {
      const { store, complete } = await tx(STORE_RENDERS, "readwrite");
      const value = await reqAsPromise(store.get(key));
      if (value) {
        value.lastAccess = Date.now();
        store.put(value, key);
      }
      await complete;
    } catch (_) {
      /* ignore */
    }
  },

  async setRender(key, payload) {
    try {
      const size =
        (payload?.imageBlob?.size || 0) +
        (payload?.textLayer?.length || 0) * 32; // 대략 추정
      const value = {
        ...payload,
        size,
        lastAccess: Date.now(),
      };

      // 용량 한도 체크
      const current = await getApproxBytes();
      if (current + size > MAX_CACHE_BYTES) {
        await evictLRU(Math.min(MAX_CACHE_BYTES / 4, size * 4));
      }

      const { store, complete } = await tx(STORE_RENDERS, "readwrite");
      store.put(value, key);
      await complete;
      if (approxBytes >= 0) approxBytes += size;
    } catch (e) {
      // QuotaExceededError 등은 조용히 무시
      console.warn("렌더 캐시 저장 실패:", e);
    }
  },

  async clearByDocKey(docKey) {
    try {
      const { store, complete } = await tx(STORE_RENDERS, "readwrite");
      const idx = store.index("docKey");
      const range = IDBKeyRange.only(docKey);
      await new Promise((resolve, reject) => {
        const req = idx.openCursor(range);
        req.onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) {
            resolve();
            return;
          }
          cur.delete();
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
      await complete;
      approxBytes = -1; // 다시 측정
    } catch (e) {
      console.warn("문서별 캐시 삭제 실패:", e);
    }
  },

  async getDocMeta(docKey) {
    try {
      const { store } = await tx(STORE_DOC_META, "readonly");
      return await reqAsPromise(store.get(docKey));
    } catch (_) {
      return null;
    }
  },

  async setDocMeta(docKey, meta) {
    try {
      const { store, complete } = await tx(STORE_DOC_META, "readwrite");
      store.put({ ...meta, lastAccess: Date.now() }, docKey);
      await complete;
    } catch (e) {
      console.warn("문서 메타 캐시 저장 실패:", e);
    }
  },

  // 🔹 썸네일 - 작은 dataURL을 docKey별로 보관
  async getThumb(docKey, pageNum) {
    try {
      const { store } = await tx(STORE_THUMBS, "readonly");
      const value = await reqAsPromise(store.get(`${docKey}|p=${pageNum}`));
      return value?.dataUrl || null;
    } catch (_) {
      return null;
    }
  },

  async getThumbsForDoc(docKey, totalPages) {
    const result = new Array(totalPages).fill(null);
    try {
      const { store, complete } = await tx(STORE_THUMBS, "readonly");
      const idx = store.index("docKey");
      const range = IDBKeyRange.only(docKey);
      await new Promise((resolve, reject) => {
        const req = idx.openCursor(range);
        req.onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) {
            resolve();
            return;
          }
          const v = cur.value;
          const p = v?.pageNum;
          if (p && p >= 1 && p <= totalPages && v.dataUrl) {
            result[p - 1] = v.dataUrl;
          }
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
      await complete;
    } catch (_) {
      /* ignore */
    }
    return result;
  },

  async setThumb(docKey, pageNum, dataUrl) {
    try {
      const { store, complete } = await tx(STORE_THUMBS, "readwrite");
      store.put(
        { docKey, pageNum, dataUrl, lastAccess: Date.now() },
        `${docKey}|p=${pageNum}`,
      );
      await complete;
    } catch (e) {
      console.warn("썸네일 캐시 저장 실패:", e);
    }
  },

  async clearAll() {
    try {
      const { store: s1, complete: c1 } = await tx(
        STORE_RENDERS,
        "readwrite",
      );
      s1.clear();
      await c1;
      const { store: s2, complete: c2 } = await tx(
        STORE_DOC_META,
        "readwrite",
      );
      s2.clear();
      await c2;
      const { store: s3, complete: c3 } = await tx(
        STORE_THUMBS,
        "readwrite",
      );
      s3.clear();
      await c3;
      approxBytes = 0;
    } catch (e) {
      console.warn("캐시 전체 삭제 실패:", e);
    }
  },
};

// 문서를 식별하는 키
//   - filePath가 있으면 그것을 사용 (윈도우/맥 절대경로)
//   - 없으면 파일명으로 fallback
//   - byteLength가 있으면 같은 경로의 다른 사이즈 파일을 구분
export function makeDocKey({ filePath, fileName, byteLength }) {
  const base = filePath || fileName || "unknown";
  return byteLength ? `${base}|len=${byteLength}` : base;
}

// 페이지별 렌더 키
export function makeRenderKey(docKey, pageNum, scale, dpr) {
  return `${docKey}|p=${pageNum}|s=${scale.toFixed(3)}|d=${dpr.toFixed(2)}`;
}
