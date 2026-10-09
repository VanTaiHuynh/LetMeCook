import test from "node:test";
import assert from "node:assert/strict";
import { addPlanDays, currentMonday, effectiveCookingTime, invalidSavedPlanMetadata, isPlanDate, splitExcludedIngredients, plannerFormError, plannerFormFromPlan, plannerRequestFromForm, planMealCount, cleanCheckedItems, restoreGuestPlan, serializePlan, normalizePlan, unsupportedProfileDiets, profileDietExclusions, groceryText } from "./mealPlanner.js";

test("seven dates cross DST, leap days and year boundaries without shifting a calendar date", () => {
  assert.equal(addPlanDays("2026-03-07", 2), "2026-03-09");
  assert.equal(addPlanDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addPlanDays("2026-12-29", 6), "2027-01-04");
  assert.equal(isPlanDate("2026-02-29"), false);
  assert.equal(isPlanDate("0000-01-01"), false);
  assert.equal(isPlanDate("2026-10-08"), true);
  assert.equal(currentMonday(new Date(2026, 9, 11, 23)), "2026-10-05");
});

test("exclusions are deduplicated without silently truncating too many or long ingredients", () => {
  assert.deepEqual(splitExcludedIngredients("Peanuts, peanuts; milk\n sesame"), ["Peanuts", "milk", "sesame"]);
  const request = { weekStart: "2026-10-08", servings: 2, maxCookTime: 45, prompt: "", dietaryPreferences: [], excludedIngredients: [] };
  assert.equal(plannerFormError(request), null);
  assert.match(plannerFormError({ ...request, excludedIngredients: Array.from({ length: 21 }, (_, index) => `food${index}`) }), /20/);
  assert.match(plannerFormError({ ...request, excludedIngredients: ["x".repeat(61)] }), /60/);
  assert.match(plannerFormError({ ...request, servings: 2.5 }), /whole/);
  assert.match(plannerFormError({ ...request, maxCookTime: 241 }), /240/);
});

const plan = {
  weekStart: "2026-10-08", servings: 2,
  settings: { prompt: "No peanuts", maxCookTime: 45, dietaryPreferences: ["vegan"], excludedIngredients: ["peanuts"], useProfile: true },
  intent: { allergies: ["peanuts"], _signature: "signed-metadata", nested: { retained: true } },
  meals: [{ dayIndex: 0, recipe: { id: "recipe-one" } }],
  shoppingList: [{ key: "rice:g", name: "Rice", quantityText: "200 g", requiresReview: false }, { key: "salt:raw", name: "Salt", quantityText: "to taste", requiresReview: true }],
  checkedItems: ["rice:g", "removed:g", "rice:g"],
};

test("recalculation retains complete signed intent and original filters while changing servings and selected recipe", () => {
  const body = serializePlan(plan, { servings: 4, meals: [{ dayIndex: 0, recipeId: "replacement" }] });
  assert.equal(body.intent, plan.intent);
  assert.equal(body.intent._signature, "signed-metadata");
  assert.equal(body.prompt, "No peanuts");
  assert.deepEqual(body.dietaryPreferences, ["vegan"]);
  assert.equal(body.servings, 4);
  assert.deepEqual(body.meals, [{ dayIndex: 0, recipeId: "replacement" }]);
  assert.deepEqual(body.checkedItems, ["rice:g"]);
  assert.deepEqual(serializePlan(plan, { servings: 4, checkedItems: [] }).checkedItems, []);
  assert.equal(serializePlan(plan, {}, true).version, 0);
  assert.equal(serializePlan({ ...plan, version: 3 }, {}, true).version, 3);
});

test("canonical responses keep same-week save versions, discard obsolete grocery checkmarks, and isolate another week", () => {
  assert.deepEqual(cleanCheckedItems(plan.shoppingList, ["removed:g", "rice:g", "rice:g"]), ["rice:g"]);
  const saved = { ...plan, id: "plan-id", version: 5 };
  assert.equal(normalizePlan(plan, saved).version, 5);
  assert.equal(normalizePlan({ ...plan, weekStart: "2026-10-15" }, saved).version, undefined);
});

