import Alert from "../components/ui/Alert";
import { catalogRequest } from "../utils/catalogApi";
import Button from "../components/ui/Button";
import { paginationPages } from "../utils/pagination";
import { PageSEO } from "../components/SEO";
import { apiUrl } from "../utils/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import RecipeList from "./../components/RecipeList";
import FilterBar from "./../components/FilterBar";
import { useSearchParams } from "react-router-dom";



const RESULTS_PER_PAGE = 24;
const SORT_OPTIONS = {
  createdAt: "Most Recent",
  viewCount: "Most Popular",
  cookTime: "Cooking Time",
  ratingAverage: "Highest Rated",
};

export default function Recipes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const query = searchParams.toString();
  const page = Math.max(0, Math.min(10000, Number.parseInt(searchParams.get("page") || "0", 10) || 0)) + 1;
  const rawSort = (searchParams.get("sort") || "createdAt").split(",")[0];
  const sort = Object.hasOwn(SORT_OPTIONS, rawSort) ? rawSort : "createdAt";
  const ratingValue = Number(searchParams.get("minRating"));
  const minRating = Number.isFinite(ratingValue) && ratingValue >= 1 && ratingValue <= 5 ? String(ratingValue) : "";
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);
  const [resultError, setResultError] = useState("");
  const [retry, setRetry] = useState(0);
  const filters = useMemo(() => {
    const current = new URLSearchParams(query);
    return { categories: current.getAll("categories"), cuisines: current.getAll("cuisines"), dietaryPreferences: current.getAll("dietaryPreferences") };
  }, [query]);
  const setPage = (value) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous); next.set("page", String(value - 1)); return next;
  });
  const updateFilters = useCallback((update) => {
    const nextFilters = typeof update === "function" ? update(filters) : update;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries(nextFilters).forEach(([key, values]) => { next.delete(key); values.forEach((value) => next.append(key, value)); });
      next.set("page", "0"); return next;
    });
  }, [filters, setSearchParams]);
  const updateSort = (nextSort) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous); next.set("sort", nextSort); next.set("page", "0"); return next;
  });
  const updateMinRating = (value) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value) next.set("minRating", value); else next.delete("minRating");
    next.set("page", "0"); return next;
  });
  const clearAll = () => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    for (const field of ["categories", "cuisines", "dietaryPreferences", "minRating"]) next.delete(field);
    next.set("page", "0"); return next;
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const queryParams = new URLSearchParams();

    // Add filters
    Object.entries(filters).forEach(([key, values]) => {
      values.forEach((val) => queryParams.append(key, val));
    });
    if (minRating) queryParams.set("minRating", minRating);

    // Add sort
    if (sort) {
      queryParams.append("sort", `${sort},${sort === "cookTime" ? "asc" : "desc"}`);
    }

    // Add pagination
    queryParams.append("page", page - 1); // 0-based index
    queryParams.append("size", RESULTS_PER_PAGE); // ✅ gọi thêm size=24

    const url = apiUrl(`/recipes/search?${queryParams.toString()}`);

    setLoading(true);
    setResultError("");

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
        setResultError("Could not load recipes. Please try again.");
        setResults([]);
        setTotalElements(0);
        setTotalPages(1);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, sort, minRating, page, retry]);



  return (
    <main className="product-page product-recipes-page all-recipes-section">
      <PageSEO loading={loading} error={resultError} />
      <div className="all-recipes-bg" />
      <div className="layout-wrapper">
        <header className="catalog-page-header lmc-page-header"><div>

          <h1 className="product-page-title">Recipes</h1>
          <p className="product-page-intro">Find a recipe for your next meal.</p>
        </div></header>

        <FilterBar
          filters={filters}
          setFilters={updateFilters}
          sort={sort}
          setSort={updateSort}
          minRating={minRating}
          setMinRating={updateMinRating}
          onClearAll={clearAll}
        />

        {resultError && <Alert as="p" className="product-status">{resultError} <Button className="lmc-button lmc-button--secondary" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</Button></Alert>}
        {results.length === 0 && !loading && !resultError ? (
          <>

            <div className="product-empty" role="status"><p>No recipes match. Try fewer filters.</p><Button type="button" className="lmc-button lmc-button--secondary" onClick={clearAll}>Clear filters</Button></div>
          </>
        ) : (
          <>
            <RecipeList
              loading={loading}
              recipes={results}
            />

            {!loading && totalElements > 0 && (
              <div className="pagination-wrapper">
                <div className="pagination-meta">
                  <span>
                    <b>
                      {(page - 1) * RESULTS_PER_PAGE + 1} -{" "}
                      {Math.min(page * RESULTS_PER_PAGE, totalElements)}
                    </b>{" "}
                    of <b>{totalElements}</b> recipes
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
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
