export type Platform = "win32" | "darwin" | "linux";

// The renderer has no access to process.platform, so derive it from the user agent.
// In the main process (or anywhere navigator is missing) Windows is assumed, since this
// build only ships Windows binaries.
function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "win32";

  const ua = `${navigator.userAgent || ""} ${navigator.platform || ""}`.toLowerCase();
  if (ua.includes("mac")) return "darwin";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "win32";
}

let cachedPlatform: Platform | null = null;

export function getPlatform(): Platform {
  if (cachedPlatform === null) {
    cachedPlatform = detectPlatform();
  }
  return cachedPlatform;
}

export function getCachedPlatform(): Platform {
  return getPlatform();
}
