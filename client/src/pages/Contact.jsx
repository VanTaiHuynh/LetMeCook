import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { Link } from "react-router-dom";
import { InformationHero } from "../components/InformationPages";

import { useEffect, useRef, useState } from 'react';
import { platformRequest } from '../utils/platform';

export default function Contact() {
  const [formMessage, setFormMessage] = useState('');
  const [formClass, setFormClass] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; submittingRef.current?.abort(); }; }, []);

  function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const form = e.currentTarget;
    const name = form.elements.namedItem('name').value.trim();
    const email = form.elements.namedItem('email').value.trim();
    const message = form.elements.namedItem('message').value.trim();

    if (!name || !email.includes('@') || !message) {
      setFormMessage('Please fill in all fields with valid information.');
      setFormClass('error');
      return;
    }

    if (!isValidEmail(email)) {
      setFormMessage('Please enter a valid email address format.');
      setFormClass('error');
      return;
    }

    const controller = new AbortController();
    submittingRef.current = controller;
    setSubmitting(true);
    setFormMessage('');
    try {
      await platformRequest('contact', { signal: controller.signal, body: { name, email, message } });

      if (controller.signal.aborted || !active.current) return;
      setFormMessage('Thank you! Your message was saved to the local team inbox.');
      setFormClass('success');
      form.reset();
    } catch (err) {
      if (controller.signal.aborted || !active.current) return;
      console.error(err);
      setFormMessage('Your message could not be saved. Please try again.');
      setFormClass('error');
    } finally {
      if (submittingRef.current === controller) { submittingRef.current = null; if (active.current) setSubmitting(false); }
    }
  };

  return (
    <main className="product-page information-page information-contact">
      <div className="layout-wrapper information-shell">
        <InformationHero title="Contact us" id="contact-top" intro="Have a question or feedback? Leave a message." />
        <div className="information-pair information-form-layout">
          <form onSubmit={handleSubmit} className="information-panel information-form" aria-label="Contact form" aria-busy={submitting}>
            <div className="information-form-fields">
              <div className="information-field">
                <Field htmlFor="name">Your name</Field>
                <input type="text" id="name" name="name" autoComplete="name" maxLength={100} disabled={submitting} required />
              </div>
              <div className="information-field">
                <Field htmlFor="email">Email address</Field>
                <input type="email" id="email" name="email" autoComplete="email" maxLength={254} disabled={submitting} required />
              </div>
            </div>
            <div className="information-field">
              <Field htmlFor="message">Message</Field>
              <textarea id="message" name="message" maxLength={5000} disabled={submitting} required />
            </div>
            <div className="information-form-actions">
              <Button type="submit" className="lmc-button lmc-button--primary" disabled={submitting}>
                {submitting ? 'Saving message…' : 'Save message'}
              </Button>
            </div>
            {formMessage && <div role={formClass === 'error' ? 'alert' : 'status'} aria-live="polite" className={`information-form-message ${formClass}`}>{formMessage}</div>}
          </form>
          <aside className="information-panel information-form-note">
            <h2>Local inbox</h2>
            <p>Your name, email and message are stored for administrators in this installation. No external email is sent.</p>
            <p className="information-note-divider">For account or data requests, include the email you use with LetMeCook.</p>
            <Link to="/privacy">How we use your information</Link>
          </aside>
        </div>
      </div>
    </main>
  );
}
