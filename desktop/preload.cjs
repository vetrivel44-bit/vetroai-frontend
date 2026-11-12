const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vetroDesktop", Object.freeze({
  platform: process.platform,
  version: "1.1.0",
  getStatus: () => ipcRenderer.invoke("computer:status"),
  requestControl: () => ipcRenderer.invoke("computer:request-control"),
  allowForDispatch: (text) => ipcRenderer.invoke("computer:allow-for-dispatch", { text }),
  disableControl: () => ipcRenderer.invoke("computer:disable"),
  stepAside: () => ipcRenderer.invoke("computer:step-aside"),
  comeBack: () => ipcRenderer.invoke("computer:come-back"),
  // A run starts or ends, and what it is doing now: the glow and the pill.
  setWorking: (on, label = "") => ipcRenderer.invoke("computer:working", { on, label }),
  screenshot: () => ipcRenderer.invoke("computer:screenshot"),
  moveMouse: (x, y, duration = 250) => ipcRenderer.invoke("computer:move", { x, y, duration }),
  click: (button = "left", double = false) => ipcRenderer.invoke("computer:click", { button, double }),
  typeText: (text) => ipcRenderer.invoke("computer:type", { text }),
  pressKey: (key, modifiers = []) => ipcRenderer.invoke("computer:key", { key, modifiers }),
  // Scrolls at (x, y) when given: a page scrolls only under the cursor.
  scroll: (amount, x, y) => ipcRenderer.invoke("computer:scroll", { amount, x, y }),
  drag: (fromX, fromY, toX, toY, duration = 400) => ipcRenderer.invoke("computer:drag", { fromX, fromY, toX, toY, duration }),
  readClipboard: () => ipcRenderer.invoke("computer:clipboard-read"),
  writeClipboard: (text) => ipcRenderer.invoke("computer:clipboard-write", { text }),
  copy: () => ipcRenderer.invoke("computer:copy"),
  paste: (text = "") => ipcRenderer.invoke("computer:paste", { text }),
  playYouTube: (query) => ipcRenderer.invoke("computer:youtube-play", { query }),
  onStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("computer:status-changed", handler);
    return () => ipcRenderer.removeListener("computer:status-changed", handler);
  }
}));