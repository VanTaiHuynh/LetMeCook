import Alert from "../components/ui/Alert";
import { cancelAiRequest } from "../utils/aiControl";
import SunnyClarification from "../features/sunny/SunnyClarification";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FaArrowRight, FaCamera, FaCheck, FaLeaf, FaSearch, FaSpinner, FaTimes } from "react-icons/fa";
import RecipeImage from "../components/RecipeImage";
import { sunnyChef as chef } from "../utils/siteAsset";
import { sunnyRequest } from "../utils/sunnyApi";
import { normalizeIngredients, readPhoto, sunnyImageError } from "../utils/sunny";
import "./Sunny.css";

const EXAMPLES = [
  { label: "A quick dinner", prompt: "A quick dinner with chicken and broccoli, under 30 minutes. No peanuts." },
  { label: "Plant-based ideas", prompt: "Vegan dinner with mushrooms and rice. No dairy or nuts." },
  { label: "One-pot comfort", prompt: "A comforting one-pot dinner with potatoes and carrots, under 45 minutes." },
];

function IntentSummary({ intent }) {
  const groups = [
    ["Ingredients", intent.ingredients], ["Exclude allergens", intent.allergies],
    ["Diet", intent.dietaryPreferences], ["Cuisine", intent.cuisines], ["Category", intent.categories],
  ];
  return <div className="sunny-intent" aria-label="Understood search conditions">
    {intent.keyword && <span className="sunny-condition">Looking for <strong>{intent.keyword}</strong></span>}
    {groups.map(([label, values]) => Array.isArray(values) && values.length > 0
      ? <span key={label} className={`sunny-condition ${label === "Exclude allergens" ? "sunny-exclusion" : ""}`}>
        {label}: <strong>{values.join(", ")}</strong>
      </span> : null)}
    {intent.maxCookingTime > 0 && <span className="sunny-condition">Up to <strong>{intent.maxCookingTime} minutes</strong></span>}
  </div>;
}

