import test from "node:test";
import assert from "node:assert/strict";
import { installStaleAssetRecovery, isStaleAssetError, recoverStaleAssetError } from "./staleAssetRecovery.js";

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: https://letmecook.ca/assets/Sunny-old.js");

function browser() {
  const data = new Map();
  const listeners = new Map();
  const reloads = [];
  const target = {
    location: {
      href: "https://letmecook.ca/recipes/example?cook=1#recipe-cooking",
      reload() { reloads.push(this.href); },
    },
    sessionStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
  };
  return { target, data, listeners, reloads };
}

test("recognizes browser dynamic-import and Vite CSS errors without accepting component errors", () => {
  assert.equal(isStaleAssetError(chunkError()), true);
  assert.equal(isStaleAssetError(new TypeError("error loading dynamically imported module: /assets/old.js")), true);
  assert.equal(isStaleAssetError(new TypeError("Importing a module script failed.")), true);
  assert.equal(isStaleAssetError(new Error("Unable to preload CSS for /assets/old.css")), true);
  const webpack = new Error("Loading chunk 42 failed.");
  webpack.name = "ChunkLoadError";
  assert.equal(isStaleAssetError(webpack), true);
  for (const error of [new TypeError("Cannot read properties of undefined"), new Error("Failed to fetch"), new Error("A component could not load"), null, "Failed to fetch dynamically imported module"]) {
    assert.equal(isStaleAssetError(error), false);
  }
});

test("reloads the current URL once per build and session, including query and fragment", () => {
  const { target, reloads } = browser();
  assert.equal(recoverStaleAssetError(chunkError(), { target, buildId: "build-a" }), true);
  assert.deepEqual(reloads, ["https://letmecook.ca/recipes/example?cook=1#recipe-cooking"]);
  target.location.href = "https://letmecook.ca/sunny?ingredients=rice#results";
  assert.equal(recoverStaleAssetError(chunkError(), { target, buildId: "build-a" }), false);
  assert.equal(recoverStaleAssetError(chunkError(), { target, buildId: "build-b" }), true);
  assert.equal(reloads[1], target.location.href);
  assert.equal(recoverStaleAssetError(chunkError(), { target: browser().target, buildId: "build-a" }), true);
});

test("Vite preload event and route boundary share one guard, suppressing only a recovered event", () => {
  const { target, listeners, reloads } = browser();
  const dispose = installStaleAssetRecovery(target, "entry-build");
  let prevented = 0;
  const dispatch = (payload) => listeners.get("vite:preloadError")({ payload, preventDefault() { prevented++; } });
  dispatch(chunkError());
  assert.equal(prevented, 1);
  assert.equal(recoverStaleAssetError(chunkError(), { target }), false);
  dispatch(chunkError());
  dispatch(new Error("A component failed"));
  assert.equal(prevented, 1);
  assert.equal(reloads.length, 1);
  dispose();
  assert.equal(listeners.has("vite:preloadError"), false);
});

test("blocked, full, or non-retaining session storage leaves manual recovery and never loops", () => {
  const cases = [
    () => { const value = browser(); Object.defineProperty(value.target, "sessionStorage", { get() { throw new Error("blocked"); } }); return value; },
    () => { const value = browser(); value.target.sessionStorage.getItem = () => { throw new Error("blocked"); }; return value; },
    () => { const value = browser(); value.target.sessionStorage.setItem = () => { throw new Error("full"); }; return value; },
    () => { const value = browser(); value.target.sessionStorage.setItem = () => {}; return value; },
  ];
  for (const create of cases) {
    const { target, reloads } = create();
    for (let i = 0; i < 3; i++) assert.equal(recoverStaleAssetError(chunkError(), { target, buildId: "blocked" }), false);
    assert.equal(reloads.length, 0);
  }
});

test("ordinary component errors cannot consume a recovery or reload the page", () => {
  const { target, data, reloads } = browser();
  assert.equal(recoverStaleAssetError(new TypeError("Cannot read properties of null"), { target, buildId: "good" }), false);
  assert.equal(data.size, 0);
  assert.equal(reloads.length, 0);
  assert.equal(recoverStaleAssetError(chunkError(), { target, buildId: "good" }), true);
});

test("a failed reload keeps the durable guard and does not retry automatically", () => {
  const { target, data } = browser();
  let attempts = 0;
  target.location.reload = () => { attempts++; throw new Error("navigation blocked"); };
  assert.equal(recoverStaleAssetError(chunkError(), { target, buildId: "blocked-navigation" }), false);
  assert.equal(data.size, 1);
  assert.equal(recoverStaleAssetError(chunkError(), { target, buildId: "blocked-navigation" }), false);
  assert.equal(attempts, 1);
});
