import { recipeSteps, recipeText } from "./recipeContent.js";

export function ingredientQuantity(value) {
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  const fraction = text.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3]);
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
}

export function validateRecipeForm(form, rows) {
  const title = String(form.title ?? "").trim();
  const directions = recipeSteps(form.directions).join("\n");
  if (!title) return { error: "Enter a recipe title." };
  if (title.length > 200) return { error: "Keep the recipe title within 200 characters." };
  if (!directions) return { error: "Add at least one instruction." };
  if (directions.length > 40000) return { error: "Keep instructions within 40,000 characters." };
  if (recipeText(form.description).length > 10000) return { error: "Keep the description within 10,000 characters." };

  const numbers = {};
  for (const [field, label] of [["servings", "Servings"], ["time", "Cooking time"]]) {
    const text = String(form[field] ?? "").trim();
    const value = text ? Number(text) : 0;
    const maximum = field === "servings" ? 1000000 : 525600;
    if (text && (!Number.isInteger(value) || value < 1 || value > maximum)) {
      return { error: `${label} must be a positive whole number, or left blank if unknown.` };
    }
    numbers[field] = value;
  }

  const ingredients = [];
  const names = new Set();
  for (const [index, row] of rows.entries()) {
    const name = String(row.name ?? "").trim();
    const quantityText = String(row.quantity ?? "").trim();
    const unit = String(row.unit ?? "").trim();
    if (!name && !quantityText && !unit) continue;
    const quantity = ingredientQuantity(quantityText);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000000) {
      return { error: `Ingredient ${index + 1} needs a name and a positive quantity (for example 0.5 or 1/2).` };
    }
    if (name.length > 200 || unit.length > 40) return { error: `Ingredient ${index + 1} has a name or unit that is too long.` };
    const key = name.toLocaleLowerCase();
    if (names.has(key)) return { error: `Combine repeated entries for ${name} into one ingredient.` };
    names.add(key);
    ingredients.push({ name, ingredient_id: row.ingredient_id || null, quantity, unit });
  }
  if (!ingredients.length) return { error: "Add at least one ingredient with a positive quantity." };
  if (ingredients.length > 200) return { error: "Use at most 200 ingredients per recipe." };
  return { value: {
    title, description: recipeText(form.description), directions,
    ...numbers, is_public: Boolean(form.is_public), image_url: String(form.image_url ?? "").trim(),
  }, ingredients };
}

export function validateRecipeImage(file) {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    return "Choose a JPEG, PNG, WebP or GIF image.";
  }
  if (file.size > 10 * 1024 * 1024) return "Choose an image smaller than 10 MB.";
  return null;
}