export default function Sunny() {
  const { user, loading: authLoading } = useAuth();
  const actorId = user?.id || null;
  const [clarification, setClarification] = useState(null);
  const [params] = useSearchParams();
  const [prompt, setPrompt] = useState(() => (params.get("prompt") || "").slice(0, 2000));
  const initialIngredients = normalizeIngredients(params.getAll("ingredients"));
  const [draftIngredients, setDraftIngredients] = useState(initialIngredients);
  const [confirmedIngredients, setConfirmedIngredients] = useState(initialIngredients);
  const [confirmed, setConfirmed] = useState(initialIngredients.length > 0);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [observations, setObservations] = useState([]);
  const [visionWarnings, setVisionWarnings] = useState([]);
  const [visionBusy, setVisionBusy] = useState(false);
  const [visionError, setVisionError] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [statusVersion, setStatusVersion] = useState(0);
  const fileRef = useRef(null);
  const visionRequest = useRef(null);
  const searchRequest = useRef(null);
  const resultRef = useRef(null);

  const query = params.toString();
  useEffect(() => {
    visionRequest.current?.abort(); searchRequest.current?.abort();
    visionRequest.current = null; searchRequest.current = null;
    const current = new URLSearchParams(query);
    const ingredients = normalizeIngredients(current.getAll("ingredients"));
    setPrompt((current.get("prompt") || "").slice(0, 2000));
    setDraftIngredients(ingredients); setConfirmedIngredients(ingredients); setConfirmed(ingredients.length > 0);
    setPhoto(null); setObservations([]); setVisionWarnings([]); setVisionError(""); setSearchError("");
    setVisionBusy(false); setSearchBusy(false); setResult(null); setClarification(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [query, actorId]);

  useEffect(() => {
    const controller = new AbortController();
    setStatusError("");
    sunnyRequest("status", { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setStatus(data); }).catch((error) => {
      if (!controller.signal.aborted && error.name !== "AbortError") { setStatus(null); setStatusError(error.message); }
    });
    return () => controller.abort();
  }, [statusVersion]);

  useEffect(() => {
    if (!photo) { setPreview(""); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => () => {
    visionRequest.current?.abort();
    searchRequest.current?.abort();
  }, []);

  const clearResults = () => { setResult(null); setClarification(null); setSearchError(""); };
  const changePrompt = (value) => { setPrompt(value); clearResults(); };

  const clearPhoto = () => {
    void cancelAiRequest(visionRequest.current?.signal);
    clearResults();
    visionRequest.current?.abort();
    visionRequest.current = null;
    setVisionBusy(false);
    setPhoto(null);
    setDraftIngredients([]);
    setConfirmedIngredients([]);
    setConfirmed(false);
    setObservations([]);
    setVisionWarnings([]);
    setVisionError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const analyzePhoto = async (file) => {
    const validationError = sunnyImageError(file);
    if (validationError) { setVisionError(validationError); return; }
    visionRequest.current?.abort();
    const controller = new AbortController();
    visionRequest.current = controller;
    clearResults();
    setPhoto(file);
    setVisionBusy(true);
    setVisionError("");
    setDraftIngredients([]);
    setConfirmedIngredients([]);
    setConfirmed(false);
    setObservations([]);
    setVisionWarnings([]);
    try {
      const imageBase64 = await readPhoto(file, controller.signal);
      const data = await sunnyRequest("vision", { body: { imageBase64 }, signal: controller.signal });
      if (visionRequest.current !== controller || controller.signal.aborted) return;
      if (!Array.isArray(data.ingredients)) throw new Error("Sunny could not identify ingredients. Enter them manually or try another photo.");
      setDraftIngredients(normalizeIngredients(data.ingredients));
      setObservations(Array.isArray(data.observations) ? data.observations : []);
      setVisionWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      if (!data.ingredients.length) setVisionError("No ingredients were identified. Add them manually or try a clearer photo.");
    } catch (error) {
      if (controller.signal.aborted || visionRequest.current !== controller) return;
      setVisionError(error.message || "Could not analyze the photo.");
    } finally {
      if (visionRequest.current === controller) setVisionBusy(false);
    }
  };

  const editIngredient = (index, value) => {
    clearResults();
    setDraftIngredients((items) => items.map((item, position) => position === index ? value : item));
    setConfirmed(false);
    setConfirmedIngredients([]);
  };

  const search = async (event, answers) => {
    event?.preventDefault();
    if (searchBusy || visionBusy || authLoading) return;
    if (photo && !confirmed) { setSearchError("Review and confirm the photo ingredients first, or remove the photo to search with text only."); return; }
    if (draftIngredients.length && !confirmed) { setSearchError("Confirm the ingredient list before searching."); return; }
    if (!prompt.trim() && !confirmedIngredients.length) { setSearchError("Describe what you want to cook, or add ingredients."); return; }
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearchBusy(true);
    setSearchError("");
    setResult(null);
    try {
      const data = await sunnyRequest("search", {
        body: { prompt: answers ? clarification.originalPrompt : prompt.trim(), confirmedIngredients,
          ...(answers ? { clarificationContext: clarification.context, clarificationAnswers: answers } : {}) },
        signal: controller.signal, actorId,
      });
      if (searchRequest.current !== controller || controller.signal.aborted) return;
      if (!data.intent || !Array.isArray(data.recipes)) throw new Error("Sunny returned an incomplete search. Please try again.");
      if (data.status === "needs_clarification") {
        const followUp = data.clarification;
        if (!followUp?.context || !Array.isArray(followUp.questions) || followUp.questions.length < 1 || followUp.questions.length > 2
            || followUp.questions.some(item => !item.id || typeof item.question !== "string")) throw new Error("Sunny could not prepare its questions. Edit your request and try again.");
        setClarification({ ...followUp, originalPrompt: prompt.trim(), intent: data.intent });
      } else { setClarification(null); setResult(data); }
      setStatusVersion((version) => version + 1);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start",
      }));
    } catch (error) {
      if (controller.signal.aborted || searchRequest.current !== controller) return;
      setSearchError(error.message || "Could not search recipes. Please try again.");
    } finally {
      if (searchRequest.current === controller) setSearchBusy(false);
    }
  };

  const cancelSearch = () => {
    void cancelAiRequest(searchRequest.current?.signal);
    searchRequest.current?.abort();
    searchRequest.current = null;
    setSearchBusy(false);
    setSearchError("Search cancelled. You can change your request and try again.");
  };

  const ready = status?.status === "ready";
  const resultWarnings = Array.isArray(result?.warnings)
    ? [...new Set(result.warnings.filter(warning => typeof warning === "string" && warning.trim()))] : [];
  return <main className="sunny-page">
    <div className="sunny-shell">
      <div className="sunny-topline">
        <span role="status" className={`sunny-status ${ready ? "is-ready" : ""}`}><span />
          {status ? (ready ? "Local AI ready" : "Local AI unavailable") : statusError ? "AI status unavailable" : "Checking local AI…"}
        </span>
        <Link to="/recipes">Browse all recipes <FaArrowRight aria-hidden="true" /></Link>
      </div>
      <header className="sunny-hero">
        <div>
          <h1>Find dinner with Sunny</h1>
          <p className="sunny-intro">Find recipes for your ingredients, tastes and time.</p>
          <p className="sunny-language">English or Vietnamese.</p>
        </div>
        <div className="sunny-hero-art"><img src={chef} alt="Sunny the Chef" />

        </div>
      </header>

      <div className="sunny-desk"><div className="sunny-conversation">
      <form className="sunny-workspace" onSubmit={search} aria-busy={searchBusy || visionBusy}>
        <section className="sunny-compose">
          <div className="sunny-section-heading"><span className="sunny-step"><FaSearch aria-hidden="true" /></span><div><h2>What sounds good?</h2></div></div>
          <Field htmlFor="sunny-prompt">Your request</Field>
          <textarea id="sunny-prompt" aria-describedby="sunny-prompt-help sunny-profile-help" maxLength={2000} rows={4} value={prompt} disabled={searchBusy}
            onChange={(event) => changePrompt(event.target.value)}
            placeholder="Chicken and carrots, under 30 minutes. No peanuts." />
          <div className="sunny-input-caption"><span id="sunny-prompt-help">Add your time limit and foods to exclude.</span><span>{prompt.length}/2000</span></div>
          <div className="sunny-submit-row">
            <Button className="sunny-primary" type="submit" disabled={searchBusy || visionBusy || authLoading || (photo && !confirmed)}>
              {searchBusy ? <><FaSpinner className="sunny-spinner" aria-hidden="true" /> Finding recipes…</> : <>Find my recipes <FaArrowRight aria-hidden="true" /></>}
            </Button>
            {searchBusy && <Button type="button" className="sunny-text-button" onClick={cancelSearch}>Cancel search</Button>}
          </div>
          {searchBusy && <div role="status" className="sunny-processing"><strong>Finding recipes…</strong><p>The first search may take a little longer.</p></div>}
          {photo && !confirmed && !visionBusy && <p className="sunny-confirm-hint">Review and confirm the photo ingredients before searching.</p>}
          {searchError && <Alert as="p" className="sunny-error">{searchError}</Alert>}
          <div className="sunny-examples" aria-label="Example requests">{EXAMPLES.map((example) => <Button type="button" key={example.label} disabled={searchBusy} onClick={() => changePrompt(example.prompt)}>{example.label} <FaArrowRight aria-hidden="true" /></Button>)}</div>
          <p id="sunny-profile-help" className="sunny-profile-note">Add allergies here. Saved profile preferences are not applied to this search.</p>
        </section>


      </form>

      {clarification && <section ref={resultRef} className="sunny-results">
        <IntentSummary intent={clarification.intent} />
        <SunnyClarification key={clarification.context.signature || clarification.originalPrompt} clarification={clarification}
          busy={searchBusy} error={searchError} onSubmit={answers => search(null, answers)}
          onEdit={() => { setClarification(null); document.getElementById("sunny-prompt")?.focus(); }} />
      </section>}
      {result && <section className="sunny-results" ref={resultRef} aria-live="polite">
        <div className="sunny-results-heading"><div><h2>{result.recipes.length ? "Your recipe matches" : "Let’s adjust the request"}</h2></div>
          <p>{result.recipes.length} shown · {Number(result.totalMatches || 0).toLocaleString()} matches</p></div>
        <IntentSummary intent={result.intent} />
        <p className="sunny-allergy-note">For allergies, check the full recipe and packaging. Unlisted allergens and cross-contact remain unknown.</p>
        {!!resultWarnings.length && <details className="sunny-warning-details"><summary>Recipe data notes ({resultWarnings.length})</summary>{resultWarnings.map(warning => <p className="sunny-notice" key={warning}>{warning}</p>)}</details>}
        {!result.recipes.length && <div className="sunny-empty"><FaLeaf aria-hidden="true" /><h3>No recipes match these conditions yet.</h3><p>Try fewer required ingredients, more cooking time or a broader dish request. Keep any allergy exclusions you need.</p><Button type="button" className="sunny-text-button" onClick={() => document.getElementById("sunny-prompt")?.focus()}>Edit my request <FaArrowRight aria-hidden="true" /></Button></div>}
        <div className="sunny-recipe-grid">{result.recipes.map((recipe) => <article className="sunny-recipe" key={recipe.id}>
          <Link className="sunny-recipe-image" to={`/recipes/${recipe.id}`}>{recipe.imageUrl && <RecipeImage src={recipe.imageUrl} alt={recipe.title} loading="lazy" />}{recipe.cookingTime > 0 && <span>{recipe.cookingTime} min</span>}</Link>
          <div className="sunny-recipe-body"><h3><Link to={`/recipes/${recipe.id}`}>{recipe.title}</Link></h3>
            {recipe.servings > 0 && <p className="sunny-yield">Serves {recipe.servings}</p>}
            {!!recipe.matchReasons?.length && <details className="sunny-match-details"><summary>Why this recipe?</summary><ul className="sunny-match-reasons">{recipe.matchReasons.map((reason, index) => <li key={index}><FaCheck aria-hidden="true" />{reason}</li>)}</ul></details>}
            <div className="sunny-recipe-footer"><Link to={`/recipes/${recipe.id}`}>View recipe <FaArrowRight aria-hidden="true" /></Link></div>
          </div>
        </article>)}</div>
        {result.model && <details className="sunny-result-model"><summary>Search details</summary><p>Local model: {result.model}{Number.isFinite(result.elapsedMs) && <> · {(result.elapsedMs / 1000).toFixed(1)} seconds</>}</p></details>}
      </section>}

      </div>
        <aside className="sunny-pantry" aria-busy={visionBusy}>
          <div className="sunny-section-heading"><span className="sunny-step"><FaCamera aria-hidden="true" /></span><div><h2>Add ingredients</h2><p>Photo or list · optional</p></div></div>
          <input ref={fileRef} id="sunny-photo" className="sunny-file-input" type="file" tabIndex={-1} aria-label="Ingredient photo" accept="image/jpeg,image/png,image/webp" disabled={searchBusy}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) analyzePhoto(file); }} />
          {!photo ? <Button type="button" className="sunny-upload" disabled={searchBusy} onClick={() => fileRef.current?.click()}>
            <FaCamera aria-hidden="true" /><strong>Add an ingredient photo</strong><span>JPG, PNG or WebP · up to 5 MB</span>
          </Button> : <div className="sunny-photo-preview"><img src={preview} alt="Your uploaded ingredient photo" /><Button type="button" aria-label="Remove photo" disabled={searchBusy} onClick={clearPhoto}><FaTimes aria-hidden="true" /></Button></div>}
          {visionBusy && <div className="sunny-processing" role="status"><strong><FaSpinner className="sunny-spinner" aria-hidden="true" /> Reading your photo…</strong><p>You’ll review the ingredient names before searching.</p><Button type="button" className="sunny-text-button" onClick={clearPhoto}>Cancel photo analysis</Button></div>}
          {visionError && <div role="alert" className="sunny-error">{visionError}{photo && !visionBusy && <Button type="button" className="sunny-text-button" onClick={() => analyzePhoto(photo)}>Retry photo</Button>}</div>}
          {visionWarnings.map((warning, index) => <p className="sunny-notice" key={index}>{warning}</p>)}
          {draftIngredients.length > 0 && <div className="sunny-ingredient-list" aria-label="Review ingredients">
            {draftIngredients.map((ingredient, index) => {
              const observation = observations.find((item) => item.name?.toLocaleLowerCase() === ingredient.toLocaleLowerCase());
              return <div className="sunny-ingredient" key={index}><div><input aria-label={`Ingredient ${index + 1}`} value={ingredient} maxLength={60} disabled={searchBusy || visionBusy} onChange={(event) => editIngredient(index, event.target.value)} />
                {observation?.confidence && <small>Photo estimate: {observation.confidence}</small>}</div>
                <Button type="button" aria-label={`Remove ${ingredient || `ingredient ${index + 1}`}`} disabled={searchBusy || visionBusy} onClick={() => { clearResults(); setDraftIngredients((items) => items.filter((_, position) => position !== index)); setConfirmed(false); setConfirmedIngredients([]); }}><FaTimes aria-hidden="true" /></Button></div>;
            })}
          </div>}
          <Button type="button" className="sunny-text-button sunny-add" disabled={searchBusy || visionBusy || draftIngredients.length >= 20}
            onClick={() => { clearResults(); setDraftIngredients((items) => [...items, ""]); setConfirmed(false); setConfirmedIngredients([]); }}>+ Add ingredient</Button>
          {(photo || draftIngredients.length > 0) && !visionBusy && <>
            <p className="sunny-confirm-hint">Check the names. Every confirmed ingredient is required in your results.</p>
            <Button type="button" className={`sunny-confirm ${confirmed ? "is-confirmed" : ""}`} disabled={searchBusy || !normalizeIngredients(draftIngredients).length}
              onClick={() => { clearResults(); const ingredients = normalizeIngredients(draftIngredients); setDraftIngredients(ingredients); setConfirmedIngredients(ingredients); setConfirmed(true); setSearchError(""); }}>
              <FaCheck aria-hidden="true" />{confirmed ? "Ingredients confirmed" : "Use these ingredients"}
            </Button>
          </>}
        </aside>
      </div>

      <details className="sunny-system"><summary>Local AI status <span>{ready ? "Ready" : status || statusError ? "Unavailable" : "Checking"}</span></summary>
        {statusError && <Alert as="p">{statusError}</Alert>}
        {status && <div className="sunny-system-grid"><p><strong>Processing</strong>{status.local ? "On this local system" : "Local status not confirmed"}</p>
          {status.models?.text && <p><strong>Text model</strong>{status.models.text}</p>}{status.models?.vision && <p><strong>Photo model</strong>{status.models.vision}</p>}
          {status.device && <p><strong>Device</strong>{status.device}</p>}
          {(status.gpu || []).map((gpu, index) => <p key={index}><strong>{gpu.name}</strong>{(Number(gpu.vramBytes || 0) / 1024 ** 3).toFixed(1)} GB GPU allocation · {(Number(gpu.totalBytes || 0) / 1024 ** 3).toFixed(1)} GB loaded model</p>)}</div>}
        <Button type="button" className="sunny-text-button" onClick={() => setStatusVersion((version) => version + 1)}>Refresh status</Button>
      </details>
    </div>
  </main>;
}
