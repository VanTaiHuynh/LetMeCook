import Alert from "../components/ui/Alert";
import { catalogRequest } from "../utils/catalogApi";
import Button from "../components/ui/Button";
import { paginationPages } from "../utils/pagination";
import { apiUrl } from "../utils/api";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import RecipeList from "./../components/RecipeList";
import SortDropdown from "./../components/SortDropdown";



const RESULTS_PER_PAGE = 24;

export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const keyword = searchParams.get("keyword");
  const cuisines = searchParams.getAll("cuisines");
  const ingredients = searchParams.getAll("ingredients");
  const allergies = searchParams.getAll("allergies");
  const categories = searchParams.getAll("categories");
  const dietaryPreferences = searchParams.getAll("dietaryPreferences");
  const prompt = searchParams.get("prompt");

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const page = Math.max(0, Math.min(10000, Number.parseInt(searchParams.get("page") || "0", 10) || 0)) + 1;
  const candidateSort = (searchParams.get("sort") || "createdAt").split(",")[0];
  const normalizedSort = candidateSort === "rating" ? "ratingAverage" : candidateSort;
  const sort = ["createdAt", "viewCount", "cookTime", "ratingAverage"].includes(normalizedSort) ? normalizedSort : "createdAt";
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);
  const [resultError, setResultError] = useState("");
  const [retryResults, setRetryResults] = useState(0);
  const filterParams = new URLSearchParams();
  if (keyword) filterParams.set("keyword", keyword);
  for (const [key, values] of Object.entries({cuisines, ingredients, allergies, categories, dietaryPreferences})) values.forEach((value) => filterParams.append(key, value));
  const criteriaQuery = filterParams.toString();
  const requestParams = new URLSearchParams(criteriaQuery);
  requestParams.set("sort", `${sort},${sort === "cookTime" ? "asc" : "desc"}`);
  requestParams.set("page", page - 1);
  requestParams.set("size", RESULTS_PER_PAGE);
  const requestQuery = requestParams.toString();
  const setPage = (value) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous); next.set("page", String(value - 1)); return next;
  });
  const updateSort = (value) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous); next.set("sort", value); next.set("page", "0"); return next;
  });

  useEffect(() => {
    if (prompt || !criteriaQuery) { setResults([]); setLoading(false); setResultError(""); setTotalElements(0); setTotalPages(1); return; }
    const controller = new AbortController();
    let active = true;
    const url = apiUrl(`/recipes/search?${requestQuery}`);

    setLoading(true);
    setResults([]);
    setResultError("");
    setTotalElements(0);

    catalogRequest(url, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        const recipes = Array.isArray(data.content) ? data.content : [];
        setResults(recipes);
        setTotalPages(data.totalPages || 1);
        setTotalElements(data.totalElements || 0);
      })
      .catch((err) => {
        if (!active || err.name === "AbortError") return;
        console.error("Failed to fetch search results:", err);
        setResultError("Could not load recipes. Please try again.");
        setResults([]);
        setTotalPages(1);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [prompt, criteriaQuery, requestQuery, retryResults]);


  if (prompt) {
    const conditions = [prompt, ingredients.length && `Use ${ingredients.join(", ")}.`, allergies.length && `Exclude ${allergies.join(", ")}.`, dietaryPreferences.length && `Diet: ${dietaryPreferences.join(", ")}.`, cuisines.length && `Cuisine: ${cuisines.join(", ")}.`, categories.length && `Category: ${categories.join(", ")}.`].filter(Boolean).join(" ");
    return <Navigate replace to={`/sunny?${new URLSearchParams({prompt: conditions}).toString()}`} />;
  }
  return (
    <main className="product-page product-search-page search-results-section">
      <div className="search-results-bg" />
      <div className="layout-wrapper">
        <header className="catalog-page-header lmc-page-header">
          <div><h1 className="product-page-title">Search results</h1></div>
          <SortDropdown sort={sort} setSort={updateSort} />
        </header>


        {criteriaQuery && (
          <div className="filter-summary">

            {[
              keyword && `Keyword: ${keyword}`,
              cuisines.length > 0 && `Cuisines: ${cuisines.join(", ")}`,
              ingredients.length > 0 &&
                `Ingredients: ${ingredients.join(", ")}`,
              allergies.length > 0 && `Exclude: ${allergies.join(", ")}`,
              categories.length > 0 && `Categories: ${categories.join(", ")}`,
              dietaryPreferences.length > 0 &&
                `Diet: ${dietaryPreferences.join(", ")}`,
            ]
              .filter(Boolean)
              .map((condition,index) => <span className="search-constraint" key={index}>{condition}</span>)}
            {totalElements > 0 && !loading && (
              <span className="results-count">{totalElements} matching recipes</span>
            )}
          </div>
        )}

        {resultError && <Alert as="p" className="product-status">{resultError} <Button type="button" className="lmc-button lmc-button--secondary" onClick={() => setRetryResults((value) => value + 1)}>Retry</Button></Alert>}

        {!resultError && results.length === 0 && !loading ? (
          <>

            <div className="product-empty" role="status"><p>{criteriaQuery ? "No recipes match. Try fewer filters." : "Start with a dish, ingredient or cooking idea."}</p><Link to="/recipes" className="lmc-button lmc-button--secondary">Explore recipes</Link></div>
          </>
        ) : (
          <>
            <RecipeList
              loading={loading}
              recipes={results}
            />

            {!loading && totalElements > 0 && <div className="pagination-wrapper">
              <div className="pagination-meta">
                <span>
                  <b>
                    {(page - 1) * RESULTS_PER_PAGE + 1} -{" "}
                    {Math.min(page * RESULTS_PER_PAGE, totalElements)}
                  </b>{" "}
                  of <b>{totalElements}</b> results
                </span>
              </div>

              <div className="pagination-numbers catalog-pagination">
                <Button type="button" aria-label="Previous page" disabled={page <= 1}
                  className={`page-prev ${page === 1 ? "disabled" : ""}`}
                  onClick={() => page > 1 && setPage(page - 1)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="8"
                    height="14"
                    viewBox="0 0 8 14"
                    fill="none"
                  >
                    <path d="M0 7L8 14L8 0L0 7Z" fill="#1E1E1E" />
                  </svg>
                </Button>

                {paginationPages(page, totalPages).map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showDots = prev && p - prev > 1;

                    return (
                      <span key={p} className={`pagination-item${p === page ? " is-current" : ""}`}>
                        {showDots && <span className="ellipsis">...</span>}
                        <Button type="button" aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}
                          className={`page-number ${
                            p === page ? "current" : ""
                          }`}
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </Button>
                      </span>
                    );
                  })}

                <span className="catalog-page-total">of {totalPages}</span>
                  <Button type="button" aria-label="Next page" disabled={page >= totalPages}
                  className={`page-next ${
                    page === totalPages ? "disabled" : ""
                  }`}
                  onClick={() => page < totalPages && setPage(page + 1)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="8"
                    height="14"
                    viewBox="0 0 8 14"
                    fill="none"
                  >
                    <path d="M8 7L0 14L0 0L8 7Z" fill="#1E1E1E" />
                  </svg>
                </Button>
              </div>
            </div>}
          </>
        )}
      </div>
    </main>
  );
}
