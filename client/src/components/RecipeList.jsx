import Button from "../components/ui/Button";
import { useState, useEffect, useRef, useId } from "react";
import { FaTimes, FaEllipsisH } from "react-icons/fa";
import RecipeCard from "./RecipeCard";
import { useRecipeRatings } from "../utils/useRecipeRatings";
const EMPTY_REFS = [];

export default function RecipeList({
  recipes = [],
  loading = false,
  editMode = false,
  onRemove,
  onDislike,
  onExitEditMode,
  ignoreClickRefs = EMPTY_REFS,
  removeLabel = "Remove from favourites",
}) {
  const ratings = useRecipeRatings(recipes, !loading);
  const menuPrefix = useId();
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRefs = useRef({}); // refs for dislike menus
  const listRef = useRef(null); // ref for the root container

  useEffect(() => {
    function handleClickOutside(event) {
      // existing dislike menu logic
      if (openMenuId !== null) {
        const container = menuRefs.current[openMenuId];
        if (container && !container.contains(event.target)) {
          setOpenMenuId(null);
        }
      }

      // Check if click is inside any ignoreClickRefs elements
      const clickedInsideIgnored = ignoreClickRefs.some(
        (ref) => ref.current && ref.current.contains(event.target)
      );

      // Exit edit mode if editMode && click outside recipe-list and NOT inside ignored refs
      if (
        editMode &&
        listRef.current &&
        !listRef.current.contains(event.target) &&
        !clickedInsideIgnored
      ) {
        if (typeof onExitEditMode === "function") {
          onExitEditMode();
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openMenuId, editMode, onExitEditMode, ignoreClickRefs]);

  if (loading) {
    return <div className="product-loading-recipes"><p role="status">Loading recipes…</p><div className="recipe-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <div className="recipe-card product-recipe-skeleton" key={index}><div className="product-skeleton-image" /><div className="product-skeleton-line" /><div className="product-skeleton-line short" /></div>)}
    </div></div>;
  }

  if (recipes.length === 0) {
    return (
      <div className="recipe-empty">
        <p>No recipes here yet.</p>
        <p>Explore the collection or add a recipe of your own.</p>
      </div>
    );
  }

  const toggleMenu = (id) => {
    setOpenMenuId(openMenuId === id ? null : id);
  };

  const handleNotInterested = (id) => {
    onDislike(id);
    setOpenMenuId(null);
  };

  return (
    <div className="recipe-list" ref={listRef}>
      {recipes.map((recipe, i) => (
        <div
          key={`${recipe.id}-${i}`}
          className={`recipe-card-wrapper ${editMode ? "hover-always" : ""}`}
        >
          <RecipeCard
              ratingSummary={ratings[recipe.id]}
              disabled={editMode}
              id={recipe.id}
              title={recipe.title}
              author={recipe.authorName}
              imageUrl={recipe.imageUrl || recipe.image_url}
              cookingTime={recipe.cookingTime}
              ratingAverage={recipe.ratingAverage ?? recipe.rating_average}
              ratingCount={recipe.ratingCount ?? recipe.rating_count}
          />

          {editMode && (
            <Button
              type="button"
              className="remove-recipe-btn"
              onClick={() => onRemove(recipe.id)}
              title={removeLabel}
              aria-label={`${removeLabel}: ${recipe.title}`}
            >
              <FaTimes size={14} />
            </Button>
          )}

          {onDislike && !editMode && (
            <div
              className="dislike-menu-container"
              ref={(el) => (menuRefs.current[recipe.id] = el)}
              onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenMenuId(null); }}
              onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.querySelector(".dislike-recipe-btn")?.focus(); setOpenMenuId(null); } }}
            >
              <Button
                type="button"
                aria-label={`More options for ${recipe.title}`}
                aria-expanded={openMenuId === recipe.id}
                aria-controls={`${menuPrefix}-${recipe.id}`}
                className="dislike-recipe-btn"
                onClick={() => toggleMenu(recipe.id)}
              >
                <FaEllipsisH size={20} />
              </Button>

              {openMenuId === recipe.id && (
                <Button type="button" id={`${menuPrefix}-${recipe.id}`}
                  className="dislike-menu"
                  onClick={() => handleNotInterested(recipe.id)}
                >
                  <span className="dislike-text">Suggest less</span>
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
