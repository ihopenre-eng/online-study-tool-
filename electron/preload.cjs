const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pointDesktop", {
  setClickThrough: (enabled) => ipcRenderer.send("point:set-click-through", Boolean(enabled)),
  hide: () => ipcRenderer.send("point:hide"),
  quit: () => ipcRenderer.send("point:quit"),
  captureScreen: () => ipcRenderer.invoke("point:capture-screen"),
  onCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on("point:command", handler);
    return () => ipcRenderer.removeListener("point:command", handler);
  },
});
