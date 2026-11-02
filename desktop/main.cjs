const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, clipboard } = require("electron");
const screenshot = require("screenshot-desktop");
const { mouse, keyboard, Button, Key, Point, straightTo } = require("@nut-tree-fork/nut-js");
const os = require("os");
const {
  GLOW_HTML, PILL_HTML, PILL_SIZE, STOP_TITLE, pillLabel, resolveKeys, shouldPaste, scrollAmount, glideSpeed, createPacer, canExcludeFromCapture,
} = require("./control.cjs");

const APP_URL = process.env.VETROAI_URL || "https://vetroai-frontend.pages.dev";
let mainWindow;
let youtubeWindow;
let controlEnabled = false;
let stopped = false;
// Whether a screen-control run is going right now. The glow and the pill show
// only then, not for as long as control stays allowed: "Allow for this
// session" used to leave "VetroAI is working" on screen with nothing running.
// null until the app says (an older web app never does): then they follow
// control, as before.
let working = null;
const pace = createPacer(20);
// Left out of screen captures where the OS can; elsewhere hidden for the
// moment of each screenshot instead.
const EXCLUDE_FROM_CAPTURE = canExcludeFromCapture(process.platform, os.release());
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
  return { available: true, enabled: controlEnabled && !stopped, stopped, working: Boolean(working), emergencyShortcut: "Ctrl+Shift+X" };
}
function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("computer:status-changed", status());
    mainWindow.setTitle(controlEnabled && !stopped ? "VetroAI — COMPUTER CONTROL ACTIVE" : "VetroAI");
  }
  showIndicator(controlEnabled && !stopped && working !== false);
}

// While VetroAI works on the computer, the screen says so even when other apps
// are on top: the edges glow in VetroAI's coral, the way Claude and other
// agents show they are at work, and a pill at the top says what it is doing,
// with a Stop button (control.cjs has both). Neither takes focus; the glow
// lets every click through.
//
// Neither may change what the agent sees or does: both are left out of
// screenshots (content protection, or hidden for the moment of the capture
// where the OS can't), and the pill gets out of the way of any click, scroll
// or drag that lands on it, which it would otherwise swallow (it sits over
// browsers' tab strips and dialogs' title bars).
let glowWindow = null;
let indicatorWindow = null;
let pillText = pillLabel("");

function overlayWindow(bounds, html) {
  const win = new BrowserWindow({
    ...bounds,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false, hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  if (EXCLUDE_FROM_CAPTURE) win.setContentProtection(true);
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  win.once("ready-to-show", () => { if (!win.isDestroyed()) win.showInactive(); });
  return win;
}

function showIndicator(on) {
  if (!on) {
    for (const win of [glowWindow, indicatorWindow]) if (win && !win.isDestroyed()) win.destroy();
    glowWindow = null;
    indicatorWindow = null;
    return;
  }
  if (indicatorWindow && !indicatorWindow.isDestroyed()) return;
  const { bounds } = screen.getPrimaryDisplay();
  glowWindow = overlayWindow(bounds, GLOW_HTML);
  glowWindow.setIgnoreMouseEvents(true);
  const pill = overlayWindow({ x: bounds.x + Math.round((bounds.width - PILL_SIZE.width) / 2), y: bounds.y + 8, ...PILL_SIZE }, PILL_HTML);
  pill.webContents.on("did-finish-load", () => setPillText(pillText));
  pill.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (url.startsWith("vetro-stop:")) emergencyStop();
  });
  pill.on("page-title-updated", (event, title) => {
    event.preventDefault();
    if (title === STOP_TITLE) emergencyStop();
  });
  indicatorWindow = pill;
}

function setPillText(text) {
  pillText = text;
  const pill = indicatorWindow;
  if (!pill || pill.isDestroyed() || pill.webContents.isLoading()) return;
  pill.webContents.executeJavaScript(`document.getElementById("t").textContent = ${JSON.stringify(text)}`).catch(() => {});
}

// Runs `capture` with the glow and pill out of the picture where the OS can't
// leave them out of captures by itself.
async function withoutOverlays(capture) {
  const shown = [glowWindow, indicatorWindow].filter((w) => w && !w.isDestroyed() && w.isVisible());
  if (EXCLUDE_FROM_CAPTURE || !shown.length) return capture();
  for (const w of shown) w.hide();
  await new Promise((resolve) => setTimeout(resolve, 80));
  try {
    return await capture();
  } finally {
    for (const w of shown) if (!w.isDestroyed()) w.showInactive();
  }
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
  working = working === null ? null : false;
  keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.LeftAlt).catch(() => {});
  broadcast();
  // Back in front, so the stop (and what VetroAI did) is seen.
  comeBack();
  dialog.showMessageBox(mainWindow, {
    type: "warning", title: "Computer control stopped",
    message: "Emergency stop activated",
    detail: "VetroAI can no longer move the mouse or type. Enable control again in Computer Mode when you are ready."
  });
}
// Every action checks control is still allowed, then waits its turn (at
// least 20 ms after the last one) instead of being refused for coming fast.
async function requireControl() {
  if (!controlEnabled || stopped) throw new Error("Computer control is disabled.");
  await pace();
  if (!controlEnabled || stopped) throw new Error("Computer control is disabled.");
}
// Glides the cursor to a point in about `durationMs`. nut-js's own speed is
// fixed at 1000 px a second, busy-waiting the whole way: a click across a 4K
// screen took three seconds of a CPU core.
async function glideTo(point, durationMs) {
  const from = await mouse.getPosition();
  const distance = Math.hypot(point.x - from.x, point.y - from.y);
  if (distance < 3) return mouse.setPosition(new Point(point.x, point.y));
  mouse.config.mouseSpeed = glideSpeed(distance, durationMs);
  return mouse.move(straightTo(new Point(point.x, point.y)));
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
  // The indicator windows would otherwise keep the app running with no window.
  mainWindow.on("closed", () => showIndicator(false));
  // A reload or a crash of the app ends any run it had going: no glow left
  // saying VetroAI is working when nothing is.
  const runEnded = () => { if (working) { working = false; broadcast(); } };
  mainWindow.webContents.on("did-navigate", runEnded);
  mainWindow.webContents.on("render-process-gone", runEnded);
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
  if (controlEnabled) await minimizeAndSettle();
  return status();
});
// Minimizes VetroAI and waits out the animation, so the agent's first
// screenshot doesn't catch the window halfway down.
async function minimizeAndSettle() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  mainWindow.minimize();
  await new Promise((resolve) => setTimeout(resolve, 350));
}
// VetroAI back in front, with what it did, when a run ends.
function comeBack() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
// Every screen-control run, from the composer or from the phone: VetroAI steps
// aside so the agent sees the desktop and the apps, not VetroAI's own window
// (with its live copy of the screen inside it).
ipcMain.handle("computer:step-aside", async () => {
  if (controlEnabled && !stopped) await minimizeAndSettle();
  return status();
});
ipcMain.handle("computer:come-back", () => {
  comeBack();
  return status();
});
// The app says when a run starts and ends, and what it is doing now: the glow
// and the pill show only while it works, and the pill says the step.
ipcMain.handle("computer:working", (_event, info) => {
  const on = Boolean(info?.on);
  if (on) setPillText(pillLabel(info?.label));
  if (working !== on) {
    working = on;
    if (!on) pillText = pillLabel("");
    broadcast();
  }
  return status();
});
ipcMain.handle("computer:disable", () => {
  controlEnabled = false;
  stopped = false;
  broadcast();
  return status();
});
ipcMain.handle("computer:screenshot", async () => {
  await requireControl();
  const image = await withoutOverlays(() => screenshot({ format: "png" }));
  // Recorded so the next move/click call knows what to divide by — see the
  // comment on screenshotScaleFactor above.
  screenshotScaleFactor = MOUSE_IN_PHYSICAL_PIXELS ? 1 : screen.getPrimaryDisplay().scaleFactor || 1;
  return `data:image/png;base64,${image.toString("base64")}`;
});
function screenPoint(x, y, nameX = "x", nameY = "y") {
  return clampPoint(finite(x, nameX) / screenshotScaleFactor, finite(y, nameY) / screenshotScaleFactor);
}
ipcMain.handle("computer:move", async (_event, action) => {
  await requireControl();
  const point = screenPoint(action.x, action.y);
  const duration = Math.max(50, Math.min(1500, finite(action.duration ?? 250, "duration")));
  await glideTo(point, duration);
  return { ok: true, ...point };
});
ipcMain.handle("computer:click", async (_event, action) => {
  await requireControl();
  const buttons = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };
  const button = buttons[action.button] || Button.LEFT;
  await clearOfIndicator(() => (action.double ? mouse.doubleClick(button) : mouse.click(button)));
  return { ok: true };
});
// Ctrl+V, or Cmd+V on a Mac.
function pasteKeys() {
  return [process.platform === "darwin" ? Key.LeftCmd : Key.LeftControl, Key.V];
}
async function pressCombo(modifiers, key) {
  if (modifiers.length) await keyboard.pressKey(...modifiers);
  try {
    await keyboard.type(key);
  } finally {
    if (modifiers.length) await keyboard.releaseKey(...[...modifiers].reverse());
  }
}
// Pastes `text` where the cursor is, then puts back what the clipboard held.
async function pasteText(text) {
  const saved = { text: clipboard.readText(), image: clipboard.readImage() };
  clipboard.writeText(text);
  const [modifier, key] = pasteKeys();
  await pressCombo([modifier], key);
  // The app reads the clipboard as the keys arrive; give it a moment first.
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (!saved.image.isEmpty()) clipboard.writeImage(saved.image);
  else clipboard.writeText(saved.text);
}
ipcMain.handle("computer:type", async (_event, action) => {
  await requireControl();
  const text = String(action.text || "");
  if (!text || text.length > 2000) throw new Error("Typing is limited to 2,000 characters per action.");
  // Long text, or text beyond plain ASCII (Tamil, Hindi, emoji), is pasted:
  // typing goes a key at a time and can't always make those characters.
  if (shouldPaste(text)) await pasteText(text);
  else await keyboard.type(text);
  return { ok: true, length: text.length };
});
ipcMain.handle("computer:key", async (_event, action) => {
  await requireControl();
  // control.cjs turns the model's key names into nut-js Key members (Key.Enter,
  // not Key.ENTER; Key.Escape is 0), resolves META to the Start/Cmd/Super key
  // of this OS, and refuses what isn't allowed with a reason the agent is told.
  const keys = resolveKeys(Key, action.key, action.modifiers, process.platform);
  if (keys.error) throw new Error(`Key not pressed: ${keys.error}.`);
  await pressCombo(keys.modifiers, keys.key);
  return { ok: true };
});
ipcMain.handle("computer:scroll", async (_event, action) => {
  await requireControl();
  // Scrolls where it is pointed, when a point is given: a page scrolls only
  // under the cursor, which might be over a sidebar.
  if (action.x !== undefined && action.y !== undefined) await glideTo(screenPoint(action.x, action.y), 120);
  const amount = scrollAmount(finite(action.amount, "amount"), process.platform);
  await clearOfIndicator(() => (amount > 0 ? mouse.scrollDown(amount) : mouse.scrollUp(Math.abs(amount))));
  return { ok: true };
});
ipcMain.handle("computer:drag", async (_event, action) => {
  await requireControl();
  const from = screenPoint(action.fromX, action.fromY, "fromX", "fromY");
  const to = screenPoint(action.toX, action.toY, "toX", "toY");
  const duration = Math.max(100, Math.min(2000, finite(action.duration ?? 400, "duration")));
  // A drag can start or end anywhere, including under the pill.
  await clearOfIndicator(async () => {
    await glideTo(from, 150);
    await mouse.pressButton(Button.LEFT);
    try {
      await glideTo(to, duration);
    } finally {
      await mouse.releaseButton(Button.LEFT);
    }
  }, { always: true });
  return { ok: true };
});
ipcMain.handle("computer:clipboard-read", async () => {
  await requireControl();
  // Capped well under the 2,000-char typing limit — a step's action log is
  // meant to tell the model what it just copied, not carry a whole document.
  return { ok: true, text: clipboard.readText().slice(0, 2000) };
});
ipcMain.handle("computer:clipboard-write", async (_event, action) => {
  await requireControl();
  const text = String(action?.text || "").slice(0, 2000);
  clipboard.writeText(text);
  return { ok: true, length: text.length };
});
// Copy (Ctrl+C, Cmd+C on a Mac) and read back what it copied.
ipcMain.handle("computer:copy", async () => {
  await requireControl();
  await pressCombo([process.platform === "darwin" ? Key.LeftCmd : Key.LeftControl], Key.C);
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { ok: true, text: clipboard.readText().slice(0, 2000) };
});
// Paste: `text` if given (and the clipboard is put back after), or whatever
// the clipboard holds.
ipcMain.handle("computer:paste", async (_event, action) => {
  await requireControl();
  const text = String(action?.text || "").slice(0, 2000);
  if (text) await pasteText(text);
  else await pressCombo([pasteKeys()[0]], Key.V);
  return { ok: true };
});

ipcMain.handle("computer:youtube-play", async (_event, action) => {
  await requireControl();
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
