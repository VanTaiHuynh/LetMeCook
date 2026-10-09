export const PLANNER_DIETS = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "gluten-free", label: "Gluten-free" },
  { value: "low-fat", label: "Low-fat" },
  { value: "low-calorie", label: "Low-calorie" },
];
export const PLANNER_MEAL_COUNTS = [1, 3, 7];

export function planMealCount(plan) {
  return PLANNER_MEAL_COUNTS.includes(plan?.settings?.mealCount) ? plan.settings.mealCount : 7;
}

export function plannerFormFromPlan(plan = null, householdId = null) {
  return {
    weekStart: plan?.weekStart || currentMonday(), servings: String(plan?.servings || 2),
    mealCount: String(planMealCount(plan)), maxCookTime: String(plan?.settings?.maxCookTime || 45),
    prompt: plan?.settings?.prompt || '', dietaryPreferences: plan?.settings?.dietaryPreferences || [],
    excludedText: (plan?.settings?.excludedIngredients || []).join(', '),
    mustUseText: (plan?.settings?.mustUseIngredients || []).join(', '),
    mustUseScope: plan?.settings?.mustUseScope || 'perMeal',
    budgetEnabled: !!plan?.settings?.budget, budgetAmount: String(plan?.settings?.budget?.amount ?? ''),
    budgetCurrency: plan?.settings?.budget?.currency || 'USD',
    useHouseholdPreferences: plan?.settings?.useHouseholdPreferences === true, useLeftovers: plan?.settings?.useLeftovers === true,
    useProfile: plan?.settings?.useProfile !== false, usePantry: plan?.settings?.usePantry === true,
    householdId: plan?.settings?.householdId || householdId,
  };
}

export function plannerRequestFromForm(form, signedIn) {
  return {
    weekStart: form.weekStart, servings: Number(form.servings), mealCount: Number(form.mealCount),
    maxCookTime: Number(form.maxCookTime), prompt: form.prompt.trim(), dietaryPreferences: form.dietaryPreferences,
    excludedIngredients: splitExcludedIngredients(form.excludedText),
    mustUseIngredients: splitExcludedIngredients(form.mustUseText), mustUseScope: form.mustUseScope,
    budget: form.budgetEnabled ? { amount: Number(form.budgetAmount), currency: form.budgetCurrency.trim().toUpperCase() } : null,
    useHouseholdPreferences: signedIn && !!form.householdId && form.useHouseholdPreferences, useLeftovers: signedIn && form.useLeftovers,
    useProfile: signedIn && form.useProfile, usePantry: signedIn && form.usePantry, householdId: signedIn ? form.householdId : null,
  };
}

const PROFILE_DIET_EXCLUSIONS = {
  "dairy-free": "dairy", "nut-free": "nut", "peanut-free": "peanut",
  "egg-free": "egg", "soy-free": "soy", "sesame-free": "sesame",
};

const dietKey = value => String(value).trim().toLowerCase().replace(/\s+/g, "-");

export function effectiveCookingTime(plan) {
  const maximum = plan?.intent?.maxCookingTime;
  return Number.isInteger(maximum) && maximum > 0 && maximum <= 600 ? maximum : plan?.settings?.maxCookTime;
}

