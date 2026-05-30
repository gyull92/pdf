// 🔹 PDF 렌더링 결과를 IndexedDB에 영구 캐싱
// - 같은 PDF + 같은 scale/DPR로 다시 열 때 PDF.js 호출 없이 즉시 표시
// - 저장 항목: 렌더 이미지(Blob/JPEG) + 텍스트 레이어 데이터 + 페이지 메타
// - 한도 초과 시 가장 오래 쓰지 않은 페이지부터 삭제(LRU)

const DB_NAME = "gyul-pdf-cache";
const DB_VERSION = 3;
const STORE_RENDERS = "renders";
const STORE_DOC_META = "docMeta";
const STORE_THUMBS = "thumbs";
// 썸네일 해상도 변경 시 키 버전을 올려 기존 저해상도 캐시 무효화
const THUMB_CACHE_KEY_VERSION = 3;

// 16GB RAM 환경: 디스크 캐시도 과도하면 getRender/getThumbs 시 RAM 급증
export const MAX_RENDER_CACHE_BYTES = 400 * 1024 * 1024;
export const MAX_THUMB_CACHE_BYTES = 120 * 1024 * 1024;

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
      if (!db.objectStoreNames.contains(STORE_THUMBS)) {
        const tStore = db.createObjectStore(STORE_THUMBS);
        tStore.createIndex("docKey", "docKey", { unique: false });
        tStore.createIndex("lastAccess", "lastAccess", { unique: false });
      } else {
        const tStore = event.target.transaction.objectStore(STORE_THUMBS);
        if (!tStore.indexNames.contains("lastAccess")) {
          tStore.createIndex("lastAccess", "lastAccess", { unique: false });
        }
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

let approxRenderBytes = -1;
let approxThumbBytes = -1;

async function sumStoreBytes(storeName, sizeField = "size") {
  const { store } = await tx(storeName, "readonly");
  let total = 0;
  await new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) {
        resolve();
        return;
      }
      const v = cur.value;
      if (sizeField === "size") {
        total += v?.size || 0;
      } else {
        total += v?.dataUrl?.length || 0;
      }
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return total;
}

async function getApproxRenderBytes() {
  if (approxRenderBytes >= 0) return approxRenderBytes;
  try {
    approxRenderBytes = await sumStoreBytes(STORE_RENDERS, "size");
  } catch (_) {
    approxRenderBytes = 0;
  }
  return approxRenderBytes;
}

async function getApproxThumbBytes() {
  if (approxThumbBytes >= 0) return approxThumbBytes;
  try {
    approxThumbBytes = await sumStoreBytes(STORE_THUMBS, "dataUrl");
  } catch (_) {
    approxThumbBytes = 0;
  }
  return approxThumbBytes;
}

async function evictRenderLRU(targetBytes) {
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
    if (approxRenderBytes >= 0) approxRenderBytes = Math.max(0, approxRenderBytes - freed);
  } catch (e) {
    console.warn("렌더 캐시 evict 실패:", e);
  }
}

