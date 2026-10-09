import { Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { sunnyChef as sunny } from "../utils/siteAsset";
import '../pages/MarketingPages.css';

export function MarketingAnchor() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (target?.tagName === 'DETAILS') target.open = true;
    target?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return null;
}

export function MarketingHero({ title, description, children }) {
  return <header className="marketing-hero layout-wrapper">
    <div className="marketing-hero-copy"><h1>{title}</h1><p>{description}</p>{children}</div>
    <div className="marketing-hero-sunny"><img src={sunny} alt="Sunny, your cooking companion" /></div>
  </header>;
}

export function MarketingExample({ example }) {
  return <figure className="marketing-example">
    <figcaption>{example.title}</figcaption>
    {example.quote && <blockquote>{example.quote}</blockquote>}
    <dl>{example.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    <p>{example.note}</p>
  </figure>;
}

export function MarketingNextStep() {
  return <section className="marketing-next layout-wrapper" aria-labelledby="marketing-next-title">
    <div><h2 id="marketing-next-title">Start with one good dinner.</h2><p>Tell Sunny what you feel like eating, or find a recipe you love.</p></div>
    <div className="marketing-actions"><Link className="lmc-button lmc-button--primary" to="/sunny">Ask Sunny</Link><Link className="lmc-button lmc-button--secondary" to="/recipes">Explore recipes</Link></div>
  </section>;
}