export function isPlanDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  if (Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addPlanDays(value, days) {
  if (!isPlanDate(value)) return "";
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function currentMonday(now = new Date()) {
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const day = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  return addPlanDays(localDate, -(day === 0 ? 6 : day - 1));
}

export function planDateLabel(value, options = { weekday: "long", month: "short", day: "numeric" }) {
  if (!isPlanDate(value)) return value || "";
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export function splitExcludedIngredients(value) {
  const seen = new Set();
  return String(value || "").split(/[,;\n]+/).map(item => item.trim()).filter(item => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function plannerFormError(request) {
  if (!isPlanDate(request.weekStart)) return "Choose a valid start date.";
  if (!Number.isInteger(request.servings) || request.servings < 1 || request.servings > 12) return "Servings must be a whole number from 1 to 12.";
  if (!PLANNER_MEAL_COUNTS.includes(request.mealCount ?? 7)) return "Choose 1, 3 or 7 dinners.";
  if (!Number.isInteger(request.maxCookTime) || request.maxCookTime < 5 || request.maxCookTime > 240) return "Cooking time must be a whole number from 5 to 240 minutes.";
  if (request.prompt.length > 2000) return "Keep your preferences within 2,000 characters.";
  if (request.excludedIngredients.length > 20) return "List up to 20 excluded ingredients.";
  if (request.excludedIngredients.some(value => value.length > 60)) return "Each excluded ingredient must be 60 characters or fewer.";
  if (request.dietaryPreferences.some(value => !PLANNER_DIETS.some(diet => diet.value === value))) return "Choose a supported dietary preference.";
  if ((request.mustUseIngredients || []).length > 10 || (request.mustUseIngredients || []).some(value => !value.trim() || value.length > 60)) return "List up to 10 must-use ingredients, 60 characters each.";
  if (!['perMeal', 'plan'].includes(request.mustUseScope || 'perMeal')) return "Choose whether must-use ingredients apply to every dinner or the whole plan.";
  if (request.budget && (!Number.isFinite(request.budget.amount) || request.budget.amount <= 0 || request.budget.amount > 1_000_000 || Math.abs(request.budget.amount * 100 - Math.round(request.budget.amount * 100)) > 0.00001 || !/^[A-Z]{3}$/.test(request.budget.currency))) return "Enter a positive budget up to 1,000,000, with at most two decimal places and a three-letter currency.";
  if (((request.mustUseIngredients || []).length || request.budget) && !request.usePantry) return "Sign in and enable pantry stock to verify must-use ingredients and a budget.";
  return null;
}

export function cleanCheckedItems(shoppingList = [], checkedItems = []) {
  const keys = new Set(shoppingList.map(item => item.key));
  return [...new Set(checkedItems)].filter(key => keys.has(key));
}

// The worker signs intent. Preserve it and the settings that produced it, including prompt.
export function serializePlan(plan, overrides = {}, saving = false) {
  const body = {
    ...plan.settings,
    weekStart: overrides.weekStart ?? plan.weekStart,
    servings: overrides.servings ?? plan.servings,
    intent: plan.intent,
    meals: overrides.meals ?? plan.meals.map(meal => ({ dayIndex: meal.dayIndex, recipeId: meal.recipe.id, ...(meal.reuse ? { leftoverId: meal.reuse.leftoverId, leftoverVersion: meal.reuse.version } : {}) })),
    checkedItems: cleanCheckedItems(plan.shoppingList, overrides.checkedItems ?? plan.checkedItems),
  };
  // Explicit what-if constraints are revalidated against the worker's signed baseline.
  for (const key of ['mealCount', 'maxCookTime', 'excludedIngredients', 'budget']) if (Object.hasOwn(overrides, key)) body[key] = overrides[key];
  if (saving) body.version = Number.isInteger(plan.version) && plan.version > 0 ? plan.version : 0;
  return body;
}

export function normalizePlan(plan, previous = null) {
  const sameWeek = previous?.weekStart === plan.weekStart;
  return {
    ...plan,
    ...(sameWeek && !plan.id && previous.id ? { id: previous.id, version: previous.version, updatedAt: previous.updatedAt } : {}),
    checkedItems: cleanCheckedItems(plan.shoppingList, plan.checkedItems),
  };
}

// An invalid saved plan supplies only replacement CAS metadata, never old recipe content.
export function invalidSavedPlanMetadata(value, requestedWeek) {
  if (value?.invalid !== true || value.weekStart !== requestedWeek || !isPlanDate(requestedWeek)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id || '')
    || !Number.isInteger(value.version) || value.version < 1) return null;
  return {
    id: value.id, version: value.version, weekStart: value.weekStart, invalid: true,
    message: 'This saved plan no longer meets current recipe or preference requirements. Generate a new plan to replace it.',
  };
}

// Only public guest drafts may survive the sign-in navigation in this browser tab.
export function restoreGuestPlan(value) {
  try {
    if (!value || value.length > 1_000_000) return null;
    const plan = JSON.parse(value);
    if (!isPlanDate(plan.weekStart) || !Number.isInteger(plan.servings) || plan.servings < 1 || plan.servings > 12 || !plan.settings || !plan.intent || typeof plan.intent._signature !== "string" || !Array.isArray(plan.meals) || plan.meals.length > 7 || !plan.meals.every(meal => Number.isInteger(meal.dayIndex) && meal.dayIndex >= 0 && meal.dayIndex < 7 && meal.recipe?.id && typeof meal.recipe.title === "string") || !Array.isArray(plan.shoppingList) || plan.shoppingList.length > 1400 || plan.id || plan.version || plan.personalization?.usedProfile || plan.settings.usePantry || plan.settings.useLeftovers || plan.settings.useHouseholdPreferences || plan.settings.householdId) return null;
    return normalizePlan(plan);
  } catch { return null; }
}

export function unsupportedProfileDiets(values = []) {
  const supported = new Set([...PLANNER_DIETS.map(diet => diet.value), ...Object.keys(PROFILE_DIET_EXCLUSIONS)]);
  return values.filter(value => !supported.has(dietKey(value)));
}

export function profileDietExclusions(values = []) {
  return values.filter(value => PROFILE_DIET_EXCLUSIONS[dietKey(value)])
    .map(value => ({ label: value, ingredient: PROFILE_DIET_EXCLUSIONS[dietKey(value)] }));
}

export function groceryText(plan) {
  const checked = new Set(plan.checkedItems || []);
  return [
    `LetMeCook · Dinner plan starting ${plan.weekStart}`,
    `${plan.servings} servings · ${plan.meals.length} dinners`,
    "", "Grocery list · [x] means already have / bought", "",
    ...plan.shoppingList.map(item => `${checked.has(item.key) ? "[x]" : "[ ]"} ${item.name} — ${item.quantityText || "Quantity not specified"}${item.requiresReview ? " (review quantity)" : ""}`),
    "", "Review ambiguous quantities and check recipe ingredients for allergies.",
  ].join("\n");
}
