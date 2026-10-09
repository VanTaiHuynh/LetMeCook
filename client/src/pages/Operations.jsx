import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { platformRequest } from '../utils/platform';
import SubstitutionReview from '../components/SubstitutionReview';
import './Operations.css';

const CONTROLS = [
  ['publicDemo', 'Public demo catalog', 'Show only recipes with an approved permission declaration and original local photo.'],
  ['kitchenEnabled', 'Kitchen features', 'Allow pantry, household and cooking-session tools.'],
  ['voiceEnabled', 'Local voice', 'Allow local transcription and spoken recipe instructions.'],
  ['collaborationEnabled', 'Household collaboration', 'Allow invitations and editor changes in shared kitchens.'],
];

function OperationsWorkspace() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    platformRequest('admin', { authenticated: true, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  async function mutate(path, body, method = 'POST') {
    if (pending.current || !active.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await platformRequest(path, { authenticated: true, body, method, signal: controller.signal });
      if (controller.signal.aborted || !active.current || pending.current !== controller) return;
      setMessage(Number.isFinite(result.captured) && Number.isFinite(result.attempted)
        ? `${result.captured} of ${result.attempted} newsletter messages captured in the local test inbox.`
        : result.message || 'Changes saved.');
      setRevision(value => value + 1);
    } catch (failure) {
      if (!controller.signal.aborted && active.current && pending.current === controller) setError(failure.message);
    } finally {
      if (pending.current === controller) { pending.current = null; if (active.current) setBusy(false); }
    }
  }
  const form = (event, submit) => { event.preventDefault(); submit(Object.fromEntries(new FormData(event.currentTarget))); };
  const locked = busy || loading;
  return <main className="product-page operations-page"><div className="operations-shell">
    <header className="operations-header"><div><h1>Operations</h1><p>Manage recipes, settings and messages.</p></div><Link className="operations-button operations-secondary" to="/dashboard">My kitchen</Link></header>
    <nav className="operations-nav" aria-label="Operations sections"><a href="#operations-inbox">Inbox</a><a href="#operations-substitutions">Substitutions</a><a href="#operations-permissions">Catalog</a><a href="#operations-controls">Settings</a><a href="#operations-newsletter">Newsletter</a><a href="#operations-audit">Activity</a></nav>
    <div className="operations-feedback" aria-live="polite">
      {busy && <p role="status">Saving your changes…</p>}
      {loading && data && <p role="status">Refreshing operations…</p>}
      {error && <div className="operations-error" role="alert"><p>{error}</p><Button className="operations-button operations-secondary" type="button" disabled={locked} onClick={() => setRevision(value => value + 1)}>Reload operations</Button></div>}
      {message && <p className="operations-notice" role="status">{message}</p>}
    </div>
    {loading && !data && <div className="operations-loading" role="status"><p>Loading the team workspace…</p><div aria-hidden="true"><i /><i /><i /></div></div>}
    {data && <>
      <section className="operations-card" id="operations-inbox"><div className="operations-card-header"><div><h2>Team inbox</h2><p>Review messages saved locally.</p></div><span className="operations-status">{data.contacts.length} messages</span></div>
        {data.contacts.length ? <div className="operations-inbox">{data.contacts.map(contact => <article className="operations-message" key={contact.id}>
          <header><div><h3>{contact.name}</h3><p>{contact.email} · {new Date(contact.created_at).toLocaleDateString('en')}</p></div><Field>Message status<select value={contact.status} disabled={locked} onChange={event => mutate(`admin/contacts/${contact.id}`, { status: event.target.value }, 'PATCH')}><option value="new">New</option><option value="read">Read</option><option value="resolved">Resolved</option></select></Field></header>
          <p className="operations-message-text">{contact.message}</p>
        </article>)}</div> : <div className="operations-empty"><h3>No messages to review</h3><p>Contact form submissions will appear here.</p></div>}
      </section>
      <SubstitutionReview onReviewed={() => { setMessage('Swap decision saved.'); setRevision(value => value + 1); }} />
      <div className="operations-grid" id="operations-permissions">
        <section className="operations-card"><h2>Recipe permissions</h2><p>{data.catalog.demoApproved} of {data.catalog.total} recipes have a recorded demo permission declaration. Permissions are not independently verified.</p>
          <details className="operations-disclosure"><summary>Review a recipe declaration</summary><form onSubmit={event => form(event, values => mutate(`admin/catalog/${values.recipeId}`, { permissionConfirmed: values.permissionConfirmed === 'on', permissionNote: values.permissionNote }))}>
            <Field>Recipe UUID<input name="recipeId" required maxLength={36} disabled={locked} placeholder="UUID from the recipe URL" /></Field>
            <Field>Permission evidence<textarea name="permissionNote" required maxLength={2000} disabled={locked} rows={3} /></Field>
            <Field className="platform-consent"><input name="permissionConfirmed" type="checkbox" disabled={locked} /><span>The permission evidence has been reviewed.</span></Field>
            <div className="operations-action-bar"><Button className="operations-button" type="submit" disabled={locked}>Save declaration</Button></div>
          </form></details>
        </section>
        <section className="operations-card"><h2>Ingredient aliases</h2><p>Match ingredient names. Different units stay separate.</p>
          <details className="operations-disclosure"><summary>Add a reviewed alias</summary><form onSubmit={event => form(event, values => mutate('admin/aliases', values))}>
            <Field>Alias<input name="alias" maxLength={100} required disabled={locked} /></Field>
            <Field>Canonical ingredient UUID<input name="ingredientId" required maxLength={36} disabled={locked} /></Field>
            <Field>Review note<textarea name="reviewNote" maxLength={2000} required disabled={locked} rows={3} /></Field>
            <div className="operations-action-bar"><Button className="operations-button" type="submit" disabled={locked}>Save alias</Button></div>
          </form></details>
          {data.aliases.length ? <ul className="operations-aliases">{data.aliases.map(alias => <li key={alias.alias}><strong>{alias.alias}</strong><span>{alias.name}</span></li>)}</ul> : <p className="operations-empty-inline">No aliases reviewed yet.</p>}
        </section>
      </div>
      <section className="operations-card" id="operations-controls"><h2>Release controls</h2><p>These settings affect everyone using this site.</p>
        <form key={revision} onSubmit={event => form(event, values => mutate('admin/settings', Object.fromEntries(CONTROLS.map(([key]) => [key, values[key] === 'on'])), 'PUT'))}>
          <div className="operations-control-list">{CONTROLS.map(([key, title, description]) => <Field className="platform-consent" key={key}><input name={key} type="checkbox" defaultChecked={Boolean(data.settings[key])} disabled={locked} /><span><strong>{title}</strong><small>{description}</small></span></Field>)}</div>
          <div className="operations-action-bar"><Button className="operations-button" type="submit" disabled={locked}>Save release controls</Button></div>
        </form>
      </section>
      <section className="operations-card" id="operations-newsletter"><div className="operations-card-header"><div><h2>Newsletter</h2><p>{data.newsletter.confirmed} confirmed subscriptions · {data.newsletter.pending} pending.</p></div><a className="operations-text-link" href="http://localhost:56426" target="_blank" rel="noreferrer">Open local test inbox</a></div>
        <p>Messages go to the local test inbox, not subscribers’ email accounts.</p>
        <details className="operations-disclosure"><summary>Compose a newsletter update</summary><form onSubmit={event => form(event, values => mutate('admin/newsletter', values))}>
          <Field>Subject<input name="subject" maxLength={150} required disabled={locked} /></Field>
          <Field>Update<textarea name="content" maxLength={10000} required disabled={locked} rows={5} /></Field>
          <div className="operations-action-bar"><Button className="operations-button" type="submit" disabled={locked || data.newsletter.confirmed === 0}>Capture in test inbox</Button></div>
          {data.newsletter.confirmed === 0 && <p className="operations-help">Confirm a subscription first.</p>}
        </form></details>
      </section>
      <section className="operations-card" id="operations-audit"><h2>Administrator activity</h2><p>Verified administrator requests are recorded without request bodies, photos or tokens.</p>
        {data.audit.length ? <div className="operations-table" role="region" aria-label="Administrator request history" tabIndex={0}><table><thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Status</th></tr></thead><tbody>{data.audit.map(item => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString('en')}</td><td>{item.action}</td><td>{item.target}</td><td>{item.response_status}</td></tr>)}</tbody></table></div> : <p className="operations-empty-inline">No administrator activity recorded.</p>}
      </section>
    </>}
  </div></main>;
}

export default function Operations() {
  const { user, loading } = useAuth();
  if (loading) return <main className="product-page operations-page"><div className="operations-shell"><p role="status">Checking your account…</p></div></main>;
  if (!user) return <main className="product-page operations-page"><div className="operations-shell operations-signin"><h1>Operations</h1><p>Sign in as an administrator.</p><div className="operations-action-bar"><Link className="operations-button" to="/login" state={{ from: { pathname: '/admin' } }}>Sign in</Link><Link className="operations-text-link" to="/dashboard">My kitchen</Link></div></div></main>;
  return <OperationsWorkspace key={user.id} />;
}
