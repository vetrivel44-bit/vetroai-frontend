const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vetroDesktop", Object.freeze({
  platform: process.platform,
  version: "1.0.0",
  getStatus: () => ipcRenderer.invoke("computer:status"),
  requestControl: () => ipcRenderer.invoke("computer:request-control"),
  disableControl: () => ipcRenderer.invoke("computer:disable"),
  screenshot: () => ipcRenderer.invoke("computer:screenshot"),
  moveMouse: (x, y, duration = 250) => ipcRenderer.invoke("computer:move", { x, y, duration }),
  click: (button = "left", double = false) => ipcRenderer.invoke("computer:click", { button, double }),
  typeText: (text) => ipcRenderer.invoke("computer:type", { text }),
  pressKey: (key, modifiers = []) => ipcRenderer.invoke("computer:key", { key, modifiers }),
  scroll: (amount) => ipcRenderer.invoke("computer:scroll", { amount }),
  onStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("computer:status-changed", handler);
    return () => ipcRenderer.removeListener("computer:status-changed", handler);
  }
}));