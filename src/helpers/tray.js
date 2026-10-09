const { Tray, Menu, nativeImage, app } = require("electron");
const path = require("path");
const fs = require("fs");
const debugLogger = require("./debugLogger");
const { i18nMain } = require("./i18nMain");

class TrayManager {
  constructor() {
    this.tray = null;
    this.windowManager = null;
  }

  setWindows(mainWindow, settingsWindow) {
    this.mainWindow = mainWindow;
    this.settingsWindow = settingsWindow;
  }

  setWindowManager(windowManager) {
    this.windowManager = windowManager;
  }

  async createTray() {
    try {
      const trayIcon = await this.loadTrayIcon();
      if (!trayIcon || trayIcon.isEmpty()) {
        debugLogger.error("Failed to load tray icon", undefined, "tray");
        return;
      }

      this.tray = new Tray(trayIcon);
      this.updateTrayMenu();
      this.setupTrayEventHandlers();
    } catch (error) {
      debugLogger.error("Error creating tray icon", { error: error.message }, "tray");
    }
  }

  async loadTrayIcon() {
    const isDevelopment = process.env.NODE_ENV === "development";
    const candidatePaths = [];

    if (isDevelopment) {
      candidatePaths.push(path.join(__dirname, "..", "assets", "icon.ico"));
    } else {
      candidatePaths.push(
        path.join(process.resourcesPath, "src", "assets", "icon.ico"),
        path.join(process.resourcesPath, "assets", "icon.ico"),
        path.join(process.resourcesPath, "app.asar.unpacked", "src", "assets", "icon.ico"),
        path.join(__dirname, "..", "..", "src", "assets", "icon.ico"),
        path.join(app.getAppPath(), "src", "assets", "icon.ico")
      );
    }

    for (const testPath of candidatePaths) {
      try {
        if (fs.existsSync(testPath)) {
          const icon = nativeImage.createFromPath(testPath);
          if (icon && !icon.isEmpty()) {
            return icon;
          }
        }
      } catch {
        // try next
      }
    }

    return nativeImage.createEmpty();
  }

  buildContextMenuTemplate() {
    return [
      {
        label: i18nMain.t("menu.settings"),
        click: async () => {
          if (this.windowManager) {
            await this.windowManager.showSettingsWindow();
          }
        },
      },
      { type: "separator" },
      {
        label: i18nMain.t("menu.quit"),
        click: () => app.quit(),
      },
    ];
  }

  updateTrayMenu() {
    if (!this.tray) return;
    const contextMenu = Menu.buildFromTemplate(this.buildContextMenuTemplate());
    this.tray.setToolTip(i18nMain.t("tray.tooltip"));
    this.tray.setContextMenu(contextMenu);
  }

  setupTrayEventHandlers() {
    if (!this.tray) return;

    this.tray.on("click", () => {
      if (this.windowManager) {
        void this.windowManager.showSettingsWindow();
      }
    });

    this.tray.on("destroyed", () => {
      this.tray = null;
    });
  }
}

module.exports = TrayManager;
