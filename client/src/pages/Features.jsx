import { Link } from 'react-router-dom';
import { MarketingHero, MarketingExample, MarketingNextStep, MarketingAnchor } from '../components/MarketingPages';
import { featureStories, kitchenExtras } from '../features/marketing/content';
import FeatureFinder from '../features/marketing/FeatureFinder';

export default function Features({ presentationOnly = false }) {
  return <main className="marketing-page" lang="en">
    <MarketingAnchor />
    <MarketingHero title="A little help for every meal." description="For busy days, changing tastes and the ingredients already in your kitchen. Meet Sunny, your AI cooking companion, and explore the LetMeCook experience.">
      <div className="marketing-actions"><Link className="lmc-button lmc-button--primary" to="/sunny">Meet Sunny</Link><Link className="lmc-button lmc-button--secondary" to="/how-it-works">How it works</Link></div>
    </MarketingHero>
    <nav className="marketing-section-nav layout-wrapper" aria-label="Explore the experience">
      <a href="#next-step">Get started</a><a href="#discover">Find dinner</a><a href="#plan">Plan your week</a><a href="#shop">Go shopping</a><a href="#cook">Enjoy cooking</a><a href="#your-kitchen">Make it yours</a>
    </nav>
    <FeatureFinder presentationOnly={presentationOnly} />
    <div className="marketing-stories layout-wrapper">{featureStories.map(story => <section key={story.id} id={story.id} className="marketing-story" aria-labelledby={`${story.id}-title`}>
      <div className="marketing-story-copy"><h2 id={`${story.id}-title`}>{story.title}</h2><p className="marketing-description">{story.description}</p><dl className="marketing-feature-details">{story.details.map(detail => <div key={detail.title}><dt>{detail.title}</dt><dd>{detail.text}</dd></div>)}</dl><Link className="marketing-text-link" to={story.path}>{story.cta}</Link></div>
      <MarketingExample example={story.example} />
    </section>)}</div>
    <section id="your-kitchen" className="marketing-extras layout-wrapper" aria-labelledby="your-kitchen-title"><h2 id="your-kitchen-title">Your kitchen, your way.</h2><p className="marketing-description">More ways to bring your tastes, your people and your recipes together.</p><div className="marketing-extra-list">{kitchenExtras.map(item => <article key={item.title}><h3>{item.title}</h3><p>{item.description}</p>{item.path && <Link className="marketing-text-link" to={item.path}>{item.cta}</Link>}</article>)}</div></section>
    <MarketingNextStep />
  </main>;
}
