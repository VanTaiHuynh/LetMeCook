import { useEffect, useRef, useState } from 'react';
import Button from '../../components/ui/Button';
import Field from '../../components/ui/Field';
import { useKitchen, useKitchenResource } from '../../utils/useKitchen';
import { splitExcludedIngredients } from '../../utils/mealPlanner';
const today = () => new Date().toLocaleDateString('en-CA');

export default function AfterCooking({ session }) {
  const { mutate, busy, canEdit, setError, setNotice } = useKitchen();
  const feedback = useKitchenResource('/taste-feedback');
  const leftovers = useKitchenResource('/leftovers');
  const [taste, setTaste] = useState({ version: 0, rating: '', liked: '', avoided: '', cuisines: '', note: '' });
  const [lot, setLot] = useState({ servings: '', cookedOn: today(), useBy: '', confirmed: false });
  const receipt = useRef(null); const tasteDirty = useRef(false);
  const changeTaste = value => { tasteDirty.current = true; setTaste(value); };
  const existing = leftovers.data?.leftovers?.find(item => item.sessionId === session.id);
  useEffect(() => {
    const saved = feedback.data?.feedback?.find(item => item.sessionId === session.id);
    if (saved && !tasteDirty.current) setTaste({ version: saved.version, rating: String(saved.rating), liked: saved.likedIngredients.join(', '), avoided: saved.avoidedIngredients.join(', '), cuisines: saved.preferredCuisines.join(', '), note: saved.note || '' });
  }, [feedback.data, session.id]);
  const saveTaste = async event => {
    event.preventDefault();
    const body = { version: taste.version, rating: Number(taste.rating), likedIngredients: splitExcludedIngredients(taste.liked), avoidedIngredients: splitExcludedIngredients(taste.avoided), preferredCuisines: splitExcludedIngredients(taste.cuisines), note: taste.note.trim() };
    if (body.likedIngredients.length > 20 || body.avoidedIngredients.length > 20 || body.preferredCuisines.length > 10) { setError('Use up to 20 ingredient names and 10 cuisines.'); return; }
    const result = await mutate('Save my taste feedback', `/sessions/${session.id}/taste-feedback`, body, 'PUT', false);
    if (result) { tasteDirty.current = false; setTaste(value => ({ ...value, version: result.version })); setNotice('Your taste feedback is saved privately for future suggestions.'); }
  };
  const saveLot = async event => {
    event.preventDefault();
    const body = { sessionId: session.id, servingsAvailable: Number(lot.servings), cookedOn: lot.cookedOn, useBy: lot.useBy || null, confirmed: lot.confirmed };
    const fingerprint = JSON.stringify(body);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    const result = await mutate('Save confirmed leftovers', '/leftovers', { ...body, idempotencyKey: receipt.current.idempotencyKey });
    if (result) { leftovers.reload(); setLot(value => ({ ...value, confirmed: false })); setNotice('Leftovers saved separately. Your raw pantry stock was not deducted again.'); }
  };
  return <div className="kitchen-after-cooking">
    <details className="kitchen-disclosure kitchen-disclosure-secondary"><summary>How did it taste?</summary>
      <p className="kitchen-help">Private preferences for suggestions. Allergies stay in your profile.</p>
      {feedback.loading ? <p role="status">Loading your feedback…</p> : feedback.error ? <div className="kitchen-error"><p>{feedback.error}</p><Button className="kitchen-secondary" onClick={feedback.reload}>Retry feedback</Button></div> : <form onSubmit={saveTaste}><fieldset disabled={!!busy}>
        <Field>Would you cook it again?<select required value={taste.rating} onChange={event => changeTaste({ ...taste, rating: event.target.value })}><option value="">Choose a rating</option>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></Field>
        <div className="kitchen-form-grid"><Field>Ingredients you enjoyed<input maxLength={2500} value={taste.liked} onChange={event => changeTaste({ ...taste, liked: event.target.value })} placeholder="Mushrooms, ginger" /></Field><Field>Ingredients you prefer less<input maxLength={2500} value={taste.avoided} onChange={event => changeTaste({ ...taste, avoided: event.target.value })} placeholder="Personal taste, not allergies" /></Field></div>
        <Field>Cuisines you enjoy<input maxLength={1000} value={taste.cuisines} onChange={event => changeTaste({ ...taste, cuisines: event.target.value })} /></Field>
        <Field>Private note<input maxLength={300} value={taste.note} onChange={event => changeTaste({ ...taste, note: event.target.value })} /></Field>
        <Button className="kitchen-primary" type="submit" disabled={!taste.rating}>Save my feedback</Button>
      </fieldset></form>}
    </details>
    {canEdit && <details className="kitchen-disclosure kitchen-disclosure-secondary"><summary>Save leftovers</summary>
      <p className="kitchen-help">You confirm the portions and dates. No storage date is estimated.</p>
      {leftovers.loading ? <p role="status">Checking leftovers…</p> : leftovers.error ? <div className="kitchen-error"><p>{leftovers.error}</p><Button className="kitchen-secondary" onClick={leftovers.reload}>Retry leftovers</Button></div> : existing ? <p>{existing.servingsAvailable} servings saved. Manage them in Pantry.</p> : <form onSubmit={saveLot}><fieldset disabled={!!busy}><div className="kitchen-form-grid">
        <Field>Servings left<input required type="number" min="0.001" max="1000" step="0.001" value={lot.servings} onChange={event => setLot({ ...lot, servings: event.target.value, confirmed: false })} /></Field>
        <Field>Cooked on<input required type="date" max={today()} value={lot.cookedOn} onChange={event => setLot({ ...lot, cookedOn: event.target.value, confirmed: false })} /></Field>
        <Field>Your use-by date (optional)<input type="date" min={lot.cookedOn} value={lot.useBy} onChange={event => setLot({ ...lot, useBy: event.target.value, confirmed: false })} /></Field>
      </div><Field className="kitchen-checkbox"><input type="checkbox" checked={lot.confirmed} onChange={event => setLot({ ...lot, confirmed: event.target.checked })} /><span>I checked these portions and dates.</span></Field><Button className="kitchen-primary" type="submit" disabled={!lot.confirmed}>Save confirmed leftovers</Button></fieldset></form>}
    </details>}
  </div>;
}
