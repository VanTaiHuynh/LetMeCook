export function normalizeIngredients(values) {
  return [...new Map(values.map((value) => String(value).trim()).filter(Boolean)
    .map((value) => [value.toLocaleLowerCase(), value])).values()].slice(0, 20);
}

export function sunnyImageError(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a JPG, PNG or WebP photo.";
  if (file.size > 5 * 1024 * 1024) return "Choose a photo smaller than 5 MB.";
  return null;
}

export function sourceLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function readPhoto(file, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", abort);
    reader.onload = () => { cleanup(); resolve(String(reader.result).split(",")[1]); };
    reader.onerror = () => { cleanup(); reject(new Error("Could not read the photo. Please choose it again.")); };
    reader.onabort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    reader.readAsDataURL(file);
  });
}
