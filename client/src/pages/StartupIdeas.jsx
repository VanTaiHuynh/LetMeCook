import { Link } from "react-router-dom";
import { kitchenJourney, experienceHighlights } from "../features/marketing/content";
import "./StartupIdeas.css";
export default function StartupIdeas() {
  return <section className="home-kitchen layout-wrapper" aria-labelledby="home-kitchen-title">
    <div className="home-section-header"><h2 id="home-kitchen-title">From dinner ideas to dinner.</h2><Link className="home-text-link" to="/how-it-works">How it works</Link></div>
    <div className="home-kitchen-flow">{kitchenJourney.map(item => <article key={item.path}><h3>{item.title}</h3><p>{item.description}</p><Link to={item.path}>{item.cta}</Link></article>)}</div>
    <div className="home-more-tools"><div className="home-section-header"><h3>A little more Sunny in your kitchen.</h3><Link className="home-text-link" to="/features">Explore all features</Link></div><div className="home-tool-list">{experienceHighlights.map(item => <Link key={item.title} to={`/features#${item.id}`}><h4>{item.title}</h4><p>{item.description}</p></Link>)}</div></div>
  </section>;
}
