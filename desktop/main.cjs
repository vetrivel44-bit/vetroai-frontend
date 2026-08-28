const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } = require("electron");
const screenshot = require("screenshot-desktop");
const { mouse, keyboard, Button, Key, Point, straightTo } = require("@nut-tree-fork/nut-js");

const APP_URL = process.env.VETROAI_URL || "https://vetroai-frontend.pages.dev";
let mainWindow;
let youtubeWindow;
let controlEnabled = false;
let stopped = false;
let lastActionAt = 0;

mouse.config.autoDelayMs = 35;
keyboard.config.autoDelayMs = 25;

function status() {
  return { available: true, enabled: controlEnabled && !stopped, stopped, emergencyShortcut: "Ctrl+Shift+X" };
}
function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("computer:status-changed", status());
    mainWindow.setTitle(controlEnabled && !stopped ? "VetroAI — COMPUTER CONTROL ACTIVE" : "VetroAI");
  }
}
function requireControl() {
  if (!controlEnabled || stopped) throw new Error("Computer control is disabled.");
  const now = Date.now();
  if (now - lastActionAt < 20) throw new Error("Action rate limit exceeded.");
  lastActionAt = now;
}
function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${name}.`);
  return number;
}
function clampPoint(x, y) {
  const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const bounds = display.bounds;
  return {
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - 1, Math.round(x))),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - 1, Math.round(y)))
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 640,
    backgroundColor: "#fbfaf7",
    title: "VetroAI",
    webPreferences: {
      preload: require("path").join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });
  mainWindow.removeMenu();
  const allowedOrigin = new URL(APP_URL).origin;
  const appSession = mainWindow.webContents.session;
  appSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === "geolocation" && String(requestingOrigin || "").startsWith(allowedOrigin);
  });
  appSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission !== "geolocation") return callback(false);
    dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Allow location access?",
      buttons: ["Allow this time", "Block"],
      defaultId: 1,
      cancelId: 1,
      message: "VetroAI wants to use your current location",
      detail: "Location is used only for nearby-place requests. VetroAI will not guess your location if you block access."
    }).then(result => callback(result.response === 0)).catch(() => callback(false));
  });
  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register("CommandOrControl+Shift+X", () => {
    stopped = true;
    controlEnabled = false;
    mouse.stop?.();
    keyboard.releaseKey?.(...Object.values(Key)).catch?.(() => {});
    broadcast();
    dialog.showMessageBox(mainWindow, {
      type: "warning", title: "Computer control stopped",
      message: "Emergency stop activated",
      detail: "VetroAI can no longer move the mouse or type. Enable control again in Computer Mode when you are ready."
    });
  });
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle("computer:status", () => status());
ipcMain.handle("computer:request-control", async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning", title: "Allow computer control?",
    buttons: ["Allow for this session", "Cancel"], defaultId: 1, cancelId: 1,
    message: "VetroAI wants to control your mouse and keyboard",
    detail: "Only allow this while you can watch the screen. Press Ctrl+Shift+X at any time to stop immediately."
  });
  controlEnabled = result.response === 0;
  stopped = false;
  broadcast();
  return status();
});
ipcMain.handle("computer:disable", () => {
  controlEnabled = false;
  stopped = false;
  broadcast();
  return status();
});
ipcMain.handle("computer:screenshot", async () => {
  requireControl();
  const image = await screenshot({ format: "png" });
  return `data:image/png;base64,${image.toString("base64")}`;
});
ipcMain.handle("computer:move", async (_event, action) => {
  requireControl();
  const point = clampPoint(finite(action.x, "x"), finite(action.y, "y"));
  const duration = Math.max(50, Math.min(1500, finite(action.duration ?? 250, "duration")));
  await mouse.move(straightTo(new Point(point.x, point.y), duration));
  return { ok: true, ...point };
});
ipcMain.handle("computer:click", async (_event, action) => {
  requireControl();
  const buttons = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };
  const button = buttons[action.button] || Button.LEFT;
  if (action.double) await mouse.doubleClick(button); else await mouse.click(button);
  return { ok: true };
});
ipcMain.handle("computer:type", async (_event, action) => {
  requireControl();
  const text = String(action.text || "");
  if (!text || text.length > 2000) throw new Error("Typing is limited to 2,000 characters per action.");
  await keyboard.type(text);
  return { ok: true, length: text.length };
});
ipcMain.handle("computer:key", async (_event, action) => {
  requireControl();
  const allowed = {
    ENTER: Key.ENTER, TAB: Key.TAB, ESCAPE: Key.ESCAPE, BACKSPACE: Key.BACKSPACE,
    DELETE: Key.DELETE, SPACE: Key.SPACE, UP: Key.UP, DOWN: Key.DOWN,
    LEFT: Key.LEFT, RIGHT: Key.RIGHT, HOME: Key.HOME, END: Key.END,
    PAGEUP: Key.PAGE_UP, PAGEDOWN: Key.PAGE_DOWN,
    CTRL: Key.LEFT_CONTROL, SHIFT: Key.LEFT_SHIFT, ALT: Key.LEFT_ALT,
    A: Key.A, C: Key.C, V: Key.V, X: Key.X, Z: Key.Z
  };
  const key = allowed[String(action.key || "").toUpperCase()];
  if (!key) throw new Error("Key is not allowed.");
  const modifiers = (action.modifiers || []).map(k => allowed[String(k).toUpperCase()]).filter(Boolean).slice(0, 3);
  if (modifiers.length) await keyboard.pressKey(...modifiers);
  await keyboard.type(key);
  if (modifiers.length) await keyboard.releaseKey(...modifiers.reverse());
  return { ok: true };
});
ipcMain.handle("computer:scroll", async (_event, action) => {
  requireControl();
  const amount = Math.max(-1200, Math.min(1200, finite(action.amount, "amount")));
  if (amount > 0) await mouse.scrollDown(amount); else await mouse.scrollUp(Math.abs(amount));
  return { ok: true };
});

ipcMain.handle("computer:youtube-play", async (_event, action) => {
  requireControl();
  const query = String(action?.query || "").trim().slice(0, 180);
  if (!query) throw new Error("A YouTube search query is required.");

  if (youtubeWindow && !youtubeWindow.isDestroyed()) youtubeWindow.close();
  youtubeWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "YouTube — controlled by VetroAI",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required"
    }
  });
  youtubeWindow.removeMenu();
  const searchUrl = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
  await youtubeWindow.loadURL(searchUrl);

  const clickFirstVideo = async () => {
    if (!youtubeWindow || youtubeWindow.isDestroyed()) return false;
    const script = '(() => { const target = document.querySelector("ytd-video-renderer a#thumbnail, ytd-video-renderer a#video-title"); if (!target) return false; target.click(); return true; })()';
    return youtubeWindow.webContents.executeJavaScript(script, true).catch(() => false);
  };

  await new Promise(resolve => setTimeout(resolve, 2500));
  let clicked = await clickFirstVideo();
  if (!clicked) {
    await new Promise(resolve => setTimeout(resolve, 1800));
    clicked = await clickFirstVideo();
  }
  youtubeWindow.show();
  youtubeWindow.focus();
  return { ok: true, opened: true, clicked, query };
});
