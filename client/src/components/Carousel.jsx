import Button from "../components/ui/Button";
import { useRef, useEffect, useState } from "react";
import RecipeCard from "./RecipeCard";
import { useRecipeRatings } from "../utils/useRecipeRatings";
import { FaArrowLeft, FaArrowRight } from "react-icons/fa";
import { httpClient } from "../utils/httpClient";
import { useAuth } from "../context/AuthContext";

const MAX_RECIPES = 20;

export default function Carousel({ dataSource, authenticated = false, label = "Recipe collection" }) {
  const { user, loading: authLoading } = useAuth();
  const actorId = user?.id || null;
  const carouselRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const scrollStart = useRef(0);
  const velocity = useRef(0);
  const lastX = useRef(0);
  const lastTime = useRef(0);
  const momentumFrame = useRef(null);

  const [recipes, setRecipes] = useState([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: true });

  const dataToRender = (error ? [] : recipes).slice(
    0,
    MAX_RECIPES
  );

  const ratings = useRecipeRatings(dataToRender, !loading && !error);

  useEffect(() => {
    if (authenticated && authLoading) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(false);
    const fetchRecipes = async () => {
      try {
        const data = await httpClient.json(dataSource, { signal: controller.signal, auth: authenticated ? "required" : "none", ...(authenticated ? { actorId } : {}) });

        let recipeList = [];

        if (Array.isArray(data)) {
          // Case: recipes directly in response
          recipeList = data;
        } else if (Array.isArray(data.content)) {
          // Case: recipes in `content` field
          recipeList = data.content;
        } else {
          throw new Error("Unexpected API response structure");
        }

        if (active) setRecipes(recipeList);
      } catch (err) {
        if (!active || err.name === "AbortError") return;
        console.error("Failed to fetch recipes:", err);
        setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchRecipes();
    return () => {
      active = false;
      controller.abort();
    };
  }, [dataSource, authenticated, retry, actorId, authLoading]);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const updateEdges = () => setEdges({
      start: carousel.scrollLeft <= 2,
      end: carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 2,
    });
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(carousel);
    const track = carousel.querySelector(".carousel-track");
    if (track) observer.observe(track);
    carousel.addEventListener("scroll", updateEdges, { passive: true });
    return () => { observer.disconnect(); carousel.removeEventListener("scroll", updateEdges); };
  }, [loading, recipes]);

  const move = (direction) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    carousel.scrollBy({ left: direction * Math.max(240, carousel.clientWidth - 24),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  useEffect(() => {
    if (loading) return;

    const carousel = carouselRef.current;
    if (!carousel) return;

    const track = carousel.querySelector(".carousel-track");
    if (!track) return;

    let preventClick = false;

    const cancelDrag = () => {
      isDragging.current = false;
      velocity.current = 0;
      preventClick = false;
      cancelAnimationFrame(momentumFrame.current);
      momentumFrame.current = null;
      carousel.classList.remove("dragging");
      document.body.classList.remove("grabbing-cursor");
    };

    const handleVisibilityChange = () => {
      if (document.hidden) cancelDrag();
    };

    const handleMouseDown = (point, e) => {
      if (e.button !== 0) return;
      isDragging.current = true;
      dragStartX.current = point.pageX;
      scrollStart.current = carousel.scrollLeft;
      lastX.current = point.pageX;
      lastTime.current = performance.now();
      velocity.current = 0;
      preventClick = false;
      cancelAnimationFrame(momentumFrame.current);
      carousel.classList.add("dragging");
    };

    const handleMouseMove = (point) => {
      if (!isDragging.current) return;
      const dx = point.pageX - dragStartX.current;
      if (Math.abs(dx) > 5) { preventClick = true; point.preventDefault(); }

      const now = performance.now();
      const deltaX = point.pageX - lastX.current;
      const deltaTime = now - lastTime.current;
      if (deltaTime > 0) velocity.current = deltaX / deltaTime;

      carousel.scrollLeft = scrollStart.current - dx;
      lastX.current = point.pageX;
      lastTime.current = now;

      document.body.classList.add("grabbing-cursor");
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      carousel.classList.remove("dragging");

      const applyMomentum = () => {
        if (Math.abs(velocity.current) < 0.01) return;
        carousel.scrollLeft -= velocity.current * 10;
        velocity.current *= 0.95;
        momentumFrame.current = requestAnimationFrame(applyMomentum);
      };
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) momentumFrame.current = requestAnimationFrame(applyMomentum);
      document.body.classList.remove("grabbing-cursor");
    };

    const handleClick = (e) => {
      if (preventClick) {
        e.preventDefault();
        e.stopPropagation();
        preventClick = false;
      }
    };

    const onMouseDown = (e) => handleMouseDown(e, e);
    const preventNativeDrag = (event) => event.preventDefault();

    track.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", cancelDrag);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    track.addEventListener("click", handleClick, true);
    track.addEventListener("dragstart", preventNativeDrag);

    return () => {
      track.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", cancelDrag);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      track.removeEventListener("click", handleClick, true);
      track.removeEventListener("dragstart", preventNativeDrag);

      cancelDrag();
    };
  }, [loading]);

  return (
    <div className="carousel-wrapper">
      {loading && <p className="carousel-feedback" role="status">Loading recipes…</p>}
      {!loading && error && <p className="carousel-feedback" role="status">Recipes could not be loaded. <Button type="button" className="lmc-button" onClick={() => setRetry((value) => value + 1)}>Retry</Button></p>}
      {!loading && !error && !recipes.length && <p className="carousel-feedback">No recipes found.</p>}
      <div className="carousel" ref={carouselRef} role="region" aria-label={label} tabIndex={!loading && dataToRender.length ? 0 : undefined}
        onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); } }}>
        <div className="carousel-track">
          {loading ? Array.from({ length: 4 }, (_, index) => <div key={index} aria-hidden="true" className="recipe-card product-recipe-skeleton"><div className="product-skeleton-image" /><div className="product-skeleton-line" /><div className="product-skeleton-line short" /></div>)
            : dataToRender.map(recipe => <RecipeCard ratingSummary={ratings[recipe.id]} key={recipe.id} id={recipe.id} title={recipe.title} author={recipe.authorName} imageUrl={recipe.imageUrl} cookingTime={recipe.cookingTime} ratingAverage={recipe.ratingAverage} ratingCount={recipe.ratingCount} />)}
        </div>
      </div>
      {!loading && !error && dataToRender.length > 0 && <div className="carousel-controls">
        <Button type="button" className="lmc-icon-button" disabled={edges.start} aria-label={`Previous recipes in ${label}`} onClick={() => move(-1)}><FaArrowLeft aria-hidden="true" /></Button>
        <Button type="button" className="lmc-icon-button" disabled={edges.end} aria-label={`Next recipes in ${label}`} onClick={() => move(1)}><FaArrowRight aria-hidden="true" /></Button>
      </div>}
    </div>
  );
}
