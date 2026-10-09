import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import { apiUrl } from "../utils/api";
import { recipeReadClient } from "../utils/recipeReadClient";
import { recordRecipeActivity } from "../utils/recipeReads";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import RecipeDetailCard from "../components/RecipeDetailCard";
import RecipeActions from "../components/RecipeActions";
import KitchenShell from "../components/KitchenShell";
import { GuestCooking } from "./GuestCookAlong";
import { CookContent } from "./CookAlong";
import RecipeReviews from "../components/RecipeReviews";
import CarouselSection from "../components/CarouselSection";
import "./IndividualRecipe.css";
import { supabase } from "../utils/supabaseClient";
import { useAuth } from "../context/AuthContext";
import RecipeImage from "../components/RecipeImage";
import { recipeText } from "../utils/recipeContent";
import { RecipeSEO } from "../components/SEO";

export default function IndividualRecipe() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const cookingRef = useRef(null);
  const actionsRef = useRef(null);
  const glanceTabRef = useRef(null);
  const cookTabRef = useRef(null);
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;
  const identity = `${id}:${userId || 'guest'}`;
  const [cooking, setCooking] = useState({ identity: '', sessionId: null, open: false });
  const cookingOpen = cooking.identity === identity ? cooking.open : params.get('cook') === '1';
  const cookingVisited = cooking.identity === identity ? cooking.started || cooking.open : params.get('cook') === '1';
  const savedSessionId = cooking.identity === identity ? cooking.sessionId : user ? params.get("cookSession") : null;
  const [load, setLoad] = useState({ identity: '', status: 'loading', recipe: null, error: null });
  const [retry, setRetry] = useState(0);
  const loading = authLoading || load.identity !== identity || load.status === 'loading';
  const recipe = !loading && load.status === 'ready' ? load.recipe : null;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [id]);

  useEffect(() => {
    if (authLoading || !id) return;
    const controller = new AbortController();
    setLoad({ identity, status: 'loading', recipe: null, error: null });
    recipeReadClient.detail(id, { userId, signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setLoad({ identity, status: 'ready', recipe: data, error: null });
      // Activity is best effort and never gates or replaces successfully loaded content.
      void recordRecipeActivity(supabase, id, userId, controller.signal);
    }).catch(error => {
      if (controller.signal.aborted || error.name === 'AbortError') return;
      setLoad({ identity, status: 'error', recipe: null, error });
    });
    return () => controller.abort();
  }, [id, userId, identity, authLoading, retry]);

  const openCooking = (sessionId, focusPanel = true) => {
    setCooking({ identity, sessionId, open: true, started: true });
    const next = new URLSearchParams(params); next.set("cook", "1");
    if (sessionId) next.set("cookSession", sessionId); else next.delete("cookSession");
    setParams(next, { replace: true });
    if (focusPanel) requestAnimationFrame(() => { cookingRef.current?.focus({ preventScroll: true }); cookingRef.current?.parentElement?.scrollIntoView?.({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); });
  };
  const restartCooking = () => {
    setCooking({ identity, sessionId: null, open: false });
    const next = new URLSearchParams(params); next.delete("cook"); next.delete("cookSession"); setParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const closeCooking = () => {
    setCooking({ identity, sessionId: savedSessionId, open: false, started: cookingVisited });
    if (params.has("cook")) { const next = new URLSearchParams(params); next.delete("cook"); setParams(next, { replace: true }); }
  };
  const handleTabKey = event => {
    const isCook = event.currentTarget.id === 'recipe-cook-tab';
    const target = event.key === 'Home' ? glanceTabRef : event.key === 'End' ? cookTabRef : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? isCook ? glanceTabRef : cookTabRef : null;
    if (target) { event.preventDefault(); target.current?.focus(); }
  };

  const formattedDate = recipe
    ? new Date(recipe.createdAt).toLocaleDateString()
    : "";
  const visibleRecipe = !loading && !authLoading ? recipe : null;

  return (
    <div className="product-page product-recipe-detail-page">
      <RecipeSEO recipe={visibleRecipe} loading={loading || authLoading} />
      <main className="layout-wrapper">
        <div className="recipe-page-container">
          {loading || authLoading ? (
            <div className="loading product-status" role="status">
              <h1 className="recipe-title">Loading recipe…</h1>
              <div className="image-wrapper" />
            </div>
          ) : load.error && load.error.status !== 404 ? (
            <div className="product-empty"><h1 className="product-page-title">Recipe could not be loaded</h1><Alert as="p">{load.error.message}</Alert><Button type="button" className="lmc-button lmc-button--primary" onClick={() => setRetry(value => value + 1)}>Retry</Button> <Link to="/recipes" className="lmc-button lmc-button--secondary">Explore recipes</Link></div>
          ) : !visibleRecipe ? (
            <div className="not-found product-empty"><h1 className="product-page-title">Recipe not found</h1><p>This recipe is unavailable.</p><Link to="/recipes" className="product-primary-link">Explore recipes</Link></div>
          ) : (
            <>
              <section className="header-section">
                <Link to="/recipes" className="recipe-back-link">Back to recipes</Link>
                <div className="recipe-hero">
                <div className="recipe-hero-copy">
                <h1 className="recipe-title">{recipe.title}</h1>
                <div className="meta-info">
                  <p>
                    <strong>
                      Recipe by {recipe.authorName || "Anonymous"}
                    </strong>
                  </p>

                  <p>{formattedDate}</p>
                </div>
                <div className="description">
                  {recipeText(recipe.description)}
                </div>
                <RecipeActions ref={actionsRef} recipe={recipe} cookingOpen={cookingOpen} cookingSessionId={savedSessionId} onCook={openCooking} />
                <div className="recipe-hero-links"><a href="#recipe-method" className="recipe-jump-link" onClick={closeCooking}>Jump to recipe</a><a href="#recipe-reviews" className="recipe-jump-link">Read reviews</a></div>
                </div>
                <div className="image-wrapper">
                  <RecipeImage
                    src={recipe.imageUrl}
                    alt={recipe.title}
                    className="recipe-image"
                  />
                </div>
                </div>
              </section>

              <div className="recipe-workspace">
                <div className="recipe-view-tabs" role="tablist" aria-label="Recipe views">
                  <Button ref={glanceTabRef} id="recipe-glance-tab" role="tab" aria-selected={!cookingOpen} aria-controls="recipe-glance" tabIndex={cookingOpen ? -1 : 0} className="recipe-view-tab" onClick={closeCooking} onKeyDown={handleTabKey}>At a glance</Button>
                  <Button ref={cookTabRef} id="recipe-cook-tab" role="tab" aria-selected={cookingOpen} aria-controls="recipe-cook-along" tabIndex={cookingOpen ? 0 : -1} className="recipe-view-tab" onClick={() => { if (!cookingOpen) actionsRef.current?.openCooking(false); }} onKeyDown={handleTabKey}>Cook Along</Button>
                </div>
                <div id="recipe-glance" className="recipe-view-panel recipe-glance-panel" role="tabpanel" aria-labelledby="recipe-glance-tab" tabIndex={0} hidden={cookingOpen}>
                  <RecipeDetailCard key={`method:${recipe.id}:${userId || 'guest'}`} recipe={recipe} showOverviewHeading={false} />
                </div>
                <section ref={cookingRef} tabIndex={0} id="recipe-cook-along" className="recipe-view-panel recipe-cook-along" role="tabpanel" aria-labelledby="recipe-cook-tab" hidden={!cookingOpen}>
                  {cookingVisited && (savedSessionId && user ? <KitchenShell embedded title="Cook along"><CookContent key={`${savedSessionId}:${userId}`} id={savedSessionId} recipeId={recipe.id} onCookAgain={restartCooking} isActive={cookingOpen} embedded /></KitchenShell> : <div className="kitchen-page kitchen-embedded"><GuestCooking key={`${recipe.id}:${userId || 'guest'}`} recipeId={recipe.id} isActive={cookingOpen} embedded /></div>)}
                </section>
              </div>

              <RecipeReviews key={`reviews:${recipe.id}:${userId || 'guest'}`} recipe={recipe} />
            </>
          )}
        </div>
      </main>




      {visibleRecipe && <section>
        <CarouselSection
          key={`${id}:${user?.id || 'guest'}`}
          title="Similar Recipes"
          sectionClass="section-1"
          dataSource={apiUrl(`/recipes/recommend?recipeid=${id}`)}
          authenticated={!!user}
        />
      </section>}
    </div>
  );
}
