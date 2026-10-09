import { useState } from 'react';
import { Link } from 'react-router-dom';
import { startingPoints } from './startingPoints';

export default function FeatureFinder({ presentationOnly = false }) {
  const [selectedId, setSelectedId] = useState(startingPoints[0].id);
  const selected = startingPoints.find(item => item.id === selectedId) || startingPoints[0];
  const groups = [...new Set(startingPoints.map(item => item.group))];
  return <section id="next-step" className="marketing-finder layout-wrapper" aria-labelledby="next-step-title">
    <div className="marketing-finder-choice">
      <h2 id="next-step-title">Find your next step.</h2>
      <p className="marketing-description">Choose what you need today and open the right kitchen tool.</p>
      {presentationOnly
        ? <Link className="marketing-text-link" to="/how-it-works#kitchen-guides">Explore the kitchen guides</Link>
        : <div className="marketing-finder-field"><label htmlFor="kitchen-goal">What would you like to do?</label><select id="kitchen-goal" value={selected.id} onChange={event => setSelectedId(event.target.value)} aria-controls="kitchen-next-action">{groups.map(group => <optgroup key={group} label={group}>{startingPoints.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></div>}
    </div>
    <aside id="kitchen-next-action" className="marketing-finder-action" aria-label="Your next step" aria-live="polite" aria-atomic="true">
      <h3>{selected.title}</h3><p>{selected.description}</p>
      <ol>{selected.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <div className="marketing-actions"><Link className="lmc-button lmc-button--primary" to={selected.path}>{selected.cta}</Link><Link className="marketing-text-link" to={`/how-it-works#${selected.guide}`}>Read the short guide</Link></div>
      {selected.account && <p className="marketing-finder-account">Log in to use your saved kitchen.</p>}
    </aside>
  </section>;
}
