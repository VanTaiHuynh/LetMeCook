import { cancelAiRequest } from "../utils/aiControl";
import usePlannerPreferences from "../features/planner/usePlannerPreferences";
import { DinnerCard, PlanConditions } from "../features/planner/PlanCards";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { plannerRequest } from "../utils/plannerApi";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FaCalendarAlt, FaCheck, FaClipboardList, FaDownload, FaSpinner, FaUtensils } from "react-icons/fa";
import { sunnyChef as chef } from "../utils/siteAsset";
import { useAuth } from "../context/AuthContext";
import { kitchenRequest } from "../utils/kitchenApi";
import { coverageCostText, shoppingDiff, shoppingItems } from "../utils/kitchen";
import { PLANNER_DIETS, PLANNER_MEAL_COUNTS, addPlanDays, effectiveCookingTime, groceryText, invalidSavedPlanMetadata, isPlanDate, normalizePlan, planDateLabel, planMealCount, plannerFormError, plannerFormFromPlan, plannerRequestFromForm, profileDietExclusions, restoreGuestPlan, serializePlan, splitExcludedIngredients, unsupportedProfileDiets } from "../utils/mealPlanner";
import "./MealPlanner.css";


function samePlannerTerms(first = [], second = []) {
  const normalize = values => [...new Set(values.map(value => String(value).trim().toLowerCase().replace(/\s+/g, " ")))].sort();
  return JSON.stringify(normalize(first)) === JSON.stringify(normalize(second));
}

