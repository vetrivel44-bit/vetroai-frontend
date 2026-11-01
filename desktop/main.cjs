const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, clipboard } = require("electron");
const screenshot = require("screenshot-desktop");
const { mouse, keyboard, Button, Key, Point, straightTo } = require("@nut-tree-fork/nut-js");

const APP_URL = process.env.VETROAI_URL || "https://vetroai-frontend.pages.dev";
let mainWindow;
let youtubeWindow;
let controlEnabled = false;
let stopped = false;
let lastActionAt = 0;
// screenshot-desktop captures at the display's physical-pixel resolution, but
// Electron's screen/mouse APIs work in logical (DPI-independent) points. On a
// HiDPI/Retina display those differ by the OS scale factor (e.g. 2x) — any
// coordinate the model read off a screenshot has to be divided by this before
// it's used to move the real cursor, or every click lands off by that factor.
// Not on Windows: nut-js moves the cursor there in physical pixels too, the
// same space as the screenshot, so dividing put every click at 1/scale of the
// way across a 125%/150% display.
const MOUSE_IN_PHYSICAL_PIXELS = process.platform === "win32";
let screenshotScaleFactor = 1;

// Google sign-in here is a redirect (see frontend/src/lib/firebaseAuth.js): the
// window goes to vetroai.firebaseapp.com and back, and on return Firebase reads
// the result through a hidden firebaseapp.com iframe. Chromium partitions that
// iframe's storage away from what the top-level visit wrote, so the result is
// never found — "Restoring your session…" then straight back to sign-in. This
// window only ever loads our own app, so turn partitioning off.
app.commandLine.appendSwitch("disable-features", "ThirdPartyStoragePartitioning");

// screenshot-desktop's Windows helper is a .bat that runs the .exe beside it by
// bare name. With this variable set (some shells and hardened setups do), cmd
// won't look in the current folder and every screenshot fails.
delete process.env.NoDefaultCurrentDirectoryInExePath;

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
  showIndicator(controlEnabled && !stopped);
}

// While VetroAI has the mouse and keyboard, the screen says so even when other
// apps are on top: a small pill at the top of the display with a Stop button.
// No border around the screen: it read as a glow and got in the way.
//
// The pill must never change what the agent sees or does: it is left out of
// screenshots (content protection), and it gets out of the way of any click,
// scroll or drag that lands on it, which it would otherwise swallow (it sits
// over browsers' tab strips and dialogs' title bars).
let indicatorWindow = null;
const PILL_SIZE = { width: 300, height: 40 };
const PILL_HTML = `<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;font:500 13px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
.p{display:flex;align-items:center;gap:9px;height:34px;margin:3px;padding:0 4px 0 13px;border-radius:999px;background:rgba(28,25,23,.94);color:#f5f5f4;border:1px solid rgba(255,255,255,.09);box-shadow:0 2px 10px rgba(0,0,0,.22)}
.d{width:7px;height:7px;border-radius:50%;background:#d97757;box-shadow:0 0 0 3px rgba(217,119,87,.2)}
.t{flex:1;white-space:nowrap;letter-spacing:.01em}
a{color:#f5f5f4;text-decoration:none;font-weight:600;font-size:12px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.12)}
a:hover{background:#dc2626}</style>
<div class="p"><span class="d"></span><span class="t">VetroAI is using your computer</span><a href="vetro-stop://now" title="Stop (Ctrl+Shift+X)">Stop</a></div>`;

function showIndicator(on) {
  if (!on) {
    if (indicatorWindow && !indicatorWindow.isDestroyed()) indicatorWindow.destroy();
    indicatorWindow = null;
    return;
  }
  if (indicatorWindow && !indicatorWindow.isDestroyed()) return;
  const { bounds } = screen.getPrimaryDisplay();
  const pill = new BrowserWindow({
    x: bounds.x + Math.round((bounds.width - PILL_SIZE.width) / 2), y: bounds.y + 8, ...PILL_SIZE,
    frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false, hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  pill.setAlwaysOnTop(true, "screen-saver");
  // Not in screenshots (Windows 10 2004+, macOS): the agent sees the screen
  // as it is, without VetroAI's own pill on top of it.
  pill.setContentProtection(true);
  pill.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PILL_HTML));
  pill.once("ready-to-show", () => { if (!pill.isDestroyed()) pill.showInactive(); });
  pill.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (url.startsWith("vetro-stop:")) emergencyStop();
  });
  indicatorWindow = pill;
}

