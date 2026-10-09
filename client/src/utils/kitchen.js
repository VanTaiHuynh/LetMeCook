import { isPlanDate } from "./mealPlanner.js";

export function scopedKitchenPath(path, householdId, params = {}) {
  const [pathname, existing = ""] = path.split("?");
  const query = new URLSearchParams(existing);
  if (householdId) query.set("householdId", householdId);
  Object.entries(params).forEach(([key, value]) => { if (value !== null && value !== undefined) query.set(key, String(value)); });
  return `${pathname}${query.size ? `?${query}` : ""}`;
}

export function lotPayload(form, version) {
  const ingredient = String(form.ingredient || "").trim();
  if (!ingredient || ingredient.length > 100) throw new Error("Ingredient name must be 1–100 characters.");
  const quantity = form.quantity === "" || form.quantity === null ? null : Number(form.quantity);
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error("Quantity must be positive, or leave it blank when unknown.");
  for (const field of ["useBy", "purchasedOn"]) if (form[field] && !isPlanDate(form[field])) throw new Error("Choose valid pantry dates.");
  return { ingredient, quantity, unit: String(form.unit || "").trim(), useBy: form.useBy || null, purchasedOn: form.purchasedOn || null, location: String(form.location || "").trim(), note: String(form.note || "").trim(), confirmed: true, ...(version === undefined ? {} : { version }) };
}

export function prepareLotCreation(payload, aggregateRevision, previous = null, identifiers = null) {
  if (!Number.isInteger(aggregateRevision) || aggregateRevision < 1) throw new Error('Reload current pantry stock before adding a lot.');
  const fingerprint = JSON.stringify(payload);
  // Revision is outside the receipt hash: keep the operation IDs while refreshing CAS.
  if (previous?.fingerprint === fingerprint) return previous.body.aggregateRevision === aggregateRevision ? previous : { ...previous, body: { ...previous.body, aggregateRevision } };
  const ids = identifiers || { idempotencyKey: crypto.randomUUID(), lineId: crypto.randomUUID() };
  return { fingerprint, body: { ...payload, aggregateRevision, ...ids } };
}

export function mealSlotFromParams(params) {
  const planId = params.get('planId');
  const day = params.get('dayIndex');
  if (!planId && day === null) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId || '') || !/^[0-6]$/.test(day || '')) throw new Error('The saved dinner link is incomplete. Open this dinner again from its meal plan.');
  return { planId, dayIndex: Number(day) };
}

export function timerSeconds(timer, now = Date.now()) {
  const end = Date.parse(timer.endsAt);
  if (!timer.running || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

export function timerLabel(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function consumptionPayload(lots, selections) {
  const consumed = [];
  const ids = new Set(lots.map(lot => lot.id));
  if (Object.keys(selections).some(id => !ids.has(id) && selections[id] !== "")) throw new Error("A selected pantry lot was removed. Review your consumption choices.");
  for (const lot of lots) {
    const value = selections[lot.id];
    if (value === undefined || value === "") continue;
    const quantity = Number(typeof value === "object" ? value.quantity : value);
    if (typeof value === "object" && value.version !== lot.version) throw new Error(`${lot.ingredient} changed. Review its quantity again before confirming.`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Enter a positive amount for ${lot.ingredient}, or leave it blank.`);
    if (lot.quantity === null || !Number.isFinite(Number(lot.quantity))) throw new Error(`Confirm the stock quantity for ${lot.ingredient} in Pantry first.`);
    if (quantity > Number(lot.quantity)) throw new Error(`The amount for ${lot.ingredient} exceeds this lot’s stock.`);
    consumed.push({ lotId: lot.id, quantity, version: typeof value === "object" ? value.version : lot.version });
  }
  return consumed;
}

export function shoppingItems(plan, coverage = null) {
  const rows = coverage?.shoppingList || plan.shoppingList;
  const checked = new Set(plan.checkedItems || []);
  return rows.filter(item => item.quantityMissing !== 0 || item.requiresReview).map(item => ({ key: item.key, ingredient: item.name, quantityText: item.quantityMissing !== undefined && item.quantityMissing !== null && !item.requiresReview ? `${item.quantityMissing}${item.unit ? ` ${item.unit}` : ""}` : item.quantityText || "Quantity not specified", checked: checked.has(item.key) }));
}

export function coverageCostText(coverage) {
  if (!Number.isFinite(coverage?.estimatedCost)) return "Complete cost unavailable";
  if (coverage.currency) return `${coverage.estimatedCost.toFixed(2)} ${coverage.currency}`;
  return coverage.estimatedCost === 0 ? "No known purchases needed" : "Complete cost unavailable";
}

export function shoppingDiff(before, after) {
  const old = new Map((before || []).map(item => [item.key, item]));
  const current = new Map((after || []).map(item => [item.key, item]));
  return [
    ...[...current].filter(([key, item]) => !old.has(key) || old.get(key).quantityText !== item.quantityText).map(([key, item]) => ({ key, name: item.name || item.ingredient, before: old.get(key)?.quantityText || "Not needed", after: item.quantityText || "Quantity not specified" })),
    ...[...old].filter(([key]) => !current.has(key)).map(([key, item]) => ({ key, name: item.name || item.ingredient, before: item.quantityText || "Quantity not specified", after: "Not needed" })),
  ];
}

export function safeAccent(value) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#FED369"; }
