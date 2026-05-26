// main.cjs
const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { autoUpdater } = require("electron-updater");

// 🔹 PDFium 렌더 결과를 임시 파일로 받기 위한 디렉터리
//    pdfium-native가 JS에 직접 반환하는 Buffer는 external buffer라서
//    V8 IPC 직렬화가 거부함. 우회: 파일에 PNG를 쓰고 fs.readFile로 일반 Buffer를 얻는다.
const PDFIUM_TMP_DIR = path.join(os.tmpdir(), "gyul-pdf-render");
try {
  fs.mkdirSync(PDFIUM_TMP_DIR, { recursive: true });
  // 앱 시작 시 이전 세션의 잔여 파일 청소 (비동기로 처리)
  fs.promises
    .readdir(PDFIUM_TMP_DIR)
    .then((files) =>
      Promise.all(
        files.map((f) =>
          fs.promises.unlink(path.join(PDFIUM_TMP_DIR, f)).catch(() => {}),
        ),
      ),
    )
    .catch(() => {});
} catch (_) {
  /* ignore */
}

const isDev = !app.isPackaged;

// Windows: 창 가림(occlusion) 계산이 스크롤 프레임을 끊기는 경우가 있어 비활성화
if (process.platform === "win32") {
  app.commandLine.appendSwitch(
    "disable-features",
    "CalculateNativeWinOcclusion",
  );
}

// 🔹 PDFium 네이티브 엔진 (ESM 패키지이므로 dynamic import 사용)
//    렌더러는 IPC로만 호출하며, 무거운 PDF 작업은 모두 main 프로세스에서 수행됨
//    (Edge/Chrome과 동일한 아키텍처)
let pdfiumMod = null;
let pdfiumError = null;
const pdfiumReady = (async () => {
  try {
    pdfiumMod = await import("pdfium-native");
    // 동시 작업 수 설정 — PDFium 내부는 mutex 직렬화이므로 너무 크게 늘려도 효과는 한계
    try {
      const cores = os.cpus()?.length || 4;
      const target = Math.max(2, Math.min(8, Math.floor(cores * 0.75)));
      pdfiumMod.concurrency(target);
    } catch (_) {
      /* ignore concurrency setup failure */
    }
  } catch (e) {
    pdfiumError = e;
    console.error("[pdfium-native] load failed:", e);
  }
})();

// 문서 핸들 저장소: docId → { doc, pages, pageLru }
const pdfDocs = new Map();
let pdfDocIdSeq = 0;
// 문서당 메인 프로세스에 유지할 PDFium 페이지 핸들 상한 (16GB RAM)
const MAX_CACHED_PAGES_PER_DOC = 48;

function touchPageLru(entry, pageIndex) {
  if (!entry.pageLru) entry.pageLru = [];
  const i = entry.pageLru.indexOf(pageIndex);
  if (i >= 0) entry.pageLru.splice(i, 1);
  entry.pageLru.push(pageIndex);
}

function evictPagesIfNeeded(entry) {
  while (
    entry.pages.size > MAX_CACHED_PAGES_PER_DOC &&
    entry.pageLru &&
    entry.pageLru.length > 0
  ) {
    const victim = entry.pageLru.shift();
    const page = entry.pages.get(victim);
    if (!page) continue;
    try {
      page.close?.();
    } catch (_) {
      /* ignore */
    }
    entry.pages.delete(victim);
  }
}

async function ensurePdfium() {
  await pdfiumReady;
  if (!pdfiumMod) {
    throw new Error(
      "pdfium-native 로드 실패: " + (pdfiumError?.message || "unknown"),
    );
  }
  return pdfiumMod;
}

// 문서가 이미 destroy된 뒤 도착한 IPC 요청용 (에러 로그 없이 조용히 무시)
class DocGoneError extends Error {
  constructor(docId) {
    super(`docId ${docId} no longer exists`);
    this.name = "DocGoneError";
  }
}

