import "./RecipeDetailCard.css";
import { ingredientQuantity, recipeSteps } from "../utils/recipeContent";

export default function RecipeDetailCard({ recipe, showOverviewHeading = true }) {
  const capitalizeWords = (text) =>
    text.replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <div className="recipe-detail-card-container" id="recipe-method">
      <div className="recipe-detail-card">
        <div className="recipe-detail-info-column">
          <h1 className="recipe-print-title">{recipe.title}</h1>
          {showOverviewHeading && <h2 className="recipe-detail-title">At a glance</h2>}

          <dl className="recipe-detail-meta">
            <div><dt>Servings</dt><dd>{recipe.servings > 0 ? recipe.servings : "Not specified"}</dd></div>
            <div><dt>Cooking time</dt><dd>{recipe.cookingTime > 0 ? `${recipe.cookingTime} minutes` : "Not specified"}</dd></div>
            <div><dt>Diet labels</dt><dd>{recipe.dietaryPreferences?.map(capitalizeWords).join(", ") || "Not specified"}</dd></div>
          </dl>

          <details className="recipe-detail-extra">
            <summary>Category and cuisine</summary>
            <dl className="recipe-detail-meta">
              <div><dt>Category</dt><dd>{recipe.categories?.map(capitalizeWords).join(", ") || "Not specified"}</dd></div>
              <div><dt>Cuisine</dt><dd>{recipe.cuisines?.map(capitalizeWords).join(", ") || "Not specified"}</dd></div>
            </dl>
          </details>
        </div>

      </div>

      <div className="recipe-detail-body">
        <section className="recipe-ingredients-section">
        <h2>Ingredients</h2>
        <ul className="ingredient-list">
          {recipe.ingredients.map((item, index) => (
            <li key={index}>
              {ingredientQuantity(item.quantity) ? `${ingredientQuantity(item.quantity)} ` : ""}{item.unit ? `${item.unit} ` : ""}{item.ingredientName}
            </li>
          ))}
        </ul>
        </section>
        <section className="recipe-instructions-section">
        <h2>Instructions</h2>
        <ol className="instruction-list">
          {recipeSteps(recipe.directions).map((step, index) => <li key={index}>{step}</li>)}
        </ol>
        </section>
      </div>
    </div>
  );
}
