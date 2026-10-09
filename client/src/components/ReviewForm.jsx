import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { httpClient } from "../utils/httpClient";
import "./ReviewForm.css";

const ReviewEditor = ({ recipeId, onReviewSubmitted, autoFocus }) => {
  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState({ cost: '', time: '', difficulty: '', overall: '' });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const pending = useRef(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current?.abort(); };
  }, []);

  const handleRatingChange = (category, value) => {
    setRatings(previous => ({ ...previous, [category]: parseInt(value, 10) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pending.current || !active.current) return;
    const controller = new AbortController();
    pending.current = controller; setErrorMessage(''); setSubmitting(true);
    try {
      await httpClient.json('/reviews', { auth: 'required', method: 'POST', body: { recipeId, comment, ratings }, signal: controller.signal, service: 'Your review' });
      if (controller.signal.aborted || !active.current || pending.current !== controller) return;
      setComment(''); setRatings({cost:'',time:'',difficulty:'',overall:''}); onReviewSubmitted?.();
    } catch (error) {
      if (!controller.signal.aborted && active.current && pending.current === controller) setErrorMessage(error.message || 'Your review could not be saved. Please try again.');
    } finally {
      if (pending.current === controller) { pending.current = null; if (active.current) setSubmitting(false); }
    }

  };

  return (
    <div className="review-form">
      <form onSubmit={handleSubmit} aria-busy={submitting}>
        <h3>Your cooking notes</h3>
        <Field htmlFor="recipe-review-comment">Your review</Field>
        <textarea
          id="recipe-review-comment"
          placeholder="How did the recipe turn out?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          autoFocus={autoFocus}
          maxLength={3000}
          disabled={submitting}
          required
        />
        <div className="review-ratings-group">
          {["cost", "time", "difficulty", "overall"].map((cat) => (
            <div className="rating-field" key={cat}>
              <Field className="rating-label" htmlFor={`recipe-rating-${cat}`}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </Field>
              <select
                id={`recipe-rating-${cat}`}
                className="rating-select"
                disabled={submitting}
                value={ratings[cat]}
                onChange={(e) => handleRatingChange(cat, e.target.value)}
                required
              >
                <option value="">Select rating</option>
                {[1, 2, 3, 4, 5].map((val) => (
                  <option key={val} value={val}>
                    {val} / 5
                  </option>
                ))}
              </select>
            </div>
          ))}

        </div>
        {errorMessage && <Alert as="p" className="error-message">{errorMessage}</Alert>}
        <div className="review-form-actions"><Button type="submit" className="lmc-button lmc-button--primary" disabled={submitting}>{submitting ? "Saving review…" : "Save review"}</Button></div>
      </form>
    </div>
  );
};

export default function ReviewForm({ recipeId, onReviewSubmitted, autoFocus = false }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking your account…</p>;
  if (!user) return <p><Link to="/login" state={{from:{pathname:`/recipes/${recipeId}`,hash:'#recipe-reviews'}}} className="lmc-button lmc-button--primary">Sign in to review</Link></p>;
  return <ReviewEditor key={`${user.id}:${recipeId}`} recipeId={recipeId} onReviewSubmitted={onReviewSubmitted} autoFocus={autoFocus}/>;
}
