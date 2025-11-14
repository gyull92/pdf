const { app, BrowserWindow } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (isDev) {
    // ✅ 개발 모드: Vite dev 서버
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    // ✅ 배포 모드: 빌드된 정적 파일 로드
    // app.getAppPath() 대신 __dirname 기준으로 상대 경로 사용하는 게 electron-builder와 궁합이 더 좋습니다.
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    win.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  createWindow();

  // macOS에서 dock 아이콘 눌렀을 때 창 다시 열어주는 처리 (윈도우에선 큰 의미 X지만 관례)
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