async function evictThumbLRU(targetBytes) {
  try {
    const { store, complete } = await tx(STORE_THUMBS, "readwrite");
    let idx = store.index("lastAccess");
    if (!idx) idx = store;
    let freed = 0;
    await new Promise((resolve, reject) => {
      const req = idx.openCursor ? idx.openCursor() : store.openCursor();
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
        freed += cur.value?.dataUrl?.length || 0;
        cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    await complete;
    if (approxThumbBytes >= 0) approxThumbBytes = Math.max(0, approxThumbBytes - freed);
  } catch (e) {
    console.warn("썸네일 캐시 evict 실패:", e);
  }
}

async function deleteByDocKeyIndex(storeName, docKey) {
  const { store, complete } = await tx(storeName, "readwrite");
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
}

export const pdfCache = {
  async getRender(key) {
    try {
      const { store } = await tx(STORE_RENDERS, "readonly");
      const value = await reqAsPromise(store.get(key));
      if (!value) return null;
      this._touchRenderAsync(key).catch(() => {});
      return value;
    } catch (_) {
      return null;
    }
  },

  async _touchRenderAsync(key) {
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
        (payload?.textLayer?.length || 0) * 32;
      const value = {
        ...payload,
        size,
        lastAccess: Date.now(),
      };

      let current = await getApproxRenderBytes();
      while (current + size > MAX_RENDER_CACHE_BYTES) {
        await evictRenderLRU(Math.max(MAX_RENDER_CACHE_BYTES / 8, size * 2));
        approxRenderBytes = -1;
        current = await getApproxRenderBytes();
        if (current === 0) break;
      }

      const { store, complete } = await tx(STORE_RENDERS, "readwrite");
      store.put(value, key);
      await complete;
      if (approxRenderBytes >= 0) approxRenderBytes += size;
      else approxRenderBytes = -1;
    } catch (e) {
      console.warn("렌더 캐시 저장 실패:", e);
    }
  },

  async clearByDocKey(docKey) {
    await this.clearDocCache(docKey);
  },

  async clearDocCache(docKey) {
    if (!docKey) return;
    try {
      await deleteByDocKeyIndex(STORE_RENDERS, docKey);
      await deleteByDocKeyIndex(STORE_THUMBS, docKey);
      approxRenderBytes = -1;
      approxThumbBytes = -1;
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

  thumbCacheKey(docKey, pageNum) {
    return `${docKey}|v=${THUMB_CACHE_KEY_VERSION}|p=${pageNum}`;
  },

  async getThumb(docKey, pageNum) {
    try {
      const { store } = await tx(STORE_THUMBS, "readonly");
      const value = await reqAsPromise(
        store.get(this.thumbCacheKey(docKey, pageNum)),
      );
      if (value?.dataUrl) {
        this._touchThumbAsync(docKey, pageNum).catch(() => {});
      }
      return value?.dataUrl || null;
    } catch (_) {
      return null;
    }
  },

  async _touchThumbAsync(docKey, pageNum) {
    try {
      const key = this.thumbCacheKey(docKey, pageNum);
      const { store, complete } = await tx(STORE_THUMBS, "readwrite");
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

  /** 현재 페이지 주변만 IDB에서 읽어 RAM 부담 완화 */
  async getThumbsInRange(docKey, lo, hi) {
    const result = new Map();
    const tasks = [];
    for (let p = lo; p <= hi; p++) {
      tasks.push(
        this.getThumb(docKey, p).then((url) => {
          if (url) result.set(p, url);
        }),
      );
    }
    await Promise.all(tasks);
    return result;
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
          const pk = cur.primaryKey;
          if (
            typeof pk === "string" &&
            !pk.includes(`|v=${THUMB_CACHE_KEY_VERSION}|`)
          ) {
            cur.continue();
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

  async deleteThumb(docKey, pageNum) {
    try {
      const key = this.thumbCacheKey(docKey, pageNum);
      const { store, complete } = await tx(STORE_THUMBS, "readwrite");
      const existing = await reqAsPromise(store.get(key));
      await reqAsPromise(store.delete(key));
      await complete;
      if (existing?.size && approxThumbBytes >= 0) {
        approxThumbBytes = Math.max(0, approxThumbBytes - existing.size);
      } else {
        approxThumbBytes = -1;
      }
    } catch (_) {
      /* ignore */
    }
  },

  async setThumb(docKey, pageNum, dataUrl) {
    try {
      const size = dataUrl?.length || 0;
      let current = await getApproxThumbBytes();
      while (current + size > MAX_THUMB_CACHE_BYTES) {
        await evictThumbLRU(Math.max(MAX_THUMB_CACHE_BYTES / 6, size * 2));
        approxThumbBytes = -1;
        current = await getApproxThumbBytes();
        if (current === 0) break;
      }

      const { store, complete } = await tx(STORE_THUMBS, "readwrite");
      store.put(
        { docKey, pageNum, dataUrl, size, lastAccess: Date.now() },
        this.thumbCacheKey(docKey, pageNum),
      );
      await complete;
      if (approxThumbBytes >= 0) approxThumbBytes += size;
      else approxThumbBytes = -1;
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
      approxRenderBytes = 0;
      approxThumbBytes = 0;
    } catch (e) {
      console.warn("캐시 전체 삭제 실패:", e);
    }
  },
};

export function makeDocKey({ filePath, fileName, byteLength }) {
  const base = filePath || fileName || "unknown";
  return byteLength ? `${base}|len=${byteLength}` : base;
}

export function makeRenderKey(docKey, pageNum, scale, dpr) {
  return `${docKey}|p=${pageNum}|s=${scale.toFixed(3)}|d=${dpr.toFixed(2)}`;
}
