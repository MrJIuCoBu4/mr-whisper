const { app, ipcMain, Menu } = require("electron");

const path = require("path");



require("dotenv").config({ path: path.join(__dirname, ".env") });



if (process.platform !== "win32") {

  console.error("This build supports Windows only.");

  app.quit();

}



const BASE_WINDOWS_APP_ID = "com.gizmolabs.openwhispr";

app.setAppUserModelId(BASE_WINDOWS_APP_ID);



const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {

  app.exit(0);

}



process.on("uncaughtException", (error) => {

  if (error.code === "EPIPE") return;

  console.error("Uncaught Exception:", error);

});



process.on("unhandledRejection", (reason, promise) => {

  console.error("Unhandled Rejection at:", promise, "reason:", reason);

});



const WindowManager = require("./src/helpers/windowManager");

const ClipboardManager = require("./src/helpers/clipboard");

const WhisperManager = require("./src/helpers/whisper");
const FormattingManager = require("./src/helpers/formattingManager");

const TrayManager = require("./src/helpers/tray");

const IPCHandlersMinimal = require("./src/helpers/ipcHandlersMinimal");

const WindowsKeyManager = require("./src/helpers/windowsKeyManager");

const { ConfigManager } = require("./src/helpers/configManager");

const sidecarRegistry = require("./src/helpers/sidecarRegistry");

const fwServerSpawner = require("./src/helpers/fwServerSpawner");

const { reapStaleSidecars } = require("./src/helpers/sidecarReaper");



let debugLogger = null;

let windowManager = null;

let hotkeyManager = null;

let clipboardManager = null;

let whisperManager = null;

let formattingManager = null;

let trayManager = null;

let windowsKeyManager = null;

let configManager = null;



const isLiveWindow = (window) => window && !window.isDestroyed();



function setupWindowsPushToTalk() {

  const {

    isGlobeLikeHotkey: isGlobeLike,

    isModifierOnlyHotkey,

  } = require("./src/helpers/hotkeyManager");



  const isValidHotkey = (hotkey) => hotkey && !isGlobeLike(hotkey);

  const isRightSideMod = (hotkey) =>

    /^Right(Control|Ctrl|Alt|Option|Shift|Super|Win|Meta|Command|Cmd)$/i.test(hotkey);



  const needsNativeListener = (hotkey, mode) => {

    if (!isValidHotkey(hotkey)) return false;

    if (mode === "push") return true;

    return isRightSideMod(hotkey) || isModifierOnlyHotkey(hotkey);

  };



  const startWindowsKeyListener = (hotkeyOverride = null) => {

    if (!isLiveWindow(windowManager.mainWindow)) return;



    const activationMode = windowManager.getActivationMode();

    const hotkey =

      hotkeyOverride || hotkeyManager.getCurrentHotkey() || configManager.get().hotkey || "Alt+Z";



    if (needsNativeListener(hotkey, activationMode)) {

      debugLogger?.info("[Push-to-Talk] Starting Windows key listener", { hotkey, activationMode });

      windowsKeyManager.start(hotkey);

    } else {

      windowsKeyManager.stop();

    }

  };



  windowsKeyManager.on("key-down", () => {

    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = windowManager.getActivationMode();

    debugLogger?.debug("[Push-to-Talk] KEY_DOWN");

    if (activationMode === "push") {

      windowManager.startWindowsPushToTalk();

    } else {

      windowManager.sendToggleDictation();

    }

  });



  windowsKeyManager.on("key-up", () => {

    debugLogger?.debug("[Push-to-Talk] KEY_UP");

    if (windowManager.winPushState?.active) {

      windowManager.handleWindowsPushKeyUp();

    } else if (isLiveWindow(windowManager.mainWindow)) {

      const activationMode = windowManager.getActivationMode();

      if (activationMode === "push") {

        windowManager.handleWindowsPushKeyUp();

      }

    }

  });



  windowsKeyManager.on("ready", () => {

    debugLogger?.info("[Push-to-Talk] Windows key listener ready");

  });



  windowsKeyManager.on("unavailable", () => {

    debugLogger?.warn("[Push-to-Talk] Windows key listener unavailable");

  });



  setTimeout(() => startWindowsKeyListener(), 500);



  hotkeyManager.on("hotkey-loaded", (hotkey) => {

    startWindowsKeyListener(hotkey);

  });



  ipcMain.on("activation-mode-changed", (_event, _mode) => {

    windowManager.resetWindowsPushState();

    startWindowsKeyListener();

  });



  ipcMain.on("hotkey-changed", (_event, hotkey) => {

    if (!isLiveWindow(windowManager.mainWindow)) return;

    windowManager.resetWindowsPushState();

    startWindowsKeyListener(hotkey);

  });

}



async function startApp() {

  debugLogger = require("./src/helpers/debugLogger");

  debugLogger.ensureFileLogging();



  configManager = new ConfigManager();

  const config = configManager.load();



  windowManager = new WindowManager();

  hotkeyManager = windowManager.hotkeyManager;

  clipboardManager = new ClipboardManager();

  whisperManager = new WhisperManager();

  formattingManager = new FormattingManager();

  windowsKeyManager = new WindowsKeyManager();

  trayManager = new TrayManager();



  windowManager.setActivationModeCache(configManager.getActivationMode());



  new IPCHandlersMinimal({

    windowManager,

    whisperManager,

    formattingManager,

    clipboardManager,

    configManager,

    windowsKeyManager,

  });



  sidecarRegistry.register("whisper", () => whisperManager.serverManager?.stop?.());
  sidecarRegistry.register("llama", () => formattingManager.serverManager?.stop?.());
  sidecarRegistry.register("fw-server", () => fwServerSpawner.stopFwServer());



  if (process.env.NODE_ENV === "development") {

    await new Promise((resolve) => setTimeout(resolve, 500));

  }



  await windowManager.createMainWindow();

  windowManager.showDictationPanel();
  windowManager.enforceMainWindowOnTop();



  trayManager.setWindowManager(windowManager);

  trayManager.setWindows(windowManager.mainWindow, windowManager.settingsWindow);

  await trayManager.createTray();



  setupWindowsPushToTalk();



  // The optional CTranslate2 engine has to be listening before the whisper pre-warm
  // tries to connect; on any failure the app falls back to the bundled whisper.cpp.
  fwServerSpawner
    .ensureFwServer(config)
    .catch((err) => debugLogger.warn("External engine start failed", { error: err.message }))
    .finally(() => {
      whisperManager.initializeFromConfig(config).catch((err) => {
        debugLogger.warn("Whisper pre-warm failed", { error: err.message });
      });
    });

  formattingManager.initializeFromConfig(config).catch((err) => {

    debugLogger.warn("Formatting pre-warm failed", { error: err.message });

  });



  const modelValidation = configManager.getModelValidation();

  if (!modelValidation.valid && trayManager.tray) {

    trayManager.tray.setToolTip(`OpenWhispr - ${modelValidation.error}`);

  }

}



app.whenReady().then(async () => {

  Menu.setApplicationMenu(null);

  reapStaleSidecars();

  await startApp();

});



app.on("window-all-closed", (event) => {

  event.preventDefault();

});



app.on("before-quit", () => {

  sidecarRegistry.shutdownAll();

});



app.on("will-quit", () => {

  if (hotkeyManager) hotkeyManager.unregisterAll();

  if (windowsKeyManager) windowsKeyManager.stop();

});