async function getOrOpenPage(docId, pageIndex) {
  const entry = pdfDocs.get(docId);
  if (!entry) throw new DocGoneError(docId);
  let page = entry.pages.get(pageIndex);
  if (!page) {
    page = await entry.doc.getPage(pageIndex);
    entry.pages.set(pageIndex, page);
    touchPageLru(entry, pageIndex);
    evictPagesIfNeeded(entry);
  } else {
    touchPageLru(entry, pageIndex);
  }
  return page;
}

function destroyPdfDoc(docId) {
  const entry = pdfDocs.get(docId);
  if (!entry) return;
  for (const page of entry.pages.values()) {
    try {
      page.close?.();
    } catch (_) {
      /* ignore */
    }
  }
  try {
    entry.doc.destroy?.();
  } catch (_) {
    /* ignore */
  }
  pdfDocs.delete(docId);
}

let mainWindow = null;
// OS에서 넘겨준 "현재(또는 마지막) PDF 경로"를 보관
let initialPdfPath = null;

// ✅ 공통: 영구 데이터 저장용 디렉터리
function getPersistentDataDir() {
  // 예: C:\Users\유저명\GyulPDF  또는  /Users/유저명/GyulPDF
  const home = os.homedir();
  const dir = path.join(home, "GyulPDF");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ✅ 북마크 JSON 파일 경로
function getPersistentBookmarksPath() {
  return path.join(getPersistentDataDir(), "bookmarks.json");
}

// ✅ 폴더 JSON 파일 경로
function getPersistentFoldersPath() {
  return path.join(getPersistentDataDir(), "folders.json");
}

// (선택) 예전 버전에서 userData 아래에 bookmarks.json을 썼다면, 한 번 옮겨오기
function getLegacyBookmarksPath() {
  const userData = app.getPath("userData");
  return path.join(userData, "bookmarks.json");
}

// 🔹 argv에서 .pdf 경로만 뽑는 함수 (윈도우/리눅스용)
//   argv[0] = exe 경로, argv[1..] = 인자들
function extractPdfFromArgv(argv) {
  const args = argv.slice(1);
  const pdfArg = args.find(
    (arg) => typeof arg === "string" && arg.toLowerCase().endsWith(".pdf")
  );
  return pdfArg || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon:
      process.platform === "darwin"
        ? path.join(__dirname, "..", "assets", "mandarinPDF3.icns") // 🧡 mac용 아이콘 (있으면)
        : path.join(__dirname, "..", "assets", "mandarinPDF3.ico"), // 🧡 win용 아이콘
    autoHideMenuBar: true, // 창 메뉴바 자동 숨김
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: true, // renderer에서 require('electron') 사용 가능
      contextIsolation: false, // window.electronAPI 안 써도 됨
      // 🔹 창이 가려져 있거나 최소화되어도 렌더러의 timer/requestAnimationFrame이 정상 동작하도록
      //    백그라운드 throttling 해제 (PDF 페이지 백그라운드 렌더링용)
      backgroundThrottling: false,
    },
  });

  // 🔹 보조 보강: 일부 Chromium 정책이 throttling을 다시 켜는 경우를 대비해
  //    webContents 레벨에서도 명시적으로 false 설정
  try {
    mainWindow.webContents.setBackgroundThrottling(false);
  } catch (_) {
    /* 일부 버전에서 미지원이면 무시 */
  }

  // 혹시 모를 경우를 위해 한 번 더 확실하게 숨기기
  mainWindow.setMenuBarVisibility(false);
  // mainWindow.removeMenu();

  if (isDev) {
    // ✅ 개발 모드: Vite dev 서버
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    // ✅ 배포 모드: 빌드된 정적 파일 로드
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    mainWindow.loadFile(indexPath);
  }
}

