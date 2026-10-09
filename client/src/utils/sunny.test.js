import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIngredients, sourceLink, sunnyImageError } from "./sunny.js";
import { mergeSearchFields } from "./searchFields.js";

test("legacy prompt plus photo retains explicit allergy/diet exclusions and merges ingredients", () => {
  const params = new URLSearchParams("prompt=vegan+dinner&ingredients=Carrot&allergies=peanut&dietaryPreferences=vegan");
  const merged = mergeSearchFields(params, { ingredients: ["carrot", "rice"], allergies: ["milk"], dietaryPreferences: ["vegan"] });
  assert.deepEqual(merged.getAll("ingredients"), ["carrot", "rice"]);
  assert.deepEqual(merged.getAll("allergies"), ["peanut", "milk"]);
  assert.deepEqual(merged.getAll("dietaryPreferences"), ["vegan"]);
  assert.equal(merged.get("prompt"), null);
  assert.equal(params.get("prompt"), "vegan dinner");
});

test("confirmed photo ingredients are trimmed, deduplicated and capped at20", () => {
  assert.deepEqual(normalizeIngredients([" Rice ", "rice", "", "Carrot"]), ["rice", "Carrot"]);
  assert.equal(normalizeIngredients(Array.from({ length: 30 }, (_, index) => `item${index}`)).length, 20);
});

test("Sunny only accepts photos supported by the local vision contract", () => {
  assert.equal(sunnyImageError({ type: "image/webp", size: 5 * 1024 * 1024 }), null);
  assert.ok(sunnyImageError({ type: "image/png", size: 5 * 1024 * 1024 + 1 }));
  assert.ok(sunnyImageError({ type: "image/svg+xml", size: 100 }));
});

test("source citations reject executable links and accept real HTTP URLs", () => {
  assert.equal(sourceLink("javascript:alert(1)"), null);
  assert.equal(sourceLink("data:text/html,unsafe"), null);
  assert.equal(sourceLink("not a URL"), null);
  assert.equal(sourceLink("https://example.com/recipe"), "https://example.com/recipe");
});

test("legacy dietary aliases use the database's space-separated names", () => {
  const merged = mergeSearchFields(new URLSearchParams("dietaryPreferences=gluten-free"), { dietaryPreferences: ["dairy-free"] });
  assert.deepEqual(merged.getAll("dietaryPreferences"), ["gluten free", "dairy free"]);
});
