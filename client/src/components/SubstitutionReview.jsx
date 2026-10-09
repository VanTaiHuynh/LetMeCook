import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState } from 'react';
import { platformRequest } from '../utils/platform';
import { sourceLink } from '../utils/sunny';

export default function SubstitutionReview({ onReviewed }) {
  const [resource, setResource] = useState({ rules: [], loading: true, error: '', truncated: false, limit: 100 });
  const [selectedId, setSelectedId] = useState('');
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState({ status: '', reviewNote: '', sourceUrl: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const active = useRef(true);
  const rule = resource.rules.find(item => item.id === selectedId);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResource(current => ({ ...current, loading: true, error: '' }));
    platformRequest('admin/substitutions', { authenticated: true, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const rules = Array.isArray(value.rules) ? value.rules : [];
      setResource({ rules, loading: false, error: '', truncated: value.truncated === true, limit: value.limit || 100 });
      setSelectedId(current => rules.some(item => item.id === current) ? current : rules[0]?.id || '');
    }).catch(failure => { if (!controller.signal.aborted) setResource(current => ({ ...current, loading: false, error: failure.message })); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => { setForm({ status: '', reviewNote: '', sourceUrl: '' }); }, [rule?.id, rule?.version]);

  const review = async event => {
    event.preventDefault();
    if (pending.current || !rule || resource.loading || resource.error) return;
    const reviewNote = form.reviewNote.trim();
    const sourceUrl = sourceLink(form.sourceUrl.trim());
    if (!['approved', 'rejected'].includes(form.status) || !reviewNote || reviewNote.length > 3000 || !sourceUrl || sourceUrl.length > 2000) {
      setError('Choose a decision, add a note and provide a valid source link.'); return;
    }
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await platformRequest(`admin/substitutions/${rule.id}/review`, { authenticated: true, body: { version: rule.version, status: form.status, reviewNote, sourceUrl }, signal: controller.signal });
      if (controller.signal.aborted || !active.current) return;
      if (!response.rule?.id || !Number.isInteger(response.rule.version)) throw new Error('Could not confirm the decision. Reload and try again.');
      setResource(current => ({ ...current, rules: current.rules.map(item => item.id === response.rule.id ? response.rule : item) }));
      setMessage('Decision saved. Creator preview uses this approval status.');
      onReviewed?.();
    } catch (failure) {
      if (!controller.signal.aborted && active.current) setError(failure.status === 409 ? 'This swap changed. Reload and review it again.' : failure.message);
    } finally {
      if (pending.current === controller) { pending.current = null; if (active.current) setBusy(false); }
    }
  };

  return <section className="operations-card operations-substitution-review" id="operations-substitutions">
    <h2>Review ingredient swaps</h2>
    <p>Check the source before approving a preview. Approval does not certify expertise or allergy safety.</p>
    {resource.loading ? <p role="status">Loading swaps…</p> : resource.error ? <Alert as="p" className="operations-error">{resource.error}</Alert> : !resource.rules.length ? <div className="operations-empty"><h3>No swaps to review</h3><p>Submitted swaps appear here.</p></div> : <>
      <p>{resource.rules.length} swaps shown, awaiting review first.{resource.truncated && ` Showing up to ${resource.limit}. Reload after reviewing to see more.`}</p>
      <Field>Swap to review<select disabled={busy} value={selectedId} onChange={event => { setSelectedId(event.target.value); setError(''); setMessage(''); }}>
        {resource.rules.map(item => <option key={item.id} value={item.id}>{item.fromIngredient} → {item.toIngredient} · {item.approvalStatus || 'pending'}</option>)}
      </select></Field>
      {rule && <>
        <dl className="operations-substitution-details"><div><dt>Replacement</dt><dd>{rule.fromIngredient} → {rule.toIngredient} · ratio {rule.ratio}</dd></div><div><dt>Kitchen scope</dt><dd>{rule.scopeKind || 'Kitchen'} · {rule.scopeId}</dd></div><div><dt>Creator note</dt><dd>{rule.note}</dd></div><div><dt>User declaration</dt><dd>{rule.reviewed ? 'Source reviewed by the submitting user' : 'No user review recorded'}{sourceLink(rule.sourceUrl) && <> · <a href={sourceLink(rule.sourceUrl)} target="_blank" rel="noreferrer">Declared source ↗</a></>}</dd></div><div><dt>Approval status</dt><dd>{rule.approvalStatus || 'pending'} · version {rule.version}</dd></div>{rule.approvalNote && <div><dt>Previous decision note</dt><dd>{rule.approvalNote}</dd></div>}{sourceLink(rule.approvalSourceUrl) && <div><dt>Previous supporting source</dt><dd><a href={sourceLink(rule.approvalSourceUrl)} target="_blank" rel="noreferrer">Review source ↗</a></dd></div>}{rule.approvalReviewedAt && <div><dt>Last reviewed</dt><dd>{new Date(rule.approvalReviewedAt).toLocaleString('en')}</dd></div>}</dl>
        <form className="operations-review-form" onSubmit={review}><h3>Record your decision</h3><Field>Decision<select required disabled={busy} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="">Choose a decision</option><option value="approved">Approve for preview</option><option value="rejected">Reject</option></select></Field><Field>Review note<textarea rows={3} required maxLength={3000} disabled={busy} value={form.reviewNote} onChange={event => setForm({ ...form, reviewNote: event.target.value })} /></Field><Field>Supporting source link<input type="url" required maxLength={2000} disabled={busy} value={form.sourceUrl} onChange={event => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://…" /></Field><div className="operations-action-bar"><Button className="operations-button" type="submit" disabled={busy}>{busy ? 'Saving decision…' : 'Save decision'}</Button></div></form>
      </>}
    </>}
    {error && <Alert as="p" className="operations-error">{error}</Alert>}{message && <p className="operations-notice" role="status">{message}</p>}
    <Button className="operations-button operations-secondary" type="button" disabled={busy || resource.loading} onClick={() => setRevision(value => value + 1)}>Reload swaps</Button>
  </section>;
}