// 🔹 단일 인스턴스 락 (이미 실행 중일 때 또 더블클릭했을 때 처리용)
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // 🔹 전역 앱 메뉴 제거 (macOS 상단 메뉴 포함)
  Menu.setApplicationMenu(null);

  // 🔹 macOS: Finder에서 PDF 더블클릭 / Dock 아이콘에 드래그해서 열 때
  //   - 앱이 아직 안 켜진 상태면: initialPdfPath 에 저장했다가 나중에 렌더러가 가져감
  //   - 이미 켜진 상태면: 바로 renderer로 "open-pdf-from-os" 보내줌
  app.on("open-file", (event, filePath) => {
    event.preventDefault();

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send("open-pdf-from-os", filePath);
    } else {
      // 아직 창이 없으면, 나중에 get-initial-pdf-path에서 쓸 수 있도록 보관
      initialPdfPath = filePath;
    }
  });

  // 👉 두 번째 인스턴스로 실행하려고 할 때
  //    (이미 앱이 켜져 있는 상태에서 다른 pdf 더블클릭: 윈도우/리눅스 주로 해당)
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    const newPdfPath = extractPdfFromArgv(commandLine);

    if (newPdfPath) {
      initialPdfPath = newPdfPath; // 가장 최근 파일로 갱신

      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();

        // renderer(React) 쪽으로 "이 파일 열어" 이벤트 전송
        mainWindow.webContents.send("open-pdf-from-os", newPdfPath);
      }
    }
  });

  app.whenReady().then(() => {
    // 🔹 앱 최초 실행 시, OS에서 넘겨준 PDF 경로 읽기
    const pdfFromArgv = extractPdfFromArgv(process.argv);
    if (pdfFromArgv) {
      initialPdfPath = pdfFromArgv;
    }

    createWindow();

    // macOS 관례: dock 아이콘 눌렀을 때 창 다시 열기
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    // 🔹 자동 업데이트: 배포 빌드에서만 동작
    if (!isDev) {
      initAutoUpdater();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // 🔹 renderer에서 "시작할 때 OS가 넘겨준 PDF 경로가 뭐였는지" 물어볼 때
  ipcMain.handle("get-initial-pdf-path", () => {
    return initialPdfPath; // string | null
  });

  // 🔹 renderer에서 "이 경로의 PDF 파일 내용을 읽어줘"라고 요청할 때
  ipcMain.handle("read-pdf-file", async (event, filePath) => {
    if (typeof filePath !== "string" || !filePath) {
      throw new Error("invalid file path");
    }
    if (!filePath.toLowerCase().endsWith(".pdf")) {
      throw new Error("only .pdf files are allowed");
    }
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        throw new Error("not a regular file");
      }
    } catch (e) {
      throw new Error(`PDF 파일을 찾을 수 없습니다: ${e.message}`);
    }
    return fs.promises.readFile(filePath);
  });

  // 안전한 JSON 파싱 + 배열 강제
  function safeReadJsonArray(filePath) {
    return fs.promises
      .readFile(filePath, "utf-8")
      .then((raw) => {
        try {
          const data = JSON.parse(raw);
          return Array.isArray(data) ? data : [];
        } catch (e) {
          console.warn(`JSON 파싱 실패(${filePath}):`, e);
          return [];
        }
      })
      .catch(() => []);
  }

  // 원자적 파일 쓰기 (임시 파일 → rename) + 직렬화
  const writeQueues = new Map();
  function atomicWriteJson(filePath, data) {
    const prev = writeQueues.get(filePath) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        const tmpPath = `${filePath}.tmp-${process.pid}`;
        try {
          await fs.promises.writeFile(
            tmpPath,
            JSON.stringify(data, null, 2),
            "utf-8",
          );
          await fs.promises.rename(tmpPath, filePath);
        } catch (e) {
          console.error(`저장 실패(${filePath}):`, e);
          try {
            await fs.promises.unlink(tmpPath);
          } catch (_) {
            /* ignore */
          }
        }
      });
    writeQueues.set(filePath, next);
    return next;
  }

  // ✅ 🔹 renderer에서 북마크 로드 요청
  ipcMain.handle("load-bookmarks", async () => {
    const persistentPath = getPersistentBookmarksPath();

    if (fs.existsSync(persistentPath)) {
      return safeReadJsonArray(persistentPath);
    }

    const legacyPath = getLegacyBookmarksPath();
    if (fs.existsSync(legacyPath)) {
      const data = await safeReadJsonArray(legacyPath);
      await atomicWriteJson(persistentPath, data);
      return data;
    }

    return [];
  });

  // ✅ 🔹 renderer에서 북마크 저장 요청
  ipcMain.on("save-bookmarks", (event, bookmarks) => {
    if (!Array.isArray(bookmarks)) return;
    atomicWriteJson(getPersistentBookmarksPath(), bookmarks);
  });

  // ✅ 🔹 renderer에서 폴더 로드 요청
  ipcMain.handle("load-folders", async () => {
    const foldersPath = getPersistentFoldersPath();
    if (!fs.existsSync(foldersPath)) return [];
    return safeReadJsonArray(foldersPath);
  });

  // ✅ 🔹 renderer에서 폴더 저장 요청
  ipcMain.on("save-folders", (event, folders) => {
    if (!Array.isArray(folders)) return;
    atomicWriteJson(getPersistentFoldersPath(), folders);
  });

  // ============================================================
  // 🔹 PDFium IPC 핸들러
  //    렌더러의 pdfEngine.js 어댑터에서 호출
  //    모든 무거운 PDF 작업이 main 프로세스에서 수행됨
  // ============================================================

  const safeHandle = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (e) {
        if (e instanceof DocGoneError) return null;
        console.error(`[pdfium] ${channel}:`, e?.message || e);
        throw new Error(`${channel}: ${e?.message || String(e)}`);
      }
    });
  };

  // 문서 열기 — 결과: { docId, pageCount, firstPage? }
  //   path 문자열이면 디스크에서 직접 열기 (렌더러로 전체 파일 복사 생략)
  safeHandle("pdfium:loadDocument", async (event, dataArg) => {
    const pdfium = await ensurePdfium();
    let doc;
    if (typeof dataArg === "string") {
      doc = await pdfium.loadDocument(dataArg);
    } else {
      let buf;
      if (Buffer.isBuffer(dataArg)) {
        buf = dataArg;
      } else if (dataArg instanceof Uint8Array) {
        buf = Buffer.from(dataArg.buffer, dataArg.byteOffset, dataArg.byteLength);
      } else if (dataArg instanceof ArrayBuffer) {
        buf = Buffer.from(dataArg);
      } else {
        buf = Buffer.from(dataArg);
      }
      doc = await pdfium.loadDocument(buf);
    }
    const docId = ++pdfDocIdSeq;
    const pages = new Map();
    pdfDocs.set(docId, { doc, pages, pageLru: [] });

    let firstPage = null;
    try {
      const page = await doc.getPage(0);
      pages.set(0, page);
      firstPage = {
        width: Number(page.width),
        height: Number(page.height),
        rotation: Number(page.rotation || 0),
      };
    } catch (_) {
      /* ignore */
    }

    const pageCount = Number(doc.pageCount) | 0;
    return { docId, pageCount, firstPage };
  });

  // 페이지 메타 조회 — 결과: { width, height, rotation, objectCount }
  safeHandle("pdfium:getPageMeta", async (event, docId, pageIndex) => {
    const page = await getOrOpenPage(docId, pageIndex);
    if (!page) return null;
    return {
      width: Number(page.width),
      height: Number(page.height),
      rotation: Number(page.rotation || 0),
      objectCount: Number(page.objectCount || 0),
    };
  });

  // 페이지 렌더 — 임시 파일 경유 후 Uint8Array로 반환 (external buffer 회피)
  //   options: { format?: 'jpeg'|'png', quality?: 1-100 }
  safeHandle(
    "pdfium:renderPage",
    async (event, docId, pageIndex, scale, options = {}) => {
      const page = await getOrOpenPage(docId, pageIndex);
      if (!page) return null;
      const format = options.format === "png" ? "png" : "jpeg";
      const quality =
        typeof options.quality === "number" ? options.quality : 85;
      const ext = format === "png" ? "png" : "jpg";

      const rand = crypto.randomBytes(6).toString("hex");
      const outPath = path.join(
        PDFIUM_TMP_DIR,
        `r${docId}-${pageIndex}-${rand}.${ext}`,
      );

      try {
        await page.render({
          scale,
          format,
          quality,
          output: outPath,
        });
      } catch (e) {
        fs.promises.unlink(outPath).catch(() => {});
        throw e;
      }

      let buf;
      try {
        buf = await fs.promises.readFile(outPath);
      } finally {
        fs.promises.unlink(outPath).catch(() => {});
      }

      // fs.readFile Buffer → 복사된 Uint8Array (IPC structured clone 안전, base64보다 훨씬 빠름)
      return {
        mime: format === "png" ? "image/png" : "image/jpeg",
        data: new Uint8Array(buf),
      };
    },
  );

  // 페이지 텍스트 객체 추출 — 결과: 텍스트 객체 배열
  //   [{ text, left, bottom, right, top, fontSize, fontName, fontFamily? }]
  safeHandle("pdfium:getTextObjects", async (event, docId, pageIndex) => {
    const page = await getOrOpenPage(docId, pageIndex);
    if (!page) return [];
    const out = [];
    try {
      for await (const obj of page.objects()) {
        if (!obj || obj.type !== "text") continue;
        const text = obj.text;
        if (!text) continue;
        const b = obj.bounds || { left: 0, bottom: 0, right: 0, top: 0 };
        out.push({
          text: String(text),
          left: Number(b.left),
          bottom: Number(b.bottom),
          right: Number(b.right),
          top: Number(b.top),
          fontSize: Number(obj.fontSize || 0),
          fontName: String(obj.fontName || "default"),
          fontFamily: obj.fontFamily ? String(obj.fontFamily) : null,
        });
      }
    } catch (e) {
      console.warn("[pdfium] getTextObjects failed:", e);
    }
    return out;
  });

  // 문서 종료
  safeHandle("pdfium:destroyDocument", async (event, docId) => {
    destroyPdfDoc(docId);
    return true;
  });

  // 진단/헬스체크용
  safeHandle("pdfium:isAvailable", async () => {
    try {
      await ensurePdfium();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ============================================================
  // 🔹 자동 업데이트 (electron-updater)
  // ============================================================
  function initAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("update-available", (info) => {
      const version = info.version || "새 버전";
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "업데이트 알림",
          message: `새 버전(v${version})이 있습니다.\n지금 업데이트할까요?`,
          buttons: ["업데이트", "나중에"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) {
            autoUpdater.downloadUpdate();
            if (mainWindow) {
              mainWindow.webContents.send("update-downloading", true);
            }
          }
        });
    });

    autoUpdater.on("update-not-available", () => {
      // 최신 버전 — 아무것도 안 함
    });

    autoUpdater.on("download-progress", (progress) => {
      if (mainWindow) {
        mainWindow.setProgressBar(progress.percent / 100);
      }
    });

    autoUpdater.on("update-downloaded", () => {
      if (mainWindow) {
        mainWindow.setProgressBar(-1);
      }
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "업데이트 준비 완료",
          message:
            "업데이트가 다운로드되었습니다.\n지금 재시작하여 설치할까요?",
          buttons: ["지금 재시작", "나중에"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
    });

    autoUpdater.on("error", (err) => {
      console.error("자동 업데이트 오류:", err?.message || err);
    });

    // 앱 시작 5초 후 업데이트 확인 (시작 성능에 영향 주지 않도록)
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn("업데이트 확인 실패:", err?.message || err);
      });
    }, 5000);
  }
}
