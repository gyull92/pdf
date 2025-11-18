// main.cjs
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os"); // ✅ 사용자 홈 디렉터리용

const isDev = !app.isPackaged;

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
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true, // renderer에서 require('electron') 사용 가능
      contextIsolation: false, // window.electronAPI 안 써도 됨
    },
  });

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
    const buffer = await fs.promises.readFile(filePath);
    return buffer;
  });

  // ✅ 🔹 renderer에서 북마크 로드 요청
  ipcMain.handle("load-bookmarks", async () => {
    const persistentPath = getPersistentBookmarksPath();

    // 1) 영구 경로에 이미 파일이 있으면 그걸 사용
    if (fs.existsSync(persistentPath)) {
      try {
        const raw = await fs.promises.readFile(persistentPath, "utf-8");
        return JSON.parse(raw);
      } catch (e) {
        console.error("북마크 읽기 실패(영구 경로):", e);
        return [];
      }
    }

    // 2) 없으면 (한 번만) 옛날 경로에서 가져와서 옮기기
    const legacyPath = getLegacyBookmarksPath();
    if (fs.existsSync(legacyPath)) {
      try {
        const raw = await fs.promises.readFile(legacyPath, "utf-8");
        const data = JSON.parse(raw);
        await fs.promises.writeFile(
          persistentPath,
          JSON.stringify(data, null, 2),
          "utf-8"
        );
        return data;
      } catch (e) {
        console.error("북마크 마이그레이션 실패:", e);
        return [];
      }
    }

    // 3) 둘 다 없으면 빈 배열
    return [];
  });

  // ✅ 🔹 renderer에서 북마크 저장 요청
  ipcMain.on("save-bookmarks", async (event, bookmarks) => {
    const persistentPath = getPersistentBookmarksPath();
    try {
      await fs.promises.writeFile(
        persistentPath,
        JSON.stringify(bookmarks, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.error("북마크 저장 실패:", e);
    }
  });

  // ✅ 🔹 renderer에서 폴더 로드 요청
  ipcMain.handle("load-folders", async () => {
    const foldersPath = getPersistentFoldersPath();

    if (!fs.existsSync(foldersPath)) {
      return []; // 폴더 정보 없으면 빈 배열
    }

    try {
      const raw = await fs.promises.readFile(foldersPath, "utf-8");
      const data = JSON.parse(raw);
      // 혹시 배열이 아니면 비우기
      if (!Array.isArray(data)) return [];
      return data;
    } catch (e) {
      console.error("폴더 읽기 실패:", e);
      return [];
    }
  });

  // ✅ 🔹 renderer에서 폴더 저장 요청
  ipcMain.on("save-folders", async (event, folders) => {
    const foldersPath = getPersistentFoldersPath();
    try {
      await fs.promises.writeFile(
        foldersPath,
        JSON.stringify(folders, null, 2),
        "utf-8"
      );
    } catch (e) {
      console.error("폴더 저장 실패:", e);
    }
  });
}