test('invalid saved-plan recovery preserves same-week replacement version without carrying recipes or old constraints', () => {
  const metadata = invalidSavedPlanMetadata({ id: '11111111-1111-1111-1111-111111111111', version: 4, weekStart: plan.weekStart, invalid: true, meals: [{recipe: {title: 'Obsolete dinner'}}], intent: {_signature: 'old'}, settings: {dietaryPreferences: ['old-filter']} }, plan.weekStart);
  assert.equal(metadata.version, 4);
  assert.equal(metadata.meals, undefined);
  assert.equal(metadata.intent, undefined);
  assert.equal(metadata.settings, undefined);
  const replacement = normalizePlan(plan, metadata);
  assert.equal(serializePlan(replacement, {}, true).version, 4);
  assert.equal(replacement.intent, plan.intent);
  assert.equal(replacement.settings, plan.settings);
  assert.equal(replacement.invalid, undefined);
  assert.equal(invalidSavedPlanMetadata(metadata, '2026-10-15'), null);
  assert.equal(invalidSavedPlanMetadata({...metadata, version: 0}, plan.weekStart), null);
  assert.equal(normalizePlan({...plan, weekStart: '2026-10-15'}, metadata).version, undefined);
});

test("supported allergy-style diet labels map to listed exclusions while unknown diets remain visible", () => {
  const labels = ["gluten free", "vegan", "keto", "dairy free", "nut-free", "peanut-free", "egg free", "soy-free", "sesame-free"];
  assert.deepEqual(unsupportedProfileDiets(labels), ["keto"]);
  assert.deepEqual(profileDietExclusions(labels).map(value => value.ingredient), ["dairy", "nut", "peanut", "egg", "soy", "sesame"]);
  assert.equal(profileDietExclusions(labels)[0].label, "dairy free");
});

test("applied time reflects a stricter prompt instead of the unchanged form default", () => {
  assert.equal(effectiveCookingTime({ settings: { maxCookTime: 45 }, intent: { maxCookingTime: 30 } }), 30);
  assert.equal(effectiveCookingTime({ settings: { maxCookTime: 45 }, intent: { maxCookingTime: null } }), 45);
  assert.equal(effectiveCookingTime({ settings: { maxCookTime: 45 }, intent: { maxCookingTime: Infinity } }), 45);
  assert.equal(effectiveCookingTime({ settings: { maxCookTime: 45 }, intent: { maxCookingTime: "30" } }), 45);
});

test("grocery export preserves uncertain quantities and checked-item meaning", () => {
  assert.match(groceryText(plan), /\[x\] Rice — 200 g/);
  assert.match(groceryText(plan), /Salt — to taste \(review quantity\)/);
});

test("sign-in navigation restores only complete public guest drafts, never account or pantry plans", () => {
  const guest = { ...plan, meals: [{ dayIndex: 0, recipe: { id: "public-recipe", title: "Rice dinner" } }], personalization: { usedProfile: false } };
  assert.equal(restoreGuestPlan(JSON.stringify(guest)).intent._signature, "signed-metadata");
  assert.equal(restoreGuestPlan(JSON.stringify({ ...guest, id: "saved-private-plan", version: 3 })), null);
  assert.equal(restoreGuestPlan(JSON.stringify({ ...guest, settings: { ...guest.settings, usePantry: true } })), null);
  assert.equal(restoreGuestPlan(JSON.stringify({ ...guest, personalization: { usedProfile: true } })), null);
  assert.equal(restoreGuestPlan("malformed JSON"), null);
});

test('one, three and seven dinner requests round-trip saved settings while other counts are rejected', () => {
  for (const mealCount of [1, 3, 7]) {
    const value = { ...plan, settings: { ...plan.settings, mealCount } };
    const request = plannerRequestFromForm(plannerFormFromPlan(value), true);
    assert.equal(request.mealCount, mealCount);
    assert.equal(planMealCount(value), mealCount);
    assert.equal(plannerFormError(request), null);
  }
  assert.equal(planMealCount(plan), 7);
  assert.match(plannerFormError(plannerRequestFromForm({ ...plannerFormFromPlan(plan), mealCount: '2' }, true)), /1, 3 or 7/);
});

test('guest requests exclude saved-profile use while authenticated defaults and explicit opt-outs remain intact', () => {
  const form = plannerFormFromPlan();
  assert.equal(form.useProfile, true);
  assert.equal(plannerRequestFromForm(form, false).useProfile, false);
  assert.equal(form.useProfile, true);
  assert.equal(plannerRequestFromForm(form, true).useProfile, true);
  const optedOut = plannerFormFromPlan({ ...plan, settings: { ...plan.settings, useProfile: false } });
  assert.equal(optedOut.useProfile, false);
  assert.equal(plannerRequestFromForm(optedOut, true).useProfile, false);
});