export default function MealPlanner() {
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const [guestDraft] = useState(() => { try { return restoreGuestPlan(sessionStorage.getItem("lmc:guest-meal-draft")); } catch { return null; } });
  const [form, setForm] = useState(() => plannerFormFromPlan(guestDraft, params.get('householdId') || null));
  const [plan, setPlan] = useState(guestDraft);
  const [dirty, setDirty] = useState(!!guestDraft);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [savedCandidate, setSavedCandidate] = useState(undefined);
  const [invalidSavedPlan, setInvalidSavedPlan] = useState(null);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [stock, setStock] = useState(null);
  const [stockError, setStockError] = useState("");
  const [stockRetry, setStockRetry] = useState(0);
  const [coverage, setCoverage] = useState(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState("");
  const [coverageRetry, setCoverageRetry] = useState(0);
  const [whatIf, setWhatIf] = useState(null);
  const [whatIfPreview, setWhatIfPreview] = useState(null);
  const [whatIfTime, setWhatIfTime] = useState('');
  const [publishPreview, setPublishPreview] = useState(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const coverageCacheRef = useRef(null);
  const publishingRef = useRef(null);
  const planOwnerRef = useRef(null);
  const operationRef = useRef(null);
  const planRef = useRef(guestDraft);
  const dirtyRef = useRef(!!guestDraft);
  const busyRef = useRef("");
  const previousUserRef = useRef(undefined);
  const savedWeeksRef = useRef(new Map());
  const resultsRef = useRef(null);
  const userId = user?.id || null;
  const { data: profile, error: profileError, loading: profileLoading, retry: retryProfile } = usePlannerPreferences(userId, authLoading);
  const appliedTime = effectiveCookingTime(plan);

  const updatePlan = useCallback((value, unsaved, restoreForm = false) => {
    setWhatIfPreview(null);
    publishingRef.current?.abort(); publishingRef.current = null; setPublishBusy(false); setPublishPreview(null);
    planOwnerRef.current = value ? userId : null;
    planRef.current = value;
    dirtyRef.current = unsaved;
    setPlan(value);
    setDirty(unsaved);
    if (value && restoreForm) setForm(plannerFormFromPlan(value));
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    if (previousUserRef.current === undefined && planRef.current && planOwnerRef.current === null) updatePlan(planRef.current, true);
    if (previousUserRef.current !== undefined && previousUserRef.current !== userId) {
      operationRef.current?.abort(); operationRef.current = null;
      busyRef.current = ""; setBusy(""); setError(""); setConflict(false);
      savedWeeksRef.current.clear(); setSavedCandidate(undefined); setInvalidSavedPlan(null);
      publishingRef.current?.abort(); publishingRef.current = null; setPublishBusy(false); setPublishPreview(null);
      setCoverage(null); setWhatIf(null); setStock(null); coverageCacheRef.current = null;
      if (previousUserRef.current) { updatePlan(null, false); setForm(plannerFormFromPlan()); setNotice("Account changed. Private saved plans were cleared from this page."); }
      else if (planRef.current) updatePlan(planRef.current, dirtyRef.current);
    }
    previousUserRef.current = userId;
  }, [authLoading, userId, updatePlan]);

  useEffect(() => { setWhatIfTime(String(appliedTime || '')); }, [appliedTime]);

  useEffect(() => {
    if (authLoading) return;
    try {
      if (userId) { sessionStorage.removeItem("lmc:guest-meal-draft"); return; }
      if (plan !== planRef.current || planOwnerRef.current !== null) return;
      const value = plan ? JSON.stringify(plan) : null;
      if (restoreGuestPlan(value)) sessionStorage.setItem("lmc:guest-meal-draft", value);
      else sessionStorage.removeItem("lmc:guest-meal-draft");
    } catch { /* Storage may be disabled; the current in-memory guest draft still works. */ }
  }, [authLoading, userId, plan]);

  useEffect(() => {
    if (authLoading || !userId || !isPlanDate(form.weekStart)) { setSavedCandidate(undefined); setInvalidSavedPlan(null); setSavedLoading(false); setSavedError(""); return; }
    const controller = new AbortController();
    const week = form.weekStart;
    setSavedLoading(true); setSavedError(""); setSavedCandidate(undefined); setInvalidSavedPlan(null);
    plannerRequest(`?weekStart=${encodeURIComponent(week)}`, { signal: controller.signal, authenticated: true }).then(data => {
      if (controller.signal.aborted) return;
      const saved = data.plan ? normalizePlan(data.plan) : null;
      const recovery = saved ? null : invalidSavedPlanMetadata(data.invalidSavedPlan, week);
      savedWeeksRef.current.set(week, saved || recovery);
      setSavedCandidate(saved);
      setInvalidSavedPlan(recovery);
      if (!dirtyRef.current && !busyRef.current) updatePlan(saved, false, true);
    }).catch(failure => { if (!controller.signal.aborted) setSavedError(failure.message); }).finally(() => { if (!controller.signal.aborted) setSavedLoading(false); });
    return () => controller.abort();
  }, [authLoading, userId, form.weekStart, loadVersion, updatePlan]);

  useEffect(() => () => { operationRef.current?.abort(); publishingRef.current?.abort(); }, []);

  useEffect(() => {
    if (authLoading || !userId) { setStock(null); setStockError(""); return; }
    const controller = new AbortController(); setStock(null); setStockError("");
    kitchenRequest("/bootstrap", { householdId: form.householdId, signal: controller.signal }).then(value => { if (!controller.signal.aborted) setStock(value); }).catch(failure => { if (!controller.signal.aborted) setStockError(failure.message); });
    return () => controller.abort();
  }, [authLoading, userId, form.householdId, stockRetry]);

  useEffect(() => {
    if (!userId || !plan || !plan.settings.usePantry || planOwnerRef.current !== userId) { setCoverage(null); setCoverageLoading(false); setCoverageError(""); coverageCacheRef.current = null; return; }
    const key = JSON.stringify({ userId, weekStart: plan.weekStart, servings: plan.servings, settings: plan.settings, intent: plan.intent, meals: plan.meals.map(meal => [meal.dayIndex, meal.recipe.id]), retry: coverageRetry });
    if (coverageCacheRef.current === key) return;
    const controller = new AbortController(); setCoverage(null); setCoverageLoading(true); setCoverageError("");
    kitchenRequest("/coverage", { householdId: plan.settings.householdId, body: { plan }, signal: controller.signal }).then(value => { if (!controller.signal.aborted) { coverageCacheRef.current = key; setCoverage(value); } }).catch(failure => { if (!controller.signal.aborted) setCoverageError(failure.message); }).finally(() => { if (!controller.signal.aborted) setCoverageLoading(false); });
    return () => controller.abort();
  }, [userId, plan, coverageRetry]);

  const runOperation = async (kind, path, body) => {
    operationRef.current?.abort();
    const controller = new AbortController();
    operationRef.current = controller; busyRef.current = kind;
    setBusy(kind); setError(""); setNotice(""); setConflict(false);
    try {
      const response = await plannerRequest(path, { body, signal: controller.signal, authenticated: kind === "save" || kind === 'refreshPrices' });
      if (controller.signal.aborted || operationRef.current !== controller) return;
      const previous = kind === "generate" || response.weekStart !== planRef.current?.weekStart ? savedWeeksRef.current.get(response.weekStart) : planRef.current;
      const canonical = normalizePlan(response, previous);
      if (kind === 'preview') {
        setWhatIfPreview({ plan: canonical, baseline: planRef.current, beforeCoverage: coverage });
        setNotice('A new dinner preview is ready. Your current plan is unchanged until you apply it.');
        return;
      }
      if (kind === "recalculate") {
        setWhatIf({ changes: shoppingDiff(planRef.current?.shoppingList, canonical.shoppingList), beforeCoverage: coverage, beforeServings: planRef.current?.servings, afterServings: canonical.servings, beforeTime: effectiveCookingTime(planRef.current), afterTime: effectiveCookingTime(canonical), beforeBudget: planRef.current?.budgetStatus, afterBudget: canonical.budgetStatus });
        setForm(current => ({ ...current, maxCookTime: String(canonical.settings.maxCookTime) }));
      }
      else if (kind === "generate") setWhatIf(null);
      setPublishPreview(null);
      updatePlan(canonical, kind !== "save");
      if (kind === "save") { savedWeeksRef.current.set(canonical.weekStart, canonical); setSavedCandidate(canonical); setInvalidSavedPlan(null); setNotice("Plan and grocery checkmarks saved."); }
      if (kind === 'refreshPrices') setNotice('Current observed prices explicitly refreshed. Review the estimate, then save the draft to keep the new quotes.');
      if (kind === "recalculate") setNotice("Dinners and grocery quantities updated. Review checked items if amounts changed.");
      if (kind === "generate") {
        setNotice(canonical.meals.length === planMealCount(canonical) ? "Your dinner plan is ready. Review the grocery list before shopping." : canonical.meals.length ? "Only part of the plan could be filled. Review the warnings and matching dinners." : "No dinners meet all these requirements. Your conditions were not relaxed.");
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
      }
    } catch (failure) {
      if (!controller.signal.aborted && operationRef.current === controller) {
        setError(failure.message); setConflict(failure.status === 409);
        if (failure.status === 409) { setSavedCandidate(undefined); setLoadVersion(value => value + 1); }
      }
    } finally {
      if (operationRef.current === controller) { operationRef.current = null; busyRef.current = ""; setBusy(""); }
    }
  };

  const cancelOperation = () => {
    void cancelAiRequest(operationRef.current?.signal);
    operationRef.current?.abort(); operationRef.current = null; busyRef.current = "";
    setBusy(""); setNotice("Request cancelled. Your previous plan is unchanged.");
  };

  const generate = event => {
    event.preventDefault();
    const request = plannerRequestFromForm(form, !!user);
    const validation = plannerFormError(request);
    if (validation) { setError(validation); return; }
    if (form.useProfile && user && profileError) { setError("Saved preferences could not be loaded. Retry, or turn off saved preferences to make an explicit-only plan."); return; }
    runOperation("generate", "/generate", request);
  };

  const recalculate = overrides => runOperation("recalculate", "/recalculate", serializePlan(plan, overrides));
  const applyWhatIf = () => {
    if (!whatIfPreview || whatIfPreview.baseline !== planRef.current || busyRef.current) return;
    const next = whatIfPreview.plan;
    setWhatIf({ changes: shoppingDiff(plan.shoppingList, next.shoppingList), beforeCoverage: whatIfPreview.beforeCoverage, beforeServings: plan.servings, afterServings: next.servings, beforeTime: effectiveCookingTime(plan), afterTime: effectiveCookingTime(next), beforeBudget: plan.budgetStatus, afterBudget: next.budgetStatus });
    updatePlan(next, true, true); setNotice('Dinner preview applied to your draft. Save explicitly to replace the saved plan.');
  };
  const swap = (dayIndex, recipeId) => {
    const meals = plan.meals.filter(meal => meal.dayIndex !== dayIndex).map(meal => ({ dayIndex: meal.dayIndex, recipeId: meal.recipe.id, ...(meal.reuse ? { leftoverId: meal.reuse.leftoverId, leftoverVersion: meal.reuse.version } : {}) }));
    meals.push({ dayIndex, recipeId }); meals.sort((a, b) => a.dayIndex - b.dayIndex);
    recalculate({ meals });
  };
  const toggleGrocery = key => {
    const checks = new Set(plan.checkedItems);
    if (checks.has(key)) checks.delete(key); else checks.add(key);
    updatePlan({ ...plan, checkedItems: [...checks] }, true);
    setNotice("");
  };
  const loadSaved = () => {
    if (savedCandidate === undefined) { setLoadVersion(value => value + 1); return; }
    updatePlan(savedCandidate, false, true); setConflict(false); setError(""); setWhatIf(null); setPublishPreview(null);
    setNotice(savedCandidate ? "Saved week loaded." : "There is no saved plan for this start date.");
  };
  const downloadList = () => {
    const exportPlan = coverage ? { ...plan, shoppingList: shoppingItems(plan, coverage).map(item => ({ ...item, name: item.ingredient, requiresReview: coverage.shoppingList.find(row => row.key === item.key)?.requiresReview })) } : plan;
    const url = URL.createObjectURL(new Blob([groceryText(exportPlan)], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `letmecook-groceries-${plan.weekStart}.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Grocery list downloaded.");
  };
  const copyList = async () => {
    const exportPlan = coverage ? { ...plan, shoppingList: shoppingItems(plan, coverage).map(item => ({ ...item, name: item.ingredient, requiresReview: coverage.shoppingList.find(row => row.key === item.key)?.requiresReview })) } : plan;
    try { await navigator.clipboard.writeText(groceryText(exportPlan)); setNotice("Grocery list copied."); }
    catch { setNotice("Clipboard access is unavailable. Use Download list instead."); }
  };
  const publish = async (confirm = false) => {
    publishingRef.current?.abort(); const controller = new AbortController(); publishingRef.current = controller; setPublishBusy(true); setError("");
    const householdId = plan.settings.householdId || null;
    try {
      if (!confirm) {
        const existing = await kitchenRequest("/shopping", { householdId, signal: controller.signal });
        if (!controller.signal.aborted) setPublishPreview({ version: existing.version || 0, oldCount: existing.items.length, items: shoppingItems(plan, coverage), planWeekStart: plan.weekStart });
      } else {
        await kitchenRequest("/shopping", { householdId, method: "PUT", body: { version: publishPreview.version, items: publishPreview.items, planWeekStart: publishPreview.planWeekStart }, signal: controller.signal });
        if (!controller.signal.aborted) { setPublishPreview(null); setNotice("Shopping list published to this kitchen. Members can check and save it on Household."); }
      }
    } catch (failure) { if (!controller.signal.aborted) { setError(failure.message); if (failure.status === 409) setPublishPreview(null); } }
    finally { if (publishingRef.current === controller) { publishingRef.current = null; setPublishBusy(false); } }
  };
  const unsupported = unsupportedProfileDiets(profile?.dietaryPreferences);
  const profileExclusions = profileDietExclusions(profile?.dietaryPreferences);
  const checked = new Set(plan?.checkedItems || []);
  const mealsByDay = new Map((plan?.meals || []).map(meal => [meal.dayIndex, meal]));
  const previewChanges = whatIfPreview ? shoppingDiff(whatIfPreview.baseline.shoppingList, whatIfPreview.plan.shoppingList) : [];
  const selectedRecipeIds = new Set((plan?.meals || []).map(meal => meal.recipe.id));
  const servingChange = plan && Number(form.servings) !== plan.servings;
  const recipeFiltersEdited = plan && (form.prompt.trim() !== (plan.settings.prompt || "") || Number(form.maxCookTime) !== plan.settings.maxCookTime || Number(form.mealCount) !== planMealCount(plan) || !samePlannerTerms(form.dietaryPreferences, plan.settings.dietaryPreferences || []) || !samePlannerTerms(splitExcludedIngredients(form.excludedText), plan.settings.excludedIngredients || []) || !samePlannerTerms(splitExcludedIngredients(form.mustUseText), plan.settings.mustUseIngredients || []) || form.mustUseScope !== (plan.settings.mustUseScope || 'perMeal') || JSON.stringify(plannerRequestFromForm(form, !!user).budget) !== JSON.stringify(plan.settings.budget || null) || plannerRequestFromForm(form, !!user).useProfile !== plan.settings.useProfile || form.usePantry !== !!plan.settings.usePantry || form.useLeftovers !== !!plan.settings.useLeftovers || form.useHouseholdPreferences !== !!plan.settings.useHouseholdPreferences || form.householdId !== (plan.settings.householdId || null));
  const weekDiffers = plan && plan.weekStart !== form.weekStart;
  const hasPendingSaved = dirty && savedCandidate !== undefined && (savedCandidate?.version !== plan?.version || weekDiffers || conflict);
  const coverageRows = new Map((coverage?.shoppingList || []).map(item => [item.key, item]));
  const planScopeName = plan?.settings.householdId ? (stock?.households || []).find(household => household.id === plan.settings.householdId)?.name || "Selected household" : "My personal kitchen";
  const canPublish = user && (!plan?.settings.householdId || (stock?.households || []).some(household => household.id === plan.settings.householdId && (household.role === 'owner' || household.role === 'editor' && stock?.features?.collaborationEnabled === true)));

  return <main className="meal-planner">
    <div className="planner-shell">
      <header className="planner-header"><div><h1>Plan your dinners</h1><p>Choose your dinners. Take one grocery list to the store.</p></div><img src={chef} alt="Sunny, your cooking assistant" /></header>

      <details className="planner-setup" open={!plan || recipeFiltersEdited}><summary>Plan preferences <span>{plan ? "Edit dates, tastes and servings" : "Choose your week"}</span></summary>
      <form className="planner-settings" onSubmit={generate}>
        <div className="planner-section-heading"><div><h2>Your dinners</h2></div><span className="planner-small-label">{form.mealCount} consecutive dinner{form.mealCount === '1' ? '' : 's'}</span></div>
        <fieldset disabled={!!busy || authLoading} className="planner-fieldset">
          <div className="planner-fields"><Field>Start date<input type="date" required value={form.weekStart} onChange={event => setForm({ ...form, weekStart: event.target.value })} /></Field><Field>Dinners<select value={form.mealCount} onChange={event => setForm({ ...form, mealCount: event.target.value })}>{PLANNER_MEAL_COUNTS.map(count => <option key={count} value={count}>{count === 1 ? 'One dinner' : count === 3 ? 'Three dinners' : 'Seven dinners'}</option>)}</select></Field><Field>Servings per dinner<input type="number" min="1" max="12" step="1" required value={form.servings} onChange={event => setForm({ ...form, servings: event.target.value })} /></Field><Field>Maximum cooking time<span className="planner-input-unit"><input type="number" min="5" max="240" step="1" required value={form.maxCookTime} onChange={event => setForm({ ...form, maxCookTime: event.target.value })} /><span>minutes</span></span></Field></div>
          <Field className="planner-prompt-label" htmlFor="planner-prompt">What would you like this week?<textarea id="planner-prompt" rows="3" maxLength="2000" value={form.prompt} onChange={event => setForm({ ...form, prompt: event.target.value })} placeholder="Quick, comforting dinners. I like mushrooms and rice. No peanuts." /></Field>
          <fieldset className="planner-diet-fieldset"><legend>Dietary preferences <span>Optional</span></legend><div className="planner-diets">{PLANNER_DIETS.map(diet => <Field key={diet.value} className={`planner-diet ${form.dietaryPreferences.includes(diet.value) ? "is-selected" : ""}`}><input type="checkbox" checked={form.dietaryPreferences.includes(diet.value)} onChange={event => setForm({ ...form, dietaryPreferences: event.target.checked ? [...form.dietaryPreferences, diet.value] : form.dietaryPreferences.filter(value => value !== diet.value) })} /><span>{diet.label}</span></Field>)}</div></fieldset>
          <Field htmlFor="planner-exclusions">Ingredients to exclude<input id="planner-exclusions" type="text" value={form.excludedText} onChange={event => setForm({ ...form, excludedText: event.target.value })} placeholder="Peanuts, shellfish, sesame" aria-describedby="planner-exclusions-help" /><span id="planner-exclusions-help" className="planner-field-help">Separate with commas.</span></Field>
          <details className="planner-advanced"><summary>Pantry and budget <span>{form.usePantry ? "Pantry enabled" : "Optional"}{form.budgetEnabled ? " · Budget set" : ""}</span></summary><div className="planner-pantry-settings"><Field className="planner-pantry-toggle"><input type="checkbox" checked={form.usePantry} disabled={!user} onChange={event => setForm({ ...form, usePantry: event.target.checked })} /><span>Use my pantry</span></Field><p>Prioritize ingredients you have. Pantry quantities stay unchanged until you confirm cooking.</p>{user ? <><Field>Kitchen for this plan<select value={form.householdId || ""} onChange={event => setForm({ ...form, householdId: event.target.value || null, useHouseholdPreferences: false })}><option value="">My personal kitchen</option>{stock?.households?.map(household => <option key={household.id} value={household.id}>{household.name} · {household.role}</option>)}</select></Field>{stockError ? <div className="planner-inline-error"><span>{stockError}</span><Button type="button" className="planner-text-button" onClick={() => setStockRetry(value => value + 1)}>Retry pantry</Button></div> : <p>{stock ? `${stock.pantry.length} pantry lots in this kitchen.` : "Loading pantry…"} <Link to={`/pantry${form.householdId ? `?householdId=${form.householdId}` : ""}`}>Manage pantry</Link></p>}</> : <p>Log in to use your pantry.</p>}</div>
          <div className="planner-stock-requirements"><div className="planner-requirement-fields"><Field>Ingredients you must use<input value={form.mustUseText} disabled={!user} onChange={event => setForm({ ...form, mustUseText: event.target.value, useLeftovers: event.target.value.trim() ? false : form.useLeftovers, usePantry: event.target.value.trim() ? true : form.usePantry })} placeholder="Spinach, rice" aria-describedby="planner-must-use-help" /><span id="planner-must-use-help" className="planner-field-help">Use exact pantry names with unexpired stock and known quantities.</span></Field><Field>Use them<select value={form.mustUseScope} disabled={!user} onChange={event => setForm({ ...form, mustUseScope: event.target.value })}><option value="perMeal">In every dinner</option><option value="plan">Across the whole plan</option></select></Field></div><Field className="planner-pantry-toggle"><input type="checkbox" checked={form.budgetEnabled} disabled={!user} onChange={event => setForm({ ...form, budgetEnabled: event.target.checked, usePantry: event.target.checked ? true : form.usePantry })} /><span>Set a budget for missing ingredients</span></Field>{form.budgetEnabled && <div className="planner-requirement-fields"><Field>Purchase budget<input type="number" min="0.01" max="1000000" step="0.01" required value={form.budgetAmount} onChange={event => setForm({ ...form, budgetAmount: event.target.value })} /></Field><Field>Currency<input maxLength="3" pattern="[A-Z]{3}" required value={form.budgetCurrency} onChange={event => setForm({ ...form, budgetCurrency: event.target.value.toUpperCase() })} placeholder="USD" /></Field></div>}<p className="planner-field-help">Budget checks need recorded prices and matching quantities.{!user && ' Log in to use these checks.'}</p></div></details>
          <div className="planner-growth-settings"><div className="planner-growth-option">
          <Field className="planner-pantry-toggle"><input type="checkbox" checked={form.useLeftovers} disabled={!user || !!form.mustUseText.trim()} onChange={event => setForm({ ...form, useLeftovers: event.target.checked })} /><span>Reuse my confirmed leftovers</span></Field>
          <p className="planner-field-help">Preview prepared portions with your recorded dates. Record what you eat in Pantry.</p></div><div className="planner-growth-option">
          <Field className="planner-pantry-toggle"><input type="checkbox" checked={form.useHouseholdPreferences} disabled={!user || !form.householdId} onChange={event => setForm({ ...form, useHouseholdPreferences: event.target.checked })} /><span>Include shared household preferences</span></Field>
          <p className="planner-field-help">Only members who opted in are included. <Link to={`/household${form.householdId ? `?householdId=${form.householdId}` : ''}`}>Manage my sharing</Link></p></div>
        </div>
        <div className="planner-profile"><Field><input type="checkbox" checked={Boolean(user) && form.useProfile} disabled={!user} onChange={event => setForm({ ...form, useProfile: event.target.checked })} /><span>Use my saved preferences, allergies and favorites</span></Field><p>{user ? "Applies your preferences and allergies. Favorites help choose dinners." : "Log in to apply your profile."}</p>
            {user && form.useProfile && <div className="planner-profile-details">{profileLoading ? <span role="status">Loading your saved preferences…</span> : profileError ? <div className="planner-inline-error"><span>{profileError}</span><Button type="button" className="planner-text-button" onClick={retryProfile}>Retry preferences</Button></div> : profile && <><span>Saved diets: {profile.dietaryPreferences?.length ? profile.dietaryPreferences.join(", ") : "none"}. Allergies: {profile.allergies?.length ? profile.allergies.join(", ") : "none"}.</span>{profileExclusions.length > 0 && <p>Applied as listed-ingredient exclusions: <strong>{profileExclusions.map(value => `${value.label} → ${value.ingredient}`).join(", ")}</strong>. Check ingredient labels and cross-contact risks.</p>}{unsupported.length > 0 && <p>Cannot apply these saved labels: <strong>{unsupported.join(", ")}</strong>. Update your profile or turn off saved preferences for this plan.</p>}</>}</div>}
          </div>
        </fieldset>
        <div className="planner-settings-footer"><Button className="planner-primary" type="submit" disabled={!!busy || authLoading || (user && form.useProfile && profileLoading)}>{busy === "generate" ? <><FaSpinner className="planner-spinner" aria-hidden="true" />Planning your dinners…</> : <><FaUtensils aria-hidden="true" />Plan my week</>}</Button><p>For allergies, check ingredients and cross-contact risks before cooking.</p></div>
      </form></details>

      <div className="planner-feedback" aria-live="polite">{busy && <div className="planner-working"><span><FaSpinner className="planner-spinner" aria-hidden="true" />{busy === "save" ? "Saving your plan…" : busy === "recalculate" ? "Updating dinners and groceries…" : busy === "preview" ? "Previewing dinner alternatives…" : busy === "refreshPrices" ? "Refreshing observed price quotes…" : "Sunny is choosing dinners with your preferences…"}</span><Button type="button" className="planner-text-button" onClick={cancelOperation}>Cancel</Button></div>}{error && <div className="planner-error" role="alert"><p>{error}</p>{conflict && <Button className="planner-secondary" type="button" disabled={savedLoading} onClick={() => setLoadVersion(value => value + 1)}>Check saved version</Button>}</div>}{notice && <p className="planner-notice" role="status">{notice}</p>}</div>

      {user && <div className="planner-saved-week">{savedLoading ? <span role="status">Checking saved week…</span> : savedError ? <><span>{savedError}</span><Button type="button" className="planner-text-button" disabled={!!busy} onClick={() => setLoadVersion(value => value + 1)}>Retry saved week</Button></> : invalidSavedPlan ? <span role="status">{invalidSavedPlan.message} Its previous recipes and grocery list have not been loaded. Choose your preferences above; a newly generated draft will replace this week only when you save it.</span> : <><span>{hasPendingSaved ? (savedCandidate ? `A saved plan is available for ${planDateLabel(form.weekStart, { month: "short", day: "numeric" })}. Loading it replaces your current draft.` : "No saved plan for the selected date. Your current draft is still here.") : savedCandidate ? "Saved week available in your account." : "No saved plan for this start date yet."}</span>{savedCandidate && dirty && <Button type="button" className="planner-text-button" disabled={!!busy} onClick={loadSaved}>Load saved week{dirty ? " · replace draft" : ""}</Button>}</> }</div>}

      {plan && planOwnerRef.current === userId ? <section className="planner-results" ref={resultsRef} aria-label="Dinner plan and grocery list" aria-busy={!!busy}>
        <div className="planner-results-heading"><div><h2>{planDateLabel(plan.weekStart, { month: "short", day: "numeric" })}{planMealCount(plan) > 1 && <> – {planDateLabel(addPlanDays(plan.weekStart, planMealCount(plan) - 1), { month: "short", day: "numeric" })}</>}</h2><p>{plan.meals.length} of {planMealCount(plan)} dinner{planMealCount(plan) === 1 ? '' : 's'} · {plan.servings} servings each{plan.personalization?.usedProfile ? ` · Saved preferences applied${plan.personalization.favoritesUsed ? ` · ${plan.personalization.favoritesUsed} favorite${plan.personalization.favoritesUsed === 1 ? "" : "s"}` : ""}` : " · Explicit preferences applied"}</p></div><div className="planner-save"><span className={`planner-save-state ${dirty ? "is-dirty" : ""}`}>{dirty ? "Unsaved changes" : <><FaCheck aria-hidden="true" />Saved to your account</>}</span>{user ? <Button type="button" className="planner-primary" disabled={!!busy || !dirty || authLoading} onClick={() => runOperation("save", "", serializePlan(plan, {}, true))}>{busy === "save" ? "Saving…" : "Save plan & list"}</Button> : <Link className="planner-primary" to="/login" state={{ from: { pathname: "/meal-planner", search: params.toString() ? `?${params}` : "" } }}>Log in to save</Link>}</div></div>
        <nav className="planner-section-nav" aria-label="Plan sections"><a href="#planner-dinners">Dinners</a><a href="#planner-grocery-heading">Groceries</a><a href="#planner-adjustments">Adjust cooking time</a></nav>
        <PlanConditions plan={plan} />
        {recipeFiltersEdited && <div className="planner-info">You changed the preferences above. Generate again to apply them; swaps keep this plan’s original filters.</div>}
        {weekDiffers && <div className="planner-serving-update"><span>This draft starts on {planDateLabel(plan.weekStart, { month: "short", day: "numeric" })}. Keep its dinners and move it to the selected date? Grocery checkmarks will reset.</span><Button type="button" className="planner-secondary" disabled={!!busy || !isPlanDate(form.weekStart)} onClick={() => recalculate({ weekStart: form.weekStart, checkedItems: [] })}>Move to selected date</Button></div>}
        {servingChange && <div className="planner-serving-update"><span>This plan is for {plan.servings} servings. Update its grocery quantities to {form.servings || "…"}? Grocery checkmarks will reset.</span><Button type="button" className="planner-secondary" disabled={!!busy || !Number.isInteger(Number(form.servings)) || Number(form.servings) < 1 || Number(form.servings) > 12} onClick={() => recalculate({ servings: Number(form.servings), checkedItems: [] })}>Update servings</Button></div>}
        {!!plan.warnings?.length && <div className="planner-warnings"><strong>Before you cook</strong><ul>{plan.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div>}
        <div className="planner-results-grid"><section className="planner-dinner-section" aria-labelledby="planner-dinner-heading"><div className="planner-collection-heading"><h2 id="planner-dinner-heading">Your dinners</h2><span>{plan.meals.length} planned</span></div><div className="planner-dinners" id="planner-dinners">{Array.from({ length: planMealCount(plan) }, (_, dayIndex) => {
          const meal = mealsByDay.get(dayIndex);
          const alternatives = (plan.alternatives || []).filter(recipe => recipe.id !== meal?.recipe.id && !selectedRecipeIds.has(recipe.id));
          const recipeParams = new URLSearchParams({ servings: String(plan.servings) });
          if (plan.settings.householdId) recipeParams.set('householdId', plan.settings.householdId);
          if (plan.id && !dirty) { recipeParams.set('planId', plan.id); recipeParams.set('dayIndex', String(dayIndex)); }
          return <DinnerCard key={`${plan.weekStart}-${dayIndex}`} date={addPlanDays(plan.weekStart, dayIndex)} meal={meal} alternatives={alternatives} busy={!!busy} onSwap={recipeId => swap(dayIndex, recipeId)} recipeSearch={`?${recipeParams}`} />;
        })}</div></section><aside className="planner-groceries" aria-labelledby="planner-grocery-heading"><h2 id="planner-grocery-heading">Groceries</h2><p>Check items you have or bought. Pantry quantities stay unchanged.</p><div className="planner-grocery-progress"><span>{checked.size} of {plan.shoppingList.length} checked</span><progress value={checked.size} max={Math.max(1, plan.shoppingList.length)} aria-label="Grocery checklist progress" /></div><div className="planner-list-actions"><Button type="button" className="planner-secondary" onClick={copyList}><FaClipboardList aria-hidden="true" />Copy list</Button><Button type="button" className="planner-secondary" onClick={downloadList}><FaDownload aria-hidden="true" />Download</Button></div>
          {plan.shoppingList.length ? <ul className="planner-grocery-list">{plan.shoppingList.map(item => <li key={item.key} className={checked.has(item.key) ? "is-checked" : ""}><Field><input type="checkbox" checked={checked.has(item.key)} disabled={!!busy} onChange={() => toggleGrocery(item.key)} /><span><strong>{item.name}</strong><span className="planner-grocery-quantity">{item.quantityText || "Quantity not specified"}</span>{coverageRows.has(item.key) && <span className="planner-stock-quantity">{coverageRows.get(item.key).requiresReview ? "Stock amount needs review" : `Have ${coverageRows.get(item.key).quantityAvailable} ${coverageRows.get(item.key).unit || ""} · Buy ${coverageRows.get(item.key).quantityMissing} ${coverageRows.get(item.key).unit || ""}`}</span>}</span></Field>{(item.requiresReview || coverageRows.get(item.key)?.requiresReview) && <span className="planner-review">Review quantity</span>}{!!item.contributions?.length && <details><summary>Used in {item.contributions.length} dinner{item.contributions.length === 1 ? "" : "s"}</summary><ul>{item.contributions.map((contribution, index) => <li key={`${contribution.recipeId}-${index}`}>{contribution.recipeTitle}: {contribution.quantityText || "quantity not specified"}</li>)}</ul></details>}</li>)}</ul> : <div className="planner-grocery-empty">No ingredient quantities available. Review each recipe before shopping.</div>}
          <p className="planner-grocery-note">Review marked quantities before shopping.{coverage ? " Downloads include only missing stock." : ""}</p>{user ? <div className="planner-publish"><h3>Share your shopping</h3><p>{planScopeName}</p>{publishPreview ? <><p>This replaces {publishPreview.oldCount} saved items with {publishPreview.items.length} items from this plan.</p><div className="planner-list-actions"><Button className="planner-primary" type="button" disabled={publishBusy || !!busy} onClick={() => publish(true)}>Confirm publish</Button><Button className="planner-text-button" type="button" disabled={publishBusy} onClick={() => setPublishPreview(null)}>Cancel</Button></div></> : <Button className="planner-secondary" type="button" disabled={!canPublish || publishBusy || !!busy || coverageLoading} onClick={() => publish()}>Prepare kitchen list</Button>}{publishBusy && <p role="status">Updating kitchen shopping…</p>}<Link className="planner-text-button" to={`/household${plan.settings.householdId ? `?householdId=${plan.settings.householdId}` : ""}`}>Open kitchen shopping</Link></div> : <p className="planner-guest-note">Your draft stays in this tab. Log in, then save your plan.</p>}</aside></div>
        <div className="planner-review-tools" aria-label="Plan checks and adjustments">
        <details className="planner-adjustments" id="planner-adjustments"><summary>Adjust cooking time <span>Preview before applying</span></summary><section className="planner-time-what-if"><div><h3>What if I have less time?</h3><p>Preview faster dinners with your current exclusions, ingredients and budget.</p></div><Field htmlFor="planner-what-if-minutes">Maximum minutes<input id="planner-what-if-minutes" type="number" min="5" max={appliedTime} step="1" value={whatIfTime} disabled={!!busy} onChange={event => setWhatIfTime(event.target.value)} /></Field><Button type="button" className="planner-secondary" disabled={!!busy || !Number.isInteger(Number(whatIfTime)) || Number(whatIfTime) < 5 || Number(whatIfTime) >= appliedTime} onClick={() => runOperation("preview", "/what-if", serializePlan(plan, { maxCookTime: Number(whatIfTime), checkedItems: [] }))}>Preview tighter time</Button></section></details>
        {whatIfPreview && <section className="planner-preview" aria-label="Review dinner preview"><div className="planner-section-heading"><div><h3>Review before applying</h3><p>{effectiveCookingTime(plan)} → {effectiveCookingTime(whatIfPreview.plan)} minutes maximum · {whatIfPreview.plan.meals.length} of {planMealCount(whatIfPreview.plan)} dinners filled.</p></div><span className="planner-small-label">Preview · not applied</span></div><PlanConditions plan={whatIfPreview.plan}/><ul className="planner-preview-dinners">{Array.from({length:planMealCount(whatIfPreview.plan)},(_,dayIndex)=>{const current=mealsByDay.get(dayIndex)?.recipe;const next=whatIfPreview.plan.meals.find(meal=>meal.dayIndex===dayIndex)?.recipe;return <li key={dayIndex}><strong>{planDateLabel(addPlanDays(plan.weekStart,dayIndex))}</strong><span>{current?.title || 'Unfilled'} → {next?.title || 'Unfilled'}</span>{next && <Link to={`/recipes/${next.id}`}>Review new recipe ↗</Link>}</li>;})}</ul><h4>Grocery changes</h4>{previewChanges.length ? <ul className="planner-preview-changes">{previewChanges.map(item=><li key={item.key}><strong>{item.name}</strong>: {item.before} → {item.after}</li>)}</ul> : <p>Ingredient quantities are unchanged.</p>}<p>Observed purchase estimate: {coverageCostText(whatIfPreview.baseline.pantryCoverage || whatIfPreview.beforeCoverage)} → {coverageCostText(whatIfPreview.plan.pantryCoverage)}</p>{whatIfPreview.plan.warnings?.map((warning,index)=><p className="planner-field-help" key={index}>{warning}</p>)}{Number.isFinite(whatIfPreview.plan.budgetStatus?.estimatedCost) && <p>Preview purchases: {whatIfPreview.plan.budgetStatus.estimatedCost.toFixed(2)} {whatIfPreview.plan.budgetStatus.currency}</p>}<div className="planner-list-actions"><Button className="planner-primary" type="button" disabled={!!busy || !whatIfPreview.plan.meals.length} onClick={applyWhatIf}>Apply dinner preview</Button><Button className="planner-secondary" type="button" disabled={!!busy} onClick={()=>setWhatIfPreview(null)}>Discard preview</Button></div><p className="planner-field-help">Applying resets grocery checkmarks and changes only this draft. Save afterwards to keep it.</p></section>}
        {plan.settings.usePantry && <section className="planner-stock-summary" aria-label="Pantry coverage"><div><h3>Stock check · {planScopeName}</h3><p>Stock is shared across dinners. This preview leaves your pantry unchanged.</p></div>{coverageLoading ? <p role="status">Checking quantities and observed prices…</p> : coverageError ? <div className="planner-inline-error"><span>{coverageError}</span><Button type="button" className="planner-text-button" onClick={() => setCoverageRetry(value => value + 1)}>Retry stock check</Button></div> : coverage && <><strong>{coverageCostText(coverage)}</strong><p>{coverage.priceCoverage?.priced ?? 0} of {coverage.priceCoverage?.required ?? 0} purchases have matching observed prices. As of {coverage.asOf}.</p>{coverage.warnings?.map((warning, index) => <p className="planner-field-help" key={index}>{warning}</p>)}<Button className="planner-text-button" type="button" onClick={() => setCoverageRetry(value => value + 1)}>Refresh current stock</Button></>}<Button className="planner-text-button" type="button" disabled={!!busy} onClick={() => runOperation("refreshPrices", "/refresh-prices", serializePlan(plan))}>Refresh observed price quotes</Button><p className="planner-field-help">Refresh replaces this plan’s prices with your latest recorded prices.</p></section>}
        {!!plan.settings.mustUseIngredients?.length && <section className="planner-requirement-result"><h3>Must-use check</h3><p>{plan.mustUseStatus?.satisfied === true ? 'Your required ingredients are covered.' : 'Required ingredients need review before cooking.'}</p>{!!plan.mustUseStatus?.allocations?.length && <ul>{plan.mustUseStatus.allocations.map((allocation, index) => <li key={index}>{allocation.ingredient}: {allocation.quantity} {allocation.unit} · dinner {allocation.dayIndex + 1}</li>)}</ul>}</section>}
        {plan.settings.budget && <section className="planner-requirement-result"><h3>Purchase budget check</h3><p>{plan.budgetStatus?.verified === true && Number.isFinite(plan.budgetStatus.estimatedCost) ? `${plan.budgetStatus.estimatedCost.toFixed(2)} ${plan.budgetStatus.currency} estimated purchases · ${plan.budgetStatus.withinBudget === true ? 'within your budget' : 'over your budget'}` : 'A complete purchase estimate could not be verified from this kitchen’s prices.'}</p><p className="planner-field-help">Based on your recorded prices. Store prices may differ.</p></section>}
        {whatIf && <section className="planner-what-if"><div><h3>Before & after</h3><p>Actual changes from your last swap, servings or tighter-time check.</p></div><p>{whatIf.beforeServings} → {whatIf.afterServings} servings · {whatIf.beforeTime} → {whatIf.afterTime} minutes maximum</p>{whatIf.changes.length ? <ul>{whatIf.changes.map(item => <li key={item.key}><strong>{item.name}</strong><span>{item.before} → {item.after}</span></li>)}</ul> : <p>The ingredient quantities did not change.</p>}{whatIf.beforeCoverage && coverage && <p className="planner-cost-diff">Observed cost: {coverageCostText(whatIf.beforeCoverage)} → {coverageCostText(coverage)}</p>}{Number.isFinite(whatIf.beforeBudget?.estimatedCost) && Number.isFinite(whatIf.afterBudget?.estimatedCost) && <p className="planner-cost-diff">Budget estimate: {whatIf.beforeBudget.estimatedCost.toFixed(2)} → {whatIf.afterBudget.estimatedCost.toFixed(2)} {whatIf.afterBudget.currency}</p>}</section>}
        </div>
      </section> : !savedLoading && <section className="planner-empty"><FaCalendarAlt aria-hidden="true" /><p>Your dinners and grocery list will appear here.</p></section>}
    </div>
  </main>;
}
