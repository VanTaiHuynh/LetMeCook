import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { FaStar, FaRegStar, FaRegComment } from "react-icons/fa";
import "./ReviewList.css";
import { recipeReadClient } from "../utils/recipeReadClient";
import { REVIEW_PAGE_SIZE } from "../utils/recipeReads";

const validRating = value => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;

function ReviewStars({ value }) {
  const filled = Math.round(value);
  return <span className="product-review-stars" aria-label={`${value} out of 5`}>
    {Array.from({ length: 5 }, (_, index) => index < filled ? <FaStar key={index} aria-hidden="true" /> : <FaRegStar key={index} aria-hidden="true" />)}
  </span>;
}

function reviewDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export default function ReviewList({ recipeId, refreshTrigger }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;
  const [sort, setSort] = useState("recent");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const identity = `${recipeId}:${userId || 'guest'}:${sort}:${sortOrder}:${page}`;
  const [state, setState] = useState({ identity: '', loading: true, error: '', data: null });
  useEffect(() => { setPage(0); }, [recipeId, userId, refreshTrigger]);
  useEffect(() => {
    if (!recipeId || authLoading) return;
    const controller = new AbortController();
    setState({ identity, loading: true, error: '', data: null });
    recipeReadClient.reviews(recipeId, { page, sort, order: sortOrder, userId, signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        if (data.totalPages > 0 && page >= data.totalPages) { setPage(data.totalPages - 1); return; }
        setState({ identity, loading: false, error: '', data });
      }).catch(error => {
        if (!controller.signal.aborted && error.name !== 'AbortError')
          setState({ identity, loading: false, error: error.message, data: null });
      });
    return () => controller.abort();
  }, [recipeId, userId, authLoading, page, sort, sortOrder, identity, refreshTrigger, retry]);
  const current = state.identity === identity;
  const loading = authLoading || !current || state.loading;
  const data = current ? state.data : null;
  const reviews = data?.content || [];
  const sortValue = sortOrder === 'asc' ? `${sort}-asc` : sort;
  const changeSort = event => {
    const value = event.target.value;
    setSort(value.startsWith('rating') ? 'rating' : 'recent');
    setSortOrder(value.endsWith('-asc') ? 'asc' : 'desc');
    setPage(0);
  };
  return <div className="product-review-list" aria-busy={loading}>
    {loading ? <p className="product-review-status" role="status">Loading reviews…</p>
      : state.error ? <div className="product-review-error"><Alert as="p">{state.error}</Alert><Button type="button" className="lmc-button lmc-button--secondary" onClick={() => setRetry(value => value + 1)}>Retry reviews</Button></div>
      : !reviews.length ? <div className="product-review-empty"><FaRegComment aria-hidden="true" /><div><h3>Made this recipe?</h3><p>Share how it turned out and help the next cook.</p></div></div>
      : <>
        {data.totalElements > 1 && <div className="product-review-sort"><Field>Sort reviews<select value={sortValue} onChange={changeSort}><option value="recent">Newest first</option><option value="recent-asc">Oldest first</option><option value="rating">Highest rated</option><option value="rating-asc">Lowest rated</option></select></Field></div>}
        <ul>{reviews.map(review => {
          const categories = review.review_ratings || [];
          const overall = categories.find(item => item.category === 'overall' && validRating(item.value));
          const otherRatings = categories.filter(item => item.category !== 'overall' && validRating(item.value));
          const author = [review.user?.first_name, review.user?.last_name].filter(Boolean).join(' ') || 'Community member';
          const date = reviewDate(review.created_at);
          return <li key={review.id}>
            <div className="product-review-byline"><strong>{author}</strong>{date && <time dateTime={review.created_at}>{date}</time>}</div>
            {overall && <div className="product-review-overall"><ReviewStars value={overall.value} /><span>{overall.value} / 5</span></div>}
            <p className="product-review-comment">{review.comment || "No comment provided."}</p>
            {otherRatings.length > 0 && <details className="product-review-breakdown"><summary>More ratings</summary><dl>{otherRatings.map(({category, value}) => <div key={category}><dt>{category.charAt(0).toUpperCase() + category.slice(1)}</dt><dd>{value} / 5</dd></div>)}</dl></details>}
          </li>;
        })}</ul>
        {data.totalPages > 1 && <nav className="pagination-wrapper" aria-label="Review pages">
          <p className="pagination-meta">{page * REVIEW_PAGE_SIZE + 1}–{Math.min((page + 1) * REVIEW_PAGE_SIZE, data.totalElements)} of {data.totalElements.toLocaleString()} reviews</p>
          <div className="pagination-numbers">
            <Button type="button" className="page-prev" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</Button>
            <Button type="button" className="page-next" disabled={page + 1 >= data.totalPages} onClick={() => setPage(value => value + 1)}>Next</Button>
          </div>
        </nav>}
      </>}
  </div>;
}
