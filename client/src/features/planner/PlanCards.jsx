import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaCalendarAlt, FaRegClock, FaUtensils, FaExchangeAlt } from 'react-icons/fa';
import Button from '../../components/ui/Button';
import Field from '../../components/ui/Field';
import RecipeImage from '../../components/RecipeImage';
import { planDateLabel, effectiveCookingTime } from '../../utils/mealPlanner';
function RecipePhoto({ recipe }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [recipe.imageUrl]);
  return recipe.imageUrl && !failed
    ? <RecipeImage src={recipe.imageUrl} alt={recipe.title} loading="lazy" onError={() => setFailed(true)} />
    : <div className="planner-photo-empty"><FaUtensils aria-hidden="true" /><span>Photo unavailable</span></div>;
}

export function PlanConditions({ plan }) {
  const maxTime = effectiveCookingTime(plan);
  const conditions = [
    ["Ingredients", plan.intent.ingredients], ["Excluded", plan.intent.allergies],
    ["Diet", plan.intent.dietaryPreferences], ["Cuisine", plan.intent.cuisines],
    ["Category", plan.intent.categories],
  ].filter(([, values]) => Array.isArray(values) && values.length);
  return <div className="planner-conditions" aria-label="Preferences applied to this plan">
    <span>Up to <strong>{maxTime} minutes</strong></span>
    {conditions.map(([label, values]) => <span key={label}>{label}: <strong>{values.join(", ")}</strong></span>)}
    {!!plan.settings.excludedIngredients?.length && <span>Manual exclusions: <strong>{plan.settings.excludedIngredients.join(", ")}</strong></span>}
    {!!plan.settings.mustUseIngredients?.length && <span>Must use {plan.settings.mustUseScope === 'plan' ? 'across this plan' : 'in every dinner'}: <strong>{plan.settings.mustUseIngredients.join(', ')}</strong></span>}
    {plan.settings.budget && <span>Purchase budget: <strong>{plan.settings.budget.amount.toFixed(2)} {plan.settings.budget.currency}</strong></span>}
  </div>;
}

export function DinnerCard({ date, meal, alternatives, busy, onSwap, recipeSearch = '' }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const recipe = meal?.recipe;
  useEffect(() => { setOpen(false); setSelected(""); }, [recipe?.id]);
  return <article className={`planner-dinner ${recipe ? "" : "is-empty"}`}>
    <div className="planner-dinner-date"><FaCalendarAlt aria-hidden="true" />{planDateLabel(date)}</div>
    {recipe ? <>
      <Link className="planner-dinner-photo" to={`/recipes/${encodeURIComponent(recipe.id)}${recipeSearch}`}><RecipePhoto recipe={recipe} /></Link>
      <div className="planner-dinner-body">
        <h3><Link to={`/recipes/${encodeURIComponent(recipe.id)}${recipeSearch}`}>{recipe.title}</Link></h3>
        <div className="planner-dinner-meta"><FaRegClock aria-hidden="true" />{recipe.cookingTime > 0 ? `${recipe.cookingTime} min` : "Time not listed"}</div>
        {meal.reuse && <p className="planner-leftover-note">Use {meal.reuse.servingsUsed} prepared servings. <Link to={`/pantry${recipeSearch.includes('householdId=') ? `?householdId=${new URLSearchParams(recipeSearch).get('householdId')}` : ''}`}>Record eaten portions in Pantry</Link></p>}
        {!!recipe.matchReasons?.length && <details className="planner-recipe-details"><summary>Why this dinner?</summary><ul className="planner-reasons">{recipe.matchReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></details>}
      </div>
    </> : <div className="planner-dinner-body"><h3>No matching dinner</h3><p>The available recipes could not fill this day with your current preferences.</p></div>}
    <div className="planner-swap">
      {alternatives.length ? <>
        <Button className="planner-text-button" type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}><FaExchangeAlt aria-hidden="true" />{recipe ? "Swap dinner" : "Choose a matching dinner"}</Button>
        {open && <div className="planner-swap-controls">
          <Field htmlFor={`swap-${date}`}>Matching alternatives</Field>
          <select id={`swap-${date}`} value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
            <option value="">Choose a recipe</option>{alternatives.map(item => <option key={item.id} value={item.id}>{item.title}{item.cookingTime > 0 ? ` · ${item.cookingTime} min` : ""}</option>)}
          </select>
          <Button className="planner-secondary" type="button" disabled={!selected || busy} onClick={() => onSwap(selected)}>Use this dinner</Button>
          <p>Swapping updates groceries and keeps your preferences.</p>
        </div>}
      </> : <p className="planner-no-alternatives">No other matching recipes available.</p>}
    </div>
  </article>;
}
