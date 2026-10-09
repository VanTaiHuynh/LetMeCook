import test from "node:test";
import assert from "node:assert/strict";
import { consumptionPayload, coverageCostText, lotPayload, mealSlotFromParams, prepareLotCreation, scopedKitchenPath, shoppingDiff, shoppingItems, timerSeconds } from "./kitchen.js";

test("scope and version query data are retained without overwriting other parameters", () => {
  const query = new URLSearchParams(scopedKitchenPath("/pantry/lot?version=3", "household", { asOf: "2026-10-08" }).split("?")[1]);
  assert.equal(query.get("version"), "3"); assert.equal(query.get("householdId"), "household"); assert.equal(query.get("asOf"), "2026-10-08");
});
test("unknown pantry quantities remain null and edits retain CAS versions", () => {
  const form = { ingredient: " Rice ", quantity: "", unit: "g", useBy: "2026-10-12" };
  assert.equal(lotPayload(form, 2).quantity, null); assert.equal(lotPayload(form, 2).version, 2);
  assert.throws(() => lotPayload({ ...form, quantity: "-1" }), /positive/);
  assert.throws(() => lotPayload({ ...form, useBy: "2026-02-30" }), /dates/);
});
test("persisted timers use absolute deadlines instead of restarting after navigation", () => {
  const timer = { running: true, endsAt: "2026-10-08T14:05:00Z" };
  assert.equal(timerSeconds(timer, Date.parse("2026-10-08T14:04:12Z")), 48);
  assert.equal(timerSeconds(timer, Date.parse("2026-10-08T14:06:00Z")), 0);
  assert.equal(timerSeconds({ ...timer, running: false }), 0);
});
test("consumption is explicit, sufficient and versioned, never guessing an unknown lot amount", () => {
  const lots = [{ id: "rice", ingredient: "Rice", quantity: 500, version: 4 }, { id: "salt", ingredient: "Salt", quantity: null, version: 2 }];
  assert.deepEqual(consumptionPayload(lots, { rice: "100" }), [{ lotId: "rice", quantity: 100, version: 4 }]);
  assert.throws(() => consumptionPayload(lots, { rice: "501" }), /exceeds/);
  assert.throws(() => consumptionPayload(lots, { salt: "1" }), /Confirm/);
  assert.throws(() => consumptionPayload(lots, { rice: { quantity: "100", version: 3 } }), /changed/);
  assert.throws(() => consumptionPayload(lots, { removedLot: "100" }), /removed/);
  assert.deepEqual(consumptionPayload(lots, { rice: { quantity: "100", version: 4 } }), [{ lotId: "rice", quantity: 100, version: 4 }]);
});
test("what-if diffs preserve raw units and shared shopping uses canonical missing quantities only when known", () => {
  assert.deepEqual(shoppingDiff([{ key: "rice:g", name: "Rice", quantityText: "100 g" }], [{ key: "rice:g", name: "Rice", quantityText: "200 g" }]), [{ key: "rice:g", name: "Rice", before: "100 g", after: "200 g" }]);
  const plan = { checkedItems: [], shoppingList: [{ key: "rice:g", name: "Rice", quantityText: "200 g" }] };
  assert.equal(shoppingItems(plan, { shoppingList: [{ ...plan.shoppingList[0], quantityMissing: 100, unit: "g" }] })[0].quantityText, "100 g");
  assert.equal(shoppingItems(plan, { shoppingList: [{ ...plan.shoppingList[0], quantityMissing: null, requiresReview: true }] })[0].quantityText, "200 g");
  assert.deepEqual(shoppingItems(plan, { shoppingList: [{ ...plan.shoppingList[0], quantityMissing: 0 }] }), []);
});
test("budget display never presents a partial or mixed-currency total as a complete estimate", () => {
  assert.equal(coverageCostText({ estimatedCost: null, currency: null }), "Complete cost unavailable");
  assert.equal(coverageCostText({ estimatedCost: 12.5, currency: "CAD" }), "12.50 CAD");
  assert.equal(coverageCostText({ estimatedCost: 0, currency: null }), "No known purchases needed");
});

test('pantry retries keep operation identifiers and values while refreshing revision after a conflict', () => {
  const payload = lotPayload({ ingredient: 'Rice', quantity: '200', unit: 'g' });
  const prepared = prepareLotCreation(payload, 4, null, { idempotencyKey: 'original-request', lineId: 'original-line' });
  const retry = prepareLotCreation(payload, 8, prepared, { idempotencyKey: 'unused-request', lineId: 'unused-line' });
  assert.equal(retry.body.quantity, prepared.body.quantity);
  assert.equal(retry.body.lineId, prepared.body.lineId);
  assert.equal(retry.body.aggregateRevision, 8);
  assert.equal(retry.body.idempotencyKey, 'original-request');
  const changed = prepareLotCreation({ ...payload, quantity: 300 }, 8, prepared, { idempotencyKey: 'new-request', lineId: 'new-line' });
  assert.equal(changed.body.aggregateRevision, 8);
  assert.equal(changed.body.idempotencyKey, 'new-request');
  assert.throws(() => prepareLotCreation(payload, undefined), /Reload/);
  assert.throws(() => prepareLotCreation(payload, 0), /Reload/);
});

test('only complete saved-plan slot links can associate a meal confirmation', () => {
  const planId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(mealSlotFromParams(new URLSearchParams()), null);
  assert.deepEqual(mealSlotFromParams(new URLSearchParams({ planId, dayIndex: '2' })), { planId, dayIndex: 2 });
  assert.throws(() => mealSlotFromParams(new URLSearchParams({ planId, dayIndex: '7' })), /incomplete/);
  assert.throws(() => mealSlotFromParams(new URLSearchParams({ dayIndex: '0' })), /incomplete/);
});
