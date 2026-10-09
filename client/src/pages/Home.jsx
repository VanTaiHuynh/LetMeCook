import { catalogRequest } from "../utils/catalogApi";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaCamera } from "react-icons/fa";
import { apiUrl } from "../utils/api";
import RecipeImage from "../components/RecipeImage";
import RecipeCard from "../components/RecipeCard";
import { useRecipeRatings } from "../utils/useRecipeRatings";
import SearchBar from "../components/SearchBar-Home";
import StartupIdeas from "./StartupIdeas";
import { sunnyChef as sunnythechef, sunnyThumbsUp as sunnythumbsup } from "../utils/siteAsset";
import "./Home.css";

export default function Home() {
  const [email, setEmail] = useState("");
  const [collection, setCollection] = useState({ loading: true, recipes: [], error: false });
  const [retry, setRetry] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    const controller = new AbortController();
    setCollection({ loading: true, recipes: [], error: false });
    async function load() {
      try {
        const data = await catalogRequest(apiUrl("/recipes/search?categories=main+course&sort=viewCount,desc&size=6"), { signal: controller.signal });
        const recipes = Array.isArray(data) ? data : data.content;
        if (!Array.isArray(recipes)) throw new Error("Invalid recipe collection");
        if (!controller.signal.aborted) setCollection({ loading: false, recipes, error: false });
      } catch {
        if (!controller.signal.aborted) setCollection({ loading: false, recipes: [], error: true });
      }
    }
    load();
    return () => controller.abort();
  }, [retry]);
  const featured = collection.recipes[0];
  const picks = collection.recipes.length > 1 ? collection.recipes.slice(1, 5) : collection.recipes;
  const ratings = useRecipeRatings(picks, !collection.loading && !collection.error);
  const handleSignUpSubmit = event => {
    event.preventDefault();
    if (email.trim()) navigate(`/register?email=${encodeURIComponent(email.trim())}`);
  };
  return <main className="home-page" lang="en">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="layout-wrapper home-hero-grid">
        <div className="home-hero-copy">
          <h1 id="home-title">A good dinner<br />starts here.</h1>
          <p className="home-hero-description">Your AI cooking companion. Find meals you love, plan your week and enjoy every step with Sunny.</p>
          <SearchBar />
          <div className="home-hero-actions"><Link to="/features">Discover the experience</Link><Link to="/sunny"><FaCamera aria-hidden="true" />Start with a photo</Link></div>
        </div>
        <div className="home-hero-visual">
          {featured ? <Link to={`/recipes/${featured.id}`} className="home-featured-recipe" aria-label={`Explore ${featured.title}`}>
            <div className="home-featured-photo"><RecipeImage src={featured.imageUrl} alt={featured.title} fetchPriority="high" /></div>
            <div className="home-featured-caption"><div><h2>{featured.title}</h2><p>{featured.cookingTime > 0 ? `${featured.cookingTime} min · ` : ""}View recipe</p></div><img src={sunnythechef} alt="Sunny the Chef" /></div>
          </Link> : <div className="home-featured-placeholder" role="status"><img src={sunnythechef} alt="Sunny the Chef" /><p>{collection.loading ? "Finding your next inspiration…" : "Dinner inspiration starts with Sunny."}</p></div>}
        </div>
      </div>
    </section>

    <StartupIdeas />

    <section className="home-collection layout-wrapper" aria-labelledby="home-collection-heading">
      <div className="home-section-header"><div><h2 id="home-collection-heading">Find your next favorite</h2></div><Link className="home-text-link" to="/recipes">Browse all recipes</Link></div>
      <nav className="home-recipe-categories" aria-label="Recipe collections"><Link to="/recipes?sort=viewCount,desc">Most popular</Link><Link to="/recipes?dietaryPreferences=vegan">Vegan</Link><Link to="/recipes?dietaryPreferences=gluten+free">Gluten-free</Link></nav>
      {collection.loading ? <div><p role="status" className="home-loading-caption">Loading recipes…</p><div className="home-recipe-grid" aria-hidden="true">{[0,1,2,3].map(index => <div key={index} className="home-recipe-skeleton"><div /><section><i /><i /><i /></section></div>)}</div></div> : collection.error ? <div className="home-collection-status" role="alert"><p>Recipes could not load. Try again or ask Sunny.</p><Button className="lmc-button lmc-button--secondary" type="button" onClick={() => setRetry(value => value + 1)}>Retry recipes</Button></div> : picks.length ? <div className="home-recipe-grid">{picks.map(recipe => <RecipeCard ratingSummary={ratings[recipe.id]} key={recipe.id} id={recipe.id} title={recipe.title} imageUrl={recipe.imageUrl} author={recipe.authorName || recipe.sourceAuthor || "Recipe collection"} cookingTime={recipe.cookingTime} ratingAverage={recipe.ratingAverage} ratingCount={recipe.ratingCount} />)}</div> : <p className="home-collection-status">No recipes are available in this collection yet.</p>}
    </section>

    <section className="home-signup layout-wrapper" aria-labelledby="home-signup-title">
      <div className="home-signup-copy"><img src={sunnythumbsup} alt="Sunny with a thumbs up" /><div><h2 id="home-signup-title">Make your kitchen yours.</h2><p>Save favorites, track ingredients and keep your dinner plans.</p></div></div>
      <div className="home-signup-action"><form className="home-signup-form" onSubmit={handleSignUpSubmit}><Field htmlFor="home-signup-email">Email address</Field><div><input id="home-signup-email" name="emailInput" type="email" placeholder="Your email address" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /><Button className="lmc-button lmc-button--primary" type="submit">Sign up</Button></div></form><p>Already have an account? <Link to="/login">Log in</Link></p></div>
    </section>
  </main>;
}
