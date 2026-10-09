const STORAGE_PREFIX = "lmc:stale-assets:";
let activeBuild = import.meta.url;

// Only known browser/Vite asset-loading failures qualify. Application errors
// keep the normal error screen instead of hiding a bug behind a reload.
export function isStaleAssetError(error) {
  if (!error || typeof error.message !== "string") return false;
  if (error.name === "ChunkLoadError") return /^Loading chunk .+ failed\.?/i.test(error.message);
  if (error.name === "TypeError") {
    return /^(Failed to fetch dynamically imported module(?::|\s|$)|error loading dynamically imported module(?::|\s|$)|Importing a module script failed\.?$)/i.test(error.message);
  }
  return error.name === "Error" && /^Unable to preload CSS for\s+\S+/i.test(error.message);
}

export function recoverStaleAssetError(error, { target = globalThis.window, buildId = activeBuild } = {}) {
  if (!isStaleAssetError(error) || !target || typeof buildId !== "string" || !buildId) return false;
  try {
    if (typeof target.location?.reload !== "function") return false;
    const storage = target.sessionStorage;
    const key = STORAGE_PREFIX + buildId;
    if (storage.getItem(key) !== null) return false;
    // The guard must survive navigation. If storage is blocked, full, or does
    // not retain the write, leave the manual reload button available.
    storage.setItem(key, "attempted");
    if (storage.getItem(key) !== "attempted") return false;
    // reload preserves the route, search parameters and fragment, as well as
    // existing storage. Both the Vite event and React boundary use this guard.
    target.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function installStaleAssetRecovery(target = globalThis.window, buildId = import.meta.url) {
  if (!target?.addEventListener) return () => {};
  activeBuild = buildId;
  const onPreloadError = (event) => {
    if (recoverStaleAssetError(event.payload, { target, buildId })) event.preventDefault();
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => target.removeEventListener("vite:preloadError", onPreloadError);
}
