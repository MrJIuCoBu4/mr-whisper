const DEFAULT_DEV_SERVER_PORT = 5183;
const parseDevServerPort = () => {
  const raw =
    process.env.OPENWHISPR_DEV_SERVER_PORT ||
    process.env.VITE_DEV_SERVER_PORT ||
    String(DEFAULT_DEV_SERVER_PORT);
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_DEV_SERVER_PORT;
  }

  return parsed;
};

const DEV_SERVER_PORT = parseDevServerPort();
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}/`;

class DevServerManager {
  static async waitForDevServer(url = DEV_SERVER_URL, maxAttempts = 30, delay = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const http = require("http");
        const urlObj = new URL(url);

        const result = await new Promise((resolve) => {
          const req = http.get(
            {
              hostname: urlObj.hostname,
              port: urlObj.port || 80,
              path: urlObj.pathname,
              timeout: 2000,
            },
            (res) => {
              resolve(res.statusCode >= 200 && res.statusCode < 400);
            }
          );

          req.on("error", () => resolve(false));
          req.on("timeout", () => {
            req.destroy();
            resolve(false);
          });
        });

        if (result) {
          return true;
        }
      } catch {
        // Dev server not ready yet, continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
  }

  static getAppUrl(windowType = "main") {
    if (process.env.NODE_ENV === "development") {
      if (windowType === "settings") return `${DEV_SERVER_URL}?settings=true`;
      if (windowType === "panel") return `${DEV_SERVER_URL}?panel=true`;
      return DEV_SERVER_URL;
    }
    return null;
  }

  /**
   * @param {"main"|"settings"|"panel"} windowType
   */
  static getAppFilePath(windowType = "main") {
    if (process.env.NODE_ENV === "development") {
      return null;
    }

    const path = require("path");
    const { app } = require("electron");
    const appPath = app.getAppPath();
    const htmlPath = path.join(appPath, "src", "dist", "index.html");

    const query =
      windowType === "settings"
        ? { settings: "true" }
        : windowType === "panel"
          ? { panel: "true" }
          : {};

    return { path: htmlPath, query };
  }
}

module.exports = DevServerManager;
module.exports.DEV_SERVER_PORT = DEV_SERVER_PORT;
module.exports.DEV_SERVER_URL = DEV_SERVER_URL;
