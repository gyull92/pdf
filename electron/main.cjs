// main.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const isDev = !app.isPackaged;

let mainWindow = null;
let initialPdfPath = null;

// 🔹 argv에서 .pdf 경로만 뽑는 함수
function extractPdfFromArgv(argv) {
  // argv[0] = exe 경로, argv[1..] = 인자들
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
    icon: path.join(__dirname, "..", "assets", "mandarinPDF3.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true, // renderer에서 require('electron') 사용 가능
      contextIsolation: false, // window.electronAPI 안 써도 됨
    },
  });

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
  // 👉 두 번째 인스턴스로 실행하려고 할 때 (이미 앱이 켜져 있는 상태에서 다른 pdf 더블클릭)
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
    // 🔹 앱 최초 실행 시, OS에서 넘겨준 PDF 경로 한 번 읽어두기
    initialPdfPath = extractPdfFromArgv(process.argv);
    console.log("initialPdfPath:", initialPdfPath);

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

  // 🔹 renderer에서 "시작할 때 어떤 PDF로 실행됐는지" 물어볼 때
  ipcMain.handle("get-initial-pdf-path", () => {
    return initialPdfPath; // string | null
  });

  // 🔹 renderer에서 "이 경로의 PDF 파일 내용을 읽어줘"라고 요청할 때
  ipcMain.handle("read-pdf-file", async (event, filePath) => {
    const buffer = await fs.promises.readFile(filePath);
    return buffer;
  });
}
