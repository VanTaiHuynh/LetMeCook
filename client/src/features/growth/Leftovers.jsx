import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Field from '../../components/ui/Field';
import { useKitchen, useKitchenResource } from '../../utils/useKitchen';
const today = () => new Date().toLocaleDateString('en-CA');

function LeftoverRow({ item, onSaved }) {
  const { mutate, canEdit, busy, setNotice } = useKitchen();
  const [draft, setDraft] = useState({ servings: '', consumedOn: today(), confirmed: false });
  const receipt = useRef(null);
  const expired = item.useBy && item.useBy < today();
  const save = async event => {
    event.preventDefault();
    const body = { version: item.version, servings: Number(draft.servings), consumedOn: draft.consumedOn, confirmed: draft.confirmed };
    const fingerprint = JSON.stringify(body);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    const result = await mutate('Confirm leftovers eaten', `/leftovers/${item.id}/consume`, { ...body, idempotencyKey: receipt.current.idempotencyKey });
    if (result) { setDraft({ servings: '', consumedOn: today(), confirmed: false }); onSaved(); setNotice('Prepared portions updated. Raw stock was not used again.'); }
  };
  return <li><div><h3>{item.title}</h3><p>{item.servingsAvailable} servings left</p><small>Cooked {item.cookedOn}{item.useBy ? ` · your use-by ${item.useBy}` : ' · no use-by provided'}</small></div>
    {expired ? <p className="kitchen-expired">Past your use-by date; excluded from suggestions.</p> : canEdit && <details className="kitchen-details"><summary>Record eaten portions</summary><form onSubmit={save}><fieldset disabled={!!busy}><div className="kitchen-form-grid"><Field>Servings eaten<input type="number" required min="0.001" step="0.001" max={item.servingsAvailable} value={draft.servings} onChange={event => setDraft({ ...draft, servings: event.target.value, confirmed: false })} /></Field><Field>Eaten on<input required type="date" min={item.cookedOn} max={today()} value={draft.consumedOn} onChange={event => setDraft({ ...draft, consumedOn: event.target.value, confirmed: false })} /></Field></div><Field className="kitchen-checkbox"><input type="checkbox" checked={draft.confirmed} onChange={event => setDraft({ ...draft, confirmed: event.target.checked })} /><span>I checked the portions eaten.</span></Field><Button className="kitchen-primary" type="submit" disabled={!draft.confirmed}>Confirm portions eaten</Button></fieldset></form></details>}
  </li>;
}
export default function Leftovers() {
  const resource = useKitchenResource('/leftovers'); const { householdId } = useKitchen();
  const items = resource.data?.leftovers?.filter(item => item.servingsAvailable > 0) || [];
  return <section className="kitchen-panel"><details className="kitchen-disclosure"><summary>Prepared leftovers</summary>
    <p className="kitchen-help">Separate from your raw ingredients. A plan previews reuse; you record eaten portions.</p>
    {resource.loading ? <p role="status">Loading leftovers…</p> : resource.error ? <div className="kitchen-error"><p>{resource.error}</p><Button className="kitchen-secondary" onClick={resource.reload}>Retry leftovers</Button></div> : items.length ? <ul className="kitchen-lot-list">{items.map(item => <LeftoverRow key={`${item.id}:${item.version}`} item={item} onSaved={resource.reload} />)}</ul> : <p className="kitchen-empty-small">Confirm a cooked meal to save its leftovers.</p>}
    <Link className="kitchen-text-link" to={`/meal-planner${householdId ? `?householdId=${householdId}` : ''}`}>Plan with leftovers</Link>
  </details></section>;
}