test('must-use and purchase budgets require trusted stock and reject excess precision or unknown scope', () => {
  const form = { ...plannerFormFromPlan(plan), mustUseText: 'Rice, rice, spinach', mustUseScope: 'plan', usePantry: true, budgetEnabled: true, budgetAmount: '23.50', budgetCurrency: 'cad' };
  const request = plannerRequestFromForm(form, true);
  assert.deepEqual(request.mustUseIngredients, ['Rice', 'spinach']);
  assert.deepEqual(request.budget, { amount: 23.5, currency: 'CAD' });
  assert.equal(plannerFormError(request), null);
  assert.match(plannerFormError(plannerRequestFromForm(form, false)), /Sign in and enable/);
  assert.match(plannerFormError({ ...request, budget: { amount: 1.001, currency: 'CAD' } }), /two decimal/);
  assert.match(plannerFormError({ ...request, budget: { amount: 1000001, currency: 'CAD' } }), /1,000,000/);
  assert.match(plannerFormError({ ...request, mustUseIngredients: Array.from({ length: 11 }, (_, index) => `food${index}`) }), /10/);
  assert.match(plannerFormError({ ...request, mustUseScope: 'any' }), /every dinner/);
});

test('tighter-time what-if and saving retain signed stock requirements, scope and budget exactly', () => {
  const requirements = { mustUseIngredients: ['Rice'], mustUseScope: 'plan', budget: { amount: 25, currency: 'CAD' }, mealCount: 3 };
  const value = { ...plan, settings: { ...plan.settings, ...requirements, usePantry: true, householdId: 'household-id' }, intent: { ...plan.intent, _requirements: requirements } };
  const body = serializePlan(value, { maxCookTime: 20, checkedItems: [] });
  assert.equal(body.intent, value.intent);
  assert.equal(body.intent._requirements, requirements);
  assert.deepEqual(body.budget, requirements.budget);
  assert.deepEqual(body.mustUseIngredients, ['Rice']);
  assert.equal(body.mustUseScope, 'plan');
  assert.equal(body.householdId, 'household-id');
  assert.equal(body.maxCookTime, 20);
  assert.deepEqual(body.checkedItems, []);
  assert.equal(serializePlan(value, {}, true).mealCount, 3);
  assert.equal(serializePlan(value, {}, true).version, 0);
});

test('preview, price refresh and save keep the complete signed quote snapshot without choosing new quotes in the browser', () => {
  const pricing = { quoteIds: ['original-quote'], revision: 8, currency: 'CAD', quotes: [{ id: 'original-quote', packPrice: 3.5 }] };
  const value = { ...plan, settings: { ...plan.settings, usePantry: true, budget: { amount: 25, currency: 'CAD' } }, intent: { ...plan.intent, _pricing: pricing, _requirements: { budget: { amount: 25, currency: 'CAD' } } } };
  for (const request of [serializePlan(value, { maxCookTime: 20, checkedItems: [] }), serializePlan(value), serializePlan(value, {}, true)]) {
    assert.equal(request.intent, value.intent);
    assert.equal(request.intent._pricing, pricing);
    assert.deepEqual(request.intent._pricing.quoteIds, ['original-quote']);
    assert.deepEqual(request.budget, value.settings.budget);
    assert.equal(request.prompt, 'No peanuts');
  }
});


test('growth settings are explicit, scope-owned and never restored in guest drafts', () => {
  const form=plannerFormFromPlan(null,'household-fixture');form.useHouseholdPreferences=true;form.useLeftovers=true;
  assert.equal(plannerRequestFromForm(form,true).useHouseholdPreferences,true);assert.equal(plannerRequestFromForm(form,true).useLeftovers,true);
  assert.equal(plannerRequestFromForm(form,false).useHouseholdPreferences,false);assert.equal(plannerRequestFromForm(form,false).useLeftovers,false);
});
test('saving and recalculating leftover slots retains canonical lot version without sending consume writes', () => {
  const fixture={weekStart:'2026-10-05',servings:2,settings:{useLeftovers:true,useHouseholdPreferences:false},intent:{_signature:'fixture'},meals:[{dayIndex:0,recipe:{id:'recipe-fixture'},reuse:{leftoverId:'lot-fixture',version:3,servingsUsed:2}}],shoppingList:[],checkedItems:[]};
  assert.deepEqual(serializePlan(fixture).meals,[{dayIndex:0,recipeId:'recipe-fixture',leftoverId:'lot-fixture',leftoverVersion:3}]);
  assert.equal(serializePlan(fixture).useLeftovers,true);assert.equal(Object.hasOwn(serializePlan(fixture),'consumption'),false);
});