// Runs `act` with the pill hidden when the cursor is on it (or `always`), so
// the click, scroll or drag reaches the app underneath instead of the pill.
async function clearOfIndicator(act, { always = false } = {}) {
  const pill = indicatorWindow && !indicatorWindow.isDestroyed() && indicatorWindow.isVisible() ? indicatorWindow : null;
  if (!pill) return act();
  const cursor = screen.getCursorScreenPoint();
  const b = pill.getBounds();
  const onPill = cursor.x >= b.x - 6 && cursor.x <= b.x + b.width + 6 && cursor.y >= b.y - 6 && cursor.y <= b.y + b.height + 6;
  if (!always && !onPill) return act();
  pill.hide();
  try {
    return await act();
  } finally {
    // Back once the app has had the input.
    setTimeout(() => { if (!pill.isDestroyed() && indicatorWindow === pill) pill.showInactive(); }, 150);
  }
}

function emergencyStop() {
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
  // Display bounds are in points; on Windows the point is in physical pixels.
  const probe = MOUSE_IN_PHYSICAL_PIXELS ? screen.screenToDipPoint({ x, y }) : { x, y };
  const display = screen.getDisplayNearestPoint({ x: Math.round(probe.x), y: Math.round(probe.y) });
  const f = MOUSE_IN_PHYSICAL_PIXELS ? display.scaleFactor || 1 : 1;
  const b = display.bounds;
  return {
    x: Math.max(Math.round(b.x * f), Math.min(Math.round((b.x + b.width) * f) - 1, Math.round(x))),
    y: Math.max(Math.round(b.y * f), Math.min(Math.round((b.y + b.height) * f) - 1, Math.round(y)))
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
  // The indicator window would otherwise keep the app running with no window.
  mainWindow.on("closed", () => showIndicator(false));
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
    // Google/Firebase's OAuth popup relies on sessionStorage it sets in the
    // opener window to match up when it completes — kicking it out to the
    // system's default browser (a completely separate process/profile) loses
    // that storage and the flow dies with "missing initial state". Let auth
    // popups open as a real Electron popup instead, sharing this window's
    // session, so the redirect can actually find its way back. Everything
    // else (a user clicking a real external link) still goes to the system
    // browser as before.
    const isAuthPopup = /^https:\/\/(accounts\.google\.com|[^/]+\.firebaseapp\.com)\//.test(url);
    if (isAuthPopup) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 500,
          height: 650,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false }
        }
      };
    }
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });

  // The auth popup's own script normally calls window.close() on itself once
  // Firebase/Google finish the sign-in — but Chromium only allows that when
  // the browser recognizes the window as script-opened in the usual way,
  // which doesn't reliably carry through Electron's window-override path
  // above ("Scripts may close only the windows that were opened by them.").
  // Close it from the main process instead once its own navigation lands
  // back on this app's origin, which is always allowed regardless of how
  // the window was created.
  mainWindow.webContents.on("did-create-window", (popup, details) => {
    const isAuthPopup = /^https:\/\/(accounts\.google\.com|[^/]+\.firebaseapp\.com)\//.test(details.url);
    if (!isAuthPopup) return;
    const closeIfBackHome = (url) => {
      try {
        if (new URL(url).origin === allowedOrigin && !popup.isDestroyed()) popup.close();
      } catch { /* not a parseable URL, not our concern */ }
    };
    popup.webContents.on("will-redirect", (_event, url) => closeIfBackHome(url));
    popup.webContents.on("did-navigate", (_event, url) => closeIfBackHome(url));
  });
}

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register("CommandOrControl+Shift+X", emergencyStop);
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
// A Dispatch task (sent from the phone) that needs the mouse and keyboard asks
// here, the same way location does: allow it this time, or block it. The
// window comes to the front so the question is seen. The renderer turns
// control off again when the task ends.
ipcMain.handle("computer:allow-for-dispatch", async (_event, action) => {
  const task = String(action?.text || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.flashFrame(true);
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Allow screen control?",
    buttons: ["Allow this time", "Block"],
    defaultId: 1,
    cancelId: 1,
    message: "VetroAI wants to control your mouse and keyboard",
    detail: (task ? `For a task sent from your phone: "${task}"\n\n` : "") + "Press Ctrl+Shift+X at any time to stop it."
  });
  mainWindow.flashFrame(false);
  controlEnabled = result.response === 0;
  stopped = false;
  broadcast();
  // Out of the way: the task is about the other apps, and a screenshot of
  // VetroAI's own window gives the agent nothing to work with.
  if (controlEnabled) mainWindow.minimize();
  return status();
});
// Dispatch runs while you're away from the computer: with control already on,
// VetroAI still steps aside so the agent sees the desktop, not itself.
ipcMain.handle("computer:step-aside", () => {
  if (controlEnabled && !stopped && mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
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
  // Recorded so the next move/click call knows what to divide by — see the
  // comment on screenshotScaleFactor above.
  screenshotScaleFactor = MOUSE_IN_PHYSICAL_PIXELS ? 1 : screen.getPrimaryDisplay().scaleFactor || 1;
  return `data:image/png;base64,${image.toString("base64")}`;
});
ipcMain.handle("computer:move", async (_event, action) => {
  requireControl();
  const point = clampPoint(
    finite(action.x, "x") / screenshotScaleFactor,
    finite(action.y, "y") / screenshotScaleFactor
  );
  const duration = Math.max(50, Math.min(1500, finite(action.duration ?? 250, "duration")));
  await mouse.move(straightTo(new Point(point.x, point.y), duration));
  return { ok: true, ...point };
});
ipcMain.handle("computer:click", async (_event, action) => {
  requireControl();
  const buttons = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };
  const button = buttons[action.button] || Button.LEFT;
  await clearOfIndicator(() => (action.double ? mouse.doubleClick(button) : mouse.click(button)));
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
  // @nut-tree-fork/nut-js's Key enum uses PascalCase members (Key.Enter, not
  // Key.ENTER) and at least one value is legitimately 0 (Key.Escape) — verified
  // directly against the installed package, since the previous SCREAMING_CASE
  // names here all resolved to `undefined`, silently rejecting every key press
  // except the five bare letters below (whose names happen to already match).
  // META is the one key whose actual enum member differs per OS — Key.LeftWin,
  // Key.LeftCmd, and Key.LeftSuper are three distinct nut-js key codes, not
  // aliases of each other. Resolving it here means the model can ask for the
  // same "META" on every platform to open the OS app launcher/search
  // (Start Menu / Spotlight / Activities) instead of having to hunt for a
  // taskbar or dock icon's pixel position in the screenshot.
  const metaKey = process.platform === "darwin" ? Key.LeftCmd
    : process.platform === "win32" ? Key.LeftWin
    : Key.LeftSuper;
  const allowed = {
    ENTER: Key.Enter, TAB: Key.Tab, ESCAPE: Key.Escape, BACKSPACE: Key.Backspace,
    DELETE: Key.Delete, SPACE: Key.Space, UP: Key.Up, DOWN: Key.Down,
    LEFT: Key.Left, RIGHT: Key.Right, HOME: Key.Home, END: Key.End,
    PAGEUP: Key.PageUp, PAGEDOWN: Key.PageDown,
    CTRL: Key.LeftControl, SHIFT: Key.LeftShift, ALT: Key.LeftAlt, META: metaKey,
    A: Key.A, C: Key.C, V: Key.V, X: Key.X, Z: Key.Z
  };
  const key = allowed[String(action.key || "").toUpperCase()];
  if (key === undefined) throw new Error("Key is not allowed.");
  const modifiers = (action.modifiers || [])
    .map(k => allowed[String(k).toUpperCase()])
    .filter(k => k !== undefined)
    .slice(0, 3);
  if (modifiers.length) await keyboard.pressKey(...modifiers);
  await keyboard.type(key);
  if (modifiers.length) await keyboard.releaseKey(...modifiers.reverse());
  return { ok: true };
});
ipcMain.handle("computer:scroll", async (_event, action) => {
  requireControl();
  const amount = Math.max(-1200, Math.min(1200, finite(action.amount, "amount")));
  await clearOfIndicator(() => (amount > 0 ? mouse.scrollDown(amount) : mouse.scrollUp(Math.abs(amount))));
  return { ok: true };
});
ipcMain.handle("computer:drag", async (_event, action) => {
  requireControl();
  const from = clampPoint(
    finite(action.fromX, "fromX") / screenshotScaleFactor,
    finite(action.fromY, "fromY") / screenshotScaleFactor
  );
  const to = clampPoint(
    finite(action.toX, "toX") / screenshotScaleFactor,
    finite(action.toY, "toY") / screenshotScaleFactor
  );
  const duration = Math.max(100, Math.min(2000, finite(action.duration ?? 400, "duration")));
  // A drag can start or end anywhere, including under the pill.
  await clearOfIndicator(async () => {
    await mouse.move(straightTo(new Point(from.x, from.y), 150));
    await mouse.pressButton(Button.LEFT);
    await mouse.move(straightTo(new Point(to.x, to.y), duration));
    await mouse.releaseButton(Button.LEFT);
  }, { always: true });
  return { ok: true };
});
ipcMain.handle("computer:clipboard-read", () => {
  requireControl();
  // Capped well under the 2,000-char typing limit — a step's action log is
  // meant to tell the model what it just copied, not carry a whole document.
  return { ok: true, text: clipboard.readText().slice(0, 2000) };
});
ipcMain.handle("computer:clipboard-write", (_event, action) => {
  requireControl();
  const text = String(action?.text || "").slice(0, 2000);
  clipboard.writeText(text);
  return { ok: true, length: text.length };
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
