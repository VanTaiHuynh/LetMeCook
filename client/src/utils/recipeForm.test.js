import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { recipeText, recipeSteps } from "./recipeContent.js";
import { ingredientQuantity, validateRecipeForm, validateRecipeImage } from "./recipeForm.js";

const form = { title: "Soup", directions: "Simmer.\nServe.", servings: "", time: "", is_public: true };
const rows = [{ name: "Carrot", quantity: "1/2", unit: "cup" }];

test("stored HTML and encoded payloads are rendered as text, not executable elements", () => {
  for (const payload of [
    '<img src=x onerror="alert(1)">A recipe',
    '&lt;img src=x onerror="alert(1)"&gt;',
    '<svg><g onload="alert(1)"></g></svg>Safe',
    '<script>alert(1)</script><p>Safe</p>',
    '&#60;img src=x onerror=alert(1)&#62;',
  ]) {
    const markup = renderToStaticMarkup(React.createElement("p", null, recipeText(payload)));
    assert.doesNotMatch(markup, /<(?:img|svg|script|iframe)\b/i);
  }
});

test("imported list instructions and entities retain separate readable steps", () => {
  assert.deepEqual(recipeSteps("<li>Mix &amp; stir.</li><li>Bake at 180&deg;C.</li>"), ["Mix & stir.", "Bake at 180°C."]);
  assert.deepEqual(recipeSteps("Simmer.\u2028Serve."), ["Simmer.", "Serve."]);
  assert.equal(recipeText("Cook for < 5 minutes > if needed."), "Cook for < 5 minutes > if needed.");
});

test("fractional quantities are numeric and never silently truncated", () => {
  assert.equal(ingredientQuantity("1/2"), 0.5);
  assert.equal(ingredientQuantity("1 1/2"), 1.5);
  assert.equal(ingredientQuantity(".25"), 0.25);
  assert.ok(!Number.isFinite(ingredientQuantity("1/0")));
  assert.ok(Number.isNaN(ingredientQuantity("2cups")));
});

test("incomplete, repeated and invalid ingredient rows are rejected before saving", () => {
  assert.ok(validateRecipeForm(form, [{ name: "Carrot", quantity: "" }]).error);
  assert.ok(validateRecipeForm(form, [{ name: "", quantity: "2" }]).error);
  assert.ok(validateRecipeForm(form, [{ name: "Carrot", quantity: "-1" }]).error);
  assert.ok(validateRecipeForm(form, [...rows, { name: " carrot ", quantity: "1" }]).error);
  assert.ok(validateRecipeForm(form, []).error);
});

test("optional unknown time/yield stay unknown; submitted values must be positive integers", () => {
  const result = validateRecipeForm(form, rows);
  assert.equal(result.value.time, 0);
  assert.equal(result.value.servings, 0);
  assert.equal(result.ingredients[0].quantity, 0.5);
  for (const value of ["0", "-1", "1.5", "NaN", "Infinity"]) {
    assert.ok(validateRecipeForm({ ...form, servings: value }, rows).error);
    assert.ok(validateRecipeForm({ ...form, time: value }, rows).error);
  }
  assert.ok(validateRecipeForm({ ...form, title: " " }, rows).error);
  assert.ok(validateRecipeForm({ ...form, directions: "<br>" }, rows).error);
});

test("recipe upload accepts supported photos and rejects SVG and oversized images", () => {
  assert.equal(validateRecipeImage({ type: "image/jpeg", size: 100 }), null);
  assert.ok(validateRecipeImage({ type: "image/svg+xml", size: 100 }));
  assert.ok(validateRecipeImage({ type: "image/png", size: 11 * 1024 * 1024 }));
});
