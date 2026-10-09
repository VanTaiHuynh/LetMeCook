import { Link } from 'react-router-dom';
import { kitchenGuides } from './guides';

export default function KitchenGuides() {
  return <section className="marketing-questions marketing-kitchen-guides layout-wrapper" id="kitchen-guides" aria-labelledby="kitchen-guides-title">
    <h2 id="kitchen-guides-title">A guide for your next step.</h2>
    <p className="marketing-description">Choose what you want to do. Keep the useful steps close.</p>
    <div className="marketing-kitchen-guide-list">{kitchenGuides.map(guide => <details key={guide.id} id={guide.id} className="marketing-guide-detail">
      <summary>{guide.title}</summary>
      <div className="marketing-guide-detail-content">
        <p>{guide.description}</p>
        <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <div className="marketing-guide-detail-actions">
          <Link className="marketing-text-link" to={guide.appLink.path}>{guide.appLink.label}</Link>
          <Link className="marketing-text-link" to={guide.feature.path}>{guide.feature.label}</Link>
        </div>
      </div>
    </details>)}</div>
  </section>;
}
