import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaStar } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';
import { recipeReadClient } from '../utils/recipeReadClient';
import { normalizeRatingSummary } from '../utils/recipeRatings';
import Button from './ui/Button';
import ReviewForm from './ReviewForm';
import ReviewList from './ReviewList';
import './RecipeReviews.css';

function ReviewsContent({ recipe, user, authLoading }) {
  const [editing, setEditing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState({ loading: true, data: null, error: false });
  const writerButton = useRef(null);
  const userId = user?.id || null;

  useEffect(() => {
    if (authLoading) return;
    const controller = new AbortController();
    setSummary({ loading: true, data: null, error: false });
    recipeReadClient.ratings([recipe.id], { userId, signal: controller.signal }).then(data => {
      if (!data[recipe.id]) throw new Error('Rating summary unavailable');
      if (!controller.signal.aborted) setSummary({ loading: false, data: normalizeRatingSummary(data[recipe.id]), error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setSummary({ loading: false, data: null, error: true });
    });
    return () => controller.abort();
  }, [recipe.id, userId, authLoading, refresh, retry]);

  const ratings = summary.data;
  const submitted = () => { setRefresh(value => value + 1); setEditing(false); writerButton.current?.focus(); };
  return <section className="review-section recipe-reviews" id="recipe-reviews" aria-labelledby="recipe-reviews-heading">
    <header className="recipe-reviews-header">
      <div className="recipe-reviews-title"><h2 id="recipe-reviews-heading">Reviews</h2>
        {summary.loading ? <p className="recipe-reviews-summary" role="status">Loading ratings…</p>
          : summary.error ? <p className="recipe-reviews-summary">Ratings unavailable. <Button className="recipe-reviews-retry" type="button" onClick={() => setRetry(value => value + 1)}>Retry ratings</Button></p>
          : ratings.overallCount > 0 ? <p className="recipe-reviews-summary">{Number.isFinite(ratings.overall) && <><FaStar aria-hidden="true" /><strong>{ratings.overall.toFixed(1)}<span> / 5</span></strong></>}<span>{ratings.overallCount.toLocaleString()} {ratings.overallCount === 1 ? 'rating' : 'ratings'}</span></p>
          : <p className="recipe-reviews-summary">No ratings yet</p>}
      </div>
      {!authLoading && (user
        ? <Button ref={writerButton} type="button" className={`lmc-button lmc-button--${editing ? 'secondary' : 'primary'}`} aria-expanded={editing} aria-controls="recipe-review-editor" onClick={() => setEditing(value => !value)}>{editing ? 'Close review' : 'Write a review'}</Button>
        : <Link className="lmc-button lmc-button--primary" to="/login" state={{ from: { pathname: `/recipes/${recipe.id}`, hash: '#recipe-reviews' } }}>Sign in to review</Link>)}
    </header>
    {editing && user && <div id="recipe-review-editor"><ReviewForm recipeId={recipe.id} onReviewSubmitted={submitted} autoFocus /></div>}
    <ReviewList recipeId={recipe.id} refreshTrigger={refresh} />
  </section>;
}

export default function RecipeReviews({ recipe }) {
  const { user, loading } = useAuth();
  return <ReviewsContent key={`${recipe.id}:${user?.id || 'guest'}`} recipe={recipe} user={user} authLoading={loading} />;
}
