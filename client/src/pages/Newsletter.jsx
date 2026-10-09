import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import { InformationHero } from '../components/InformationPages';
import { platformRequest } from '../utils/platform';
import { useAuth } from '../context/AuthContext';
import './Newsletter.css';

function NewsletterForm({ confirm, unsubscribe }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current?.abort(); };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (pending.current || !active.current) return;
    const controller = new AbortController();
    const form = event.currentTarget;
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await platformRequest(confirm ? 'newsletter/confirm' : unsubscribe ? 'newsletter/unsubscribe' : 'newsletter', {
        signal: controller.signal,
        body: confirm || unsubscribe ? { token: confirm || unsubscribe } : { email: form.elements.email.value.trim(), consent: form.elements.consent.checked },
      });
      if (controller.signal.aborted || !active.current || pending.current !== controller) return;
      setMessage(result.message);
      if (!confirm && !unsubscribe) form.reset();
    } catch (e) {
      if (!controller.signal.aborted && active.current && pending.current === controller) setError(e.message);
    } finally {
      if (pending.current === controller) { pending.current = null; if (active.current) setBusy(false); }
    }
  }

  const title = confirm ? 'Confirm your subscription' : unsubscribe ? 'Unsubscribe from updates' : 'A little dinner inspiration.';
  const intro = confirm ? 'Confirm that you requested these emails.' : unsubscribe ? 'Your newsletter subscription will be stopped.' : 'Recipes, kitchen tips and LetMeCook updates.';
  const tokenAction = Boolean(confirm || unsubscribe);
  return <main className="product-page information-page information-newsletter">
    <div className="layout-wrapper information-shell">
      <InformationHero title={title} intro={intro} />
      <div className={tokenAction ? 'newsletter-action-layout' : 'information-pair information-form-layout'}>
        <form className="information-panel information-form newsletter-form" onSubmit={submit} aria-label="Newsletter preferences" aria-busy={busy}>
          {!confirm && !unsubscribe && <>
            <div className="information-field">
              <Field htmlFor="newsletter-email">Email address</Field>
              <input id="newsletter-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} />
            </div>
            <Field className="newsletter-consent"><input name="consent" type="checkbox" required disabled={busy} /><span>I would like to receive LetMeCook updates. I can unsubscribe at any time.</span></Field>
          </>}
          <div className="information-form-actions"><Button className="lmc-button lmc-button--primary" type="submit" disabled={busy || Boolean(message)}>{busy ? 'Please wait…' : confirm ? 'Confirm subscription' : unsubscribe ? 'Unsubscribe' : 'Subscribe'}</Button></div>
          {error && <Alert as="p" className="information-form-message error">{error}</Alert>}
          {message && <p role="status" className="information-form-message">{message}</p>}
          {message && !confirm && !unsubscribe && <Button type="button" className="lmc-button lmc-button--secondary newsletter-another" onClick={() => { setMessage(''); setError(''); }}>Subscribe another email</Button>}
        </form>
        {!tokenAction && <aside className="information-panel information-form-note">
          <h2>Your subscription</h2>
          <p>Open the confirmation link in the <a href="http://localhost:56426" target="_blank" rel="noreferrer">local test inbox</a> to subscribe. Emails stay in this installation.</p>
          <Link to="/privacy">Privacy policy</Link>
        </aside>}
      </div>
    </div>
  </main>;
}

export default function Newsletter() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const confirm = params.get('confirm');
  const unsubscribe = params.get('unsubscribe');
  if (confirm && unsubscribe) return <main className="product-page information-page information-newsletter">
    <div className="layout-wrapper information-shell">
      <InformationHero title="Newsletter link" />
      <section className="information-panel newsletter-link-error"><Alert as="p">This link contains two different actions. Open the confirmation or unsubscribe link from the local email separately.</Alert><Link to="/newsletter" className="lmc-button lmc-button--secondary">Back to newsletter</Link></section>
    </div>
  </main>;
  return <NewsletterForm key={`${user?.id || 'guest'}:${confirm || ''}:${unsubscribe || ''}`} confirm={confirm} unsubscribe={unsubscribe} />;
}
