import Alert from "../components/ui/Alert";
import { cancelAiRequest } from "../utils/aiControl";
import Leftovers from "../features/growth/Leftovers";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaCamera, FaLeaf, FaPlus, FaRegClock } from "react-icons/fa";
import KitchenShell from "../components/KitchenShell";
import RecipeImage from "../components/RecipeImage";
import { useKitchen, useKitchenResource } from "../utils/useKitchen";
import { lotPayload, prepareLotCreation } from "../utils/kitchen";
import { sunnyRequest } from "../utils/sunnyApi";
import { readPhoto, sunnyImageError } from "../utils/sunny";
import { PLANNER_DIETS, isPlanDate, splitExcludedIngredients } from "../utils/mealPlanner";

const emptyLot = { ingredient: "", quantity: "", unit: "", useBy: "", purchasedOn: "", location: "", note: "" };
const today = () => new Date().toISOString().slice(0, 10);

function PantryContent() {
  const { data, mutate, busy, canEdit, setError, setNotice } = useKitchen();
  const [form, setForm] = useState(emptyLot);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [photoRows, setPhotoRows] = useState([]);
  const [photoWarnings, setPhotoWarnings] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [price, setPrice] = useState({ ingredient: "", unit: "", packQuantity: "", packPrice: "", currency: "USD", area: 'Local', source: "", observedOn: today() });
  const [suggestion, setSuggestion] = useState({ prompt: "", available: "", mustUse: "", exclude: "", maxCookTime: "45", dietaryPreferences: [], usePantry: true });
  const [results, setResults] = useState(null);
  const [suggestionError, setSuggestionError] = useState("");
  const visionRef = useRef(null);
  const fileRef = useRef(null);
  const lotCreationRef = useRef(null);
  const entryRef = useRef(null);
  const photoKeyRef = useRef(crypto.randomUUID());
  const photoRequestsRef = useRef(new Map());
  const ledger = useKitchenResource("/ledger");
  useEffect(() => () => visionRef.current?.abort(), []);
  useEffect(() => { if (editing) { entryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); entryRef.current?.querySelector("input")?.focus({ preventScroll: true }); } }, [editing]);
  const changeSuggestion = value => { setResults(null); setSuggestionError(""); setSuggestion(value); };
  useEffect(() => { if (!photo) { setPreview(""); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  const saveLot = async event => {
    event.preventDefault();
    try {
      let payload = lotPayload(form, editing?.version);
      if (!editing) { lotCreationRef.current = prepareLotCreation(payload, data.scope.revision, lotCreationRef.current); payload = lotCreationRef.current.body; }
      const result = await mutate(editing ? "Update pantry lot" : "Add pantry lot", editing ? `/pantry/${editing.id}` : "/pantry", payload, editing ? "PATCH" : "POST");
      if (result) { lotCreationRef.current = null; setForm(emptyLot); setEditing(null); }
    } catch (failure) { setError(failure.message); }
  };
  const analyze = async file => {
    const validation = sunnyImageError(file);
    if (validation) { setError(validation); return; }
    visionRef.current?.abort(); const controller = new AbortController(); visionRef.current = controller;
    photoKeyRef.current = crypto.randomUUID(); photoRequestsRef.current.clear();
    setPhoto(file); setPhotoRows([]); setPhotoWarnings([]); setReviewed(false); setPhotoBusy(true); setError("");
    try {
      const imageBase64 = await readPhoto(file, controller.signal);
      const reply = await sunnyRequest("vision", { body: { imageBase64 }, signal: controller.signal });
      if (controller.signal.aborted) return;
      setPhotoRows((reply.ingredients || []).map(ingredient => ({ ...emptyLot, ingredient, lineId: crypto.randomUUID(), added: false })));
      setPhotoWarnings(reply.warnings || []);
      if (!reply.ingredients?.length) setPhotoWarnings([...(reply.warnings || []), "No ingredients identified. Add stock by hand or try another photo."]);
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (visionRef.current === controller) { visionRef.current = null; setPhotoBusy(false); } }
  };
  const addPhotoLots = async () => {
    try {
      const pending = photoRows.map((row, index) => ({ row, index })).filter(({ row }) => !row.added);
      const validated = pending.map(({ row, index }) => ({ index, row, payload: lotPayload(row) }));
      let aggregateRevision = data.scope.revision;
      for (const item of validated) {
        const prepared = prepareLotCreation(item.payload, aggregateRevision, photoRequestsRef.current.get(item.row.lineId), { idempotencyKey: photoKeyRef.current, lineId: item.row.lineId });
        photoRequestsRef.current.set(item.row.lineId, prepared);
        const result = await mutate("Add reviewed photo lot", "/pantry", prepared.body);
        if (!result) return;
        aggregateRevision = Math.max(aggregateRevision, result.aggregateRevision);
        setPhotoRows(rows => rows.map((row, index) => index === item.index ? { ...row, added: true } : row));
      }
      setNotice("Ingredients added. Blank quantities stay unknown.");
    } catch (failure) { setError(failure.message); }
  };
  const savePrice = async event => {
    event.preventDefault();
    if (!price.area.trim() || price.area.length > 200) { setError('Enter the area where you found this price (up to 200 characters).'); return; }
    if (!(Number(price.packQuantity) > 0) || !(Number(price.packPrice) > 0) || !price.unit.trim() || !/^[A-Z]{3}$/.test(price.currency) || !isPlanDate(price.observedOn) || price.observedOn > today()) { setError("Check the pack size, price, unit and currency. The date must be today or earlier."); return; }
    const saved = await mutate("Save observed price", "/prices", { ...price, ingredient: price.ingredient.trim(), packQuantity: Number(price.packQuantity), packPrice: Number(price.packPrice) });
    if (saved) setPrice({ ...price, ingredient: "", packQuantity: "", packPrice: "", source: "" });
  };
  const suggest = async event => {
    event.preventDefault();
    setSuggestionError("");
    try {
      if (!Number.isInteger(Number(suggestion.maxCookTime)) || Number(suggestion.maxCookTime) < 5 || Number(suggestion.maxCookTime) > 240) { setSuggestionError("Choose 5–240 minutes."); return; }
      const availableIngredients = splitExcludedIngredients(suggestion.available);
      const mustUseIngredients = splitExcludedIngredients(suggestion.mustUse);
      const excludedIngredients = splitExcludedIngredients(suggestion.exclude);
      for (const [label, ingredients, limit] of [["Available", availableIngredients, 100], ["Must-use", mustUseIngredients, 20], ["Excluded", excludedIngredients, 30]]) {
        if (ingredients.length > limit) throw new Error(`List up to ${limit} ${label.toLowerCase()} ingredients.`);
        if (ingredients.some(ingredient => ingredient.length > 60)) throw new Error(`${label} ingredient names must be 60 characters or fewer.`);
      }
      const response = await mutate("Find dinners from your pantry", "/suggestions", { prompt: suggestion.prompt.trim(), maxCookTime: Number(suggestion.maxCookTime), dietaryPreferences: suggestion.dietaryPreferences, availableIngredients, mustUseIngredients, excludedIngredients, usePantry: suggestion.usePantry }, undefined, false);
      if (response) setResults(response);
    } catch (failure) { setSuggestionError(failure.message); }
  };
  return <>
    <div className="kitchen-workspace kitchen-pantry-workspace"><div className="kitchen-task-main">
      <section className="kitchen-panel"><div className="kitchen-panel-heading"><div><h2>Your pantry</h2><p>{data.pantry?.length || 0} batches</p></div><FaLeaf aria-hidden="true" /></div>
      {data.pantry?.length ? <ul className="kitchen-lot-list">{data.pantry.map(lot => <li key={lot.id}><div><h3>{lot.ingredient}</h3><p>{lot.quantity === null ? "Quantity unknown" : `${lot.quantity} ${lot.unit || ""}`}{lot.location ? ` · ${lot.location}` : ""}</p><span className={lot.useBy && lot.useBy < today() ? "kitchen-expired" : "kitchen-muted"}>{lot.useBy ? `Use by ${lot.useBy}${lot.useBy < today() ? " · excluded from available stock" : ""}` : "No use-by date"}</span>{lot.note && <p className="kitchen-help">{lot.note}</p>}</div>{canEdit && <div className="kitchen-actions">{removing === lot.id ? <><span>Remove this batch?</span><Button className="kitchen-secondary" type="button" disabled={!!busy} onClick={async () => { if (await mutate("Remove pantry lot", `/pantry/${lot.id}?version=${lot.version}`, undefined, "DELETE")) setRemoving(null); }}>Remove batch</Button><Button className="kitchen-text-button" type="button" onClick={() => setRemoving(null)}>Cancel</Button></> : <><Button className="kitchen-secondary" type="button" disabled={!!busy} onClick={() => { setEditing(lot); setForm({ ...lot, quantity: lot.quantity ?? "", useBy: lot.useBy || "", purchasedOn: lot.purchasedOn || "" }); }}>Edit</Button><Button className="kitchen-text-button kitchen-danger" type="button" disabled={!!busy} onClick={() => setRemoving(lot.id)}>Remove</Button></>}</div>}</li>)}</ul> : <div className="kitchen-empty-small">Your pantry is empty. Add stock or try a photo.</div>}
    </section>


    <Leftovers />
    </div><aside className="kitchen-context" aria-label="Stock entry">
      <div className="kitchen-grid-two kitchen-entry-grid"><section className="kitchen-panel" id="pantry-entry" ref={entryRef}><details className="kitchen-disclosure" open={!!editing || !data.pantry?.length}><summary><span><FaPlus aria-hidden="true" />{editing ? "Edit stock" : "Add stock"}</span></summary><p>Keep separate batches for different use-by dates.</p>
      {!canEdit ? <p className="kitchen-empty-small">Ask the owner for permission to edit stock.</p> : <form onSubmit={saveLot}><fieldset disabled={!!busy}><div className="kitchen-form-grid"><Field>Ingredient<input value={form.ingredient} maxLength="100" required onChange={event => setForm({ ...form, ingredient: event.target.value })} placeholder="Rice" /></Field><Field>Quantity<input type="number" min="0.000001" step="any" value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })} placeholder="Unknown" /></Field><Field>Unit<input value={form.unit} maxLength="40" onChange={event => setForm({ ...form, unit: event.target.value })} placeholder="g, ml, pieces…" /></Field><Field>Use by<input type="date" value={form.useBy} onChange={event => setForm({ ...form, useBy: event.target.value })} /></Field><Field>Purchased on<input type="date" value={form.purchasedOn} onChange={event => setForm({ ...form, purchasedOn: event.target.value })} /></Field><Field>Location<input value={form.location} maxLength="100" onChange={event => setForm({ ...form, location: event.target.value })} placeholder="Fridge, cupboard…" /></Field></div><Field>Notes<textarea rows="2" value={form.note} maxLength="1000" onChange={event => setForm({ ...form, note: event.target.value })} /></Field><p className="kitchen-help">Leave unknown quantities blank. Use matching ingredient names and units.</p><div className="kitchen-actions kitchen-action-bar"><Button className="kitchen-primary" type="submit">{editing ? "Save stock" : "Add stock"}</Button>{editing && <Button className="kitchen-secondary" type="button" onClick={() => { setEditing(null); setForm(emptyLot); }}>Cancel edit</Button>}</div></fieldset></form>}
    </details></section><section className="kitchen-panel kitchen-photo-panel"><details className="kitchen-disclosure"><summary><span><FaCamera aria-hidden="true" />Add from a photo</span></summary><p>Review Sunny’s suggestions before adding stock.</p>
      <input ref={fileRef} className="kitchen-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={!canEdit || photoBusy || !!busy} onChange={event => { if (event.target.files?.[0]) analyze(event.target.files[0]); }} aria-label="Choose a pantry photo" />
      <p className="kitchen-help">JPG, PNG or WebP · 5 MB max. You confirm every addition.</p>{preview && <img className="kitchen-photo-preview" src={preview} alt="Your pantry photo for ingredient review" />}
      {photoBusy && <div className="kitchen-actions"><span role="status">Identifying ingredients…</span><Button type="button" className="kitchen-secondary" onClick={() => { void cancelAiRequest(visionRef.current?.signal); visionRef.current?.abort(); visionRef.current = null; setPhotoBusy(false); }}>Cancel</Button></div>}
      {photoWarnings.map((warning, index) => <p className="kitchen-note" key={index}>{warning}</p>)}
      {!!photoRows.length && <div className="kitchen-photo-review"><h3>Check the ingredients</h3>{photoRows.map((row, index) => <div className="kitchen-photo-row" key={index}><Field>Ingredient<input value={row.ingredient} disabled={row.added || !!busy} onChange={event => { setReviewed(false); setPhotoRows(rows => rows.map((item, position) => position === index ? { ...item, ingredient: event.target.value, lineId: crypto.randomUUID() } : item)); }} /></Field><Field>Quantity<input type="number" step="any" min="0.000001" value={row.quantity} placeholder="Unknown" disabled={row.added || !!busy} onChange={event => { setReviewed(false); setPhotoRows(rows => rows.map((item, position) => position === index ? { ...item, quantity: event.target.value, lineId: crypto.randomUUID() } : item)); }} /></Field><Field>Unit<input value={row.unit} disabled={row.added || !!busy} onChange={event => { setReviewed(false); setPhotoRows(rows => rows.map((item, position) => position === index ? { ...item, unit: event.target.value, lineId: crypto.randomUUID() } : item)); }} /></Field>{row.added ? <span>Added</span> : <Button type="button" className="kitchen-text-button" disabled={!!busy} onClick={() => { setReviewed(false); setPhotoRows(rows => rows.filter((_, position) => position !== index)); }}>Remove</Button>}</div>)}<Field className="kitchen-checkbox"><input type="checkbox" checked={reviewed} disabled={!!busy} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed the ingredient names and quantities.</span></Field><Button className="kitchen-primary" type="button" disabled={!reviewed || !!busy || !photoRows.some(row => !row.added)} onClick={addPhotoLots}>Add confirmed stock</Button></div>}
    </details></section></div>
    </aside></div>

    <section className="kitchen-panel" id="pantry-suggestions"><div className="kitchen-panel-heading"><div><h2>What can I cook?</h2><p>Results must follow your must-use ingredients and exclusions.</p></div><FaRegClock aria-hidden="true" /></div><form onSubmit={suggest}><fieldset disabled={!!busy}><div className="kitchen-form-grid"><Field>Also available<input value={suggestion.available} onChange={event => changeSuggestion({ ...suggestion, available: event.target.value })} placeholder="Mushrooms, carrots" /></Field><Field>Must use<input value={suggestion.mustUse} onChange={event => changeSuggestion({ ...suggestion, mustUse: event.target.value })} placeholder="Spinach" /></Field><Field>Exclude<input value={suggestion.exclude} onChange={event => changeSuggestion({ ...suggestion, exclude: event.target.value })} placeholder="Peanuts" /></Field><Field>Time limit (minutes)<input type="number" min="5" max="240" value={suggestion.maxCookTime} onChange={event => changeSuggestion({ ...suggestion, maxCookTime: event.target.value })} /></Field></div><Field>What sounds good?<textarea maxLength="2000" rows="2" value={suggestion.prompt} onChange={event => changeSuggestion({ ...suggestion, prompt: event.target.value })} placeholder="A comforting dinner with what I have" /></Field><div className="kitchen-chips">{PLANNER_DIETS.map(diet => <Field className="kitchen-checkbox" key={diet.value}><input type="checkbox" checked={suggestion.dietaryPreferences.includes(diet.value)} onChange={event => changeSuggestion({ ...suggestion, dietaryPreferences: event.target.checked ? [...suggestion.dietaryPreferences, diet.value] : suggestion.dietaryPreferences.filter(value => value !== diet.value) })} />{diet.label}</Field>)}</div><Field className="kitchen-checkbox"><input type="checkbox" checked={suggestion.usePantry} onChange={event => changeSuggestion({ ...suggestion, usePantry: event.target.checked })} />Use my unexpired pantry stock</Field>{suggestionError && <Alert as="p" className="kitchen-error">{suggestionError}</Alert>}<div className="kitchen-action-bar"><Button className="kitchen-primary" type="submit">{busy === "Find dinners from your pantry" ? "Finding recipes…" : "Find matching recipes"}</Button></div></fieldset></form>
      {results && <div className="kitchen-suggestions">{results.warnings?.map((warning, index) => <p className="kitchen-note" key={index}>{warning}</p>)}{results.recipes?.length ? <div className="kitchen-recipe-grid">{results.recipes.map(recipe => <article className="kitchen-recipe-card" key={recipe.id}><Link to={`/recipes/${recipe.id}`}>{recipe.imageUrl && <RecipeImage src={recipe.imageUrl} alt={recipe.title} loading="lazy" />}<h3>{recipe.title}</h3></Link><p>{recipe.cookingTime > 0 ? `${recipe.cookingTime} minutes` : "Time not listed"}</p>{recipe.matchReasons?.map((reason, index) => <p className="kitchen-help" key={index}>{reason}</p>)}</article>)}</div> : <div className="kitchen-empty-small">No matches. Try different ingredients or more time. Your exclusions still apply.</div>}</div>}
    </section>

    <div className="kitchen-grid-two"><section className="kitchen-panel" id="pantry-prices"><h2>Prices</h2><p>Add pack prices for matching ingredients and units.</p>{canEdit && <details className="kitchen-disclosure kitchen-disclosure-secondary"><summary>Add a price</summary><form onSubmit={savePrice}><fieldset disabled={!!busy}><div className="kitchen-form-grid">{[["ingredient", "Ingredient", "text"], ["unit", "Unit", "text"], ["packQuantity", "Pack quantity", "number"], ["packPrice", "Pack price", "number"], ["currency", "Currency", "text"], ["area", "Price area", "text"], ["observedOn", "Observed on", "date"]].map(([field, label, type]) => <Field key={field}>{label}<input type={type} maxLength={field === "area" ? 200 : field === "currency" ? 3 : undefined} step={type === "number" ? "any" : undefined} min={field === "packPrice" ? "0" : type === "number" ? "0.000001" : undefined} required value={price[field]} onChange={event => setPrice({ ...price, [field]: field === "currency" ? event.target.value.toUpperCase() : event.target.value })} /></Field>)}</div><Field>Store or source<input value={price.source} maxLength="500" required onChange={event => setPrice({ ...price, source: event.target.value })} placeholder="Store, receipt or price label" /></Field><Button className="kitchen-primary" type="submit">Save price</Button></fieldset></form></details>}
      <ul className="kitchen-simple-list">{(data.priceBook || []).map(item => <li key={item.id}><span><strong>{item.ingredient}</strong> · {item.packQuantity} {item.unit} for {item.packPrice} {item.currency}<small>{item.area || "Local"} · {item.source} · {item.observedOn}</small></span>{canEdit && <Button className="kitchen-text-button" type="button" disabled={!!busy} onClick={() => mutate("Remove price", `/prices/${item.id}`, undefined, "DELETE")}>Remove</Button>}</li>)}</ul>{!data.priceBook?.length && <p className="kitchen-empty-small">Add prices to see cost estimates.</p>}
    </section><section className="kitchen-panel" id="pantry-ledger"><details className="kitchen-disclosure"><summary>Stock history</summary>{ledger.loading ? <p role="status">Loading stock history…</p> : ledger.error ? <div className="kitchen-error"><p>{ledger.error}</p><Button className="kitchen-secondary" type="button" onClick={ledger.reload}>Reload history</Button></div> : ledger.data?.entries?.length ? <ul className="kitchen-simple-list">{ledger.data.entries.map(entry => <li key={entry.id}><div><strong>{entry.ingredient}</strong><p>{entry.action} · {entry.delta === null ? "Unknown amount" : `${entry.delta} ${entry.unit || ""}`}</p><small>{entry.actorName} · {new Date(entry.createdAt).toLocaleString("en")}</small></div></li>)}</ul> : <p className="kitchen-empty-small">Stock changes will appear here.</p>}</details></section></div>
  </>;
}

export default function Pantry() { return <KitchenShell title="Pantry" intro="Keep track of stock and find dinner ideas."><PantryContent /></KitchenShell>; }
