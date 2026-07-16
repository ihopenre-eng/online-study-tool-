const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, desktopCapturer } = require("electron");
const path = require("node:path");

let overlayWindow = null;
let tray = null;
let quitting = false;
let overlayVisible = true;

app.setPath("userData", path.join(app.getPath("temp"), "Point-Overlay"));
app.setAppUserModelId("com.point.annotation");

function virtualDesktopBounds() {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function setOverlayVisible(visible) {
  if (!overlayWindow) return;
  overlayVisible = visible;
  if (visible) {
    overlayWindow.show();
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
    overlayWindow.focus();
  } else {
    overlayWindow.hide();
  }
  rebuildTrayMenu();
}

function sendCommand(command) {
  if (!overlayWindow) return;
  if (!overlayVisible) setOverlayVisible(true);
  overlayWindow.webContents.send("point:command", command);
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="#4778A8"/>
      <path d="M9 22.5l3.2-.7L23 11a2.1 2.1 0 00-3-3L9.2 18.8 9 22.5z" fill="none" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  return image.isEmpty() ? nativeImage.createFromPath(process.execPath) : image.resize({ width: 16, height: 16 });
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: overlayVisible ? "오버레이 숨기기" : "오버레이 표시",
        accelerator: "Ctrl+Shift+0",
        click: () => setOverlayVisible(!overlayVisible),
      },
      { label: "포인터(클릭 통과)", accelerator: "Ctrl+Shift+1", click: () => sendCommand("pointer") },
      { label: "펜", accelerator: "Ctrl+Shift+2", click: () => sendCommand("pen") },
      { label: "형광펜", accelerator: "Ctrl+Shift+3", click: () => sendCommand("highlighter") },
      { label: "텍스트", accelerator: "Ctrl+Shift+4", click: () => sendCommand("text") },
      { label: "레이저", accelerator: "Ctrl+Shift+5", click: () => sendCommand("laser") },
      { label: "지우개", accelerator: "Ctrl+Shift+6", click: () => sendCommand("eraser") },
      { type: "separator" },
      { label: "모든 주석 지우기", accelerator: "Ctrl+Shift+Backspace", click: () => sendCommand("clear") },
      { type: "separator" },
      {
        label: "종료",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createOverlayWindow() {
  const bounds = virtualDesktopBounds();
  overlayWindow = new BrowserWindow({
    ...bounds,
    title: "Point",
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(__dirname, "..", "desktop-dist", "index.html"))
    .then(() => {
      if (!overlayWindow) return;
      overlayWindow.show();
      overlayWindow.focus();
    })
    .catch((error) => console.error("Point UI를 불러오지 못했습니다.", error));
  overlayWindow.once("ready-to-show", () => {
    overlayWindow.show();
    overlayWindow.focus();
  });
  overlayWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      setOverlayVisible(false);
    }
  });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function registerShortcuts() {
  const shortcuts = {
    "CommandOrControl+Shift+0": () => setOverlayVisible(!overlayVisible),
    "CommandOrControl+Shift+1": () => sendCommand("pointer"),
    "CommandOrControl+Shift+2": () => sendCommand("pen"),
    "CommandOrControl+Shift+3": () => sendCommand("highlighter"),
    "CommandOrControl+Shift+4": () => sendCommand("text"),
    "CommandOrControl+Shift+5": () => sendCommand("laser"),
    "CommandOrControl+Shift+6": () => sendCommand("eraser"),
    "CommandOrControl+Shift+7": () => sendCommand("magnifier"),
    "CommandOrControl+Shift+8": () => sendCommand("whiteboard"),
    "CommandOrControl+Shift+9": () => sendCommand("blackout"),
    "CommandOrControl+Shift+R": () => sendCommand("timer"),
    "CommandOrControl+Shift+Backspace": () => sendCommand("clear"),
  };
  Object.entries(shortcuts).forEach(([accelerator, handler]) => globalShortcut.register(accelerator, handler));
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on("second-instance", () => setOverlayVisible(true));

app.whenReady().then(() => {
  createOverlayWindow();
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Point 화면 주석 도구");
  tray.on("click", () => setOverlayVisible(!overlayVisible));
  rebuildTrayMenu();
  registerShortcuts();

  const updateBounds = () => {
    if (!overlayWindow) return;
    overlayWindow.setBounds(virtualDesktopBounds());
    overlayWindow.webContents.send("point:command", "viewport-changed");
  };
  screen.on("display-added", updateBounds);
  screen.on("display-removed", updateBounds);
  screen.on("display-metrics-changed", updateBounds);
}).catch((error) => console.error("Point 초기화에 실패했습니다.", error));

process.on("uncaughtException", (error) => console.error("Point 예외", error));

ipcMain.on("point:set-click-through", (_event, enabled) => {
  overlayWindow?.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
});
ipcMain.on("point:hide", () => setOverlayVisible(false));
ipcMain.on("point:quit", () => {
  quitting = true;
  app.quit();
});
ipcMain.handle("point:capture-screen", async () => {
  if (!overlayWindow) return null;
  const bounds = virtualDesktopBounds();
  try {
    overlayWindow.setOpacity(0);
    await new Promise((resolve) => setTimeout(resolve, 45));
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: bounds.width, height: bounds.height } });
    return sources[0]?.thumbnail.toDataURL() ?? null;
  } finally {
    overlayWindow.setOpacity(1);
  }
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", (event) => event.preventDefault());
