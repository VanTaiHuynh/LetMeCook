import { Link } from 'react-router-dom';
import { MarketingHero, MarketingNextStep, MarketingAnchor } from '../components/MarketingPages';
import { gettingStarted, kitchenQuestions } from '../features/marketing/content';
import KitchenGuides from '../features/marketing/KitchenGuides';

export default function HowItWorks() {
  return <main className="marketing-page marketing-guide" lang="en">
    <MarketingAnchor />
    <MarketingHero title="A good meal, one step at a time." description="Start with what you have or what you feel like eating. Bring choosing, planning, shopping and cooking into a rhythm that suits you.">
      <div className="marketing-actions"><Link className="lmc-button lmc-button--primary" to="/sunny">Find tonight’s dinner</Link><Link className="lmc-button lmc-button--secondary" to="/features">Explore the features</Link></div>
    </MarketingHero>
    <nav className="marketing-section-nav layout-wrapper" aria-label="Getting started"><a href="#choose">Find a meal</a><a href="#week">Plan dinners</a><a href="#groceries">Check groceries</a><a href="#cook">Cook along</a><a href="#kitchen-guides">Kitchen guides</a><a href="#questions">Questions</a></nav>
    <ol className="marketing-guide-steps layout-wrapper">{gettingStarted.map(step => <li key={step.id} id={step.id}>
      <div className="marketing-guide-copy"><h2>{step.title}</h2><p>{step.description}</p><Link className="marketing-text-link" to={step.path}>{step.cta}</Link></div>
      <aside className="marketing-guide-tip"><p>{step.tip}</p></aside>
    </li>)}</ol>
    <KitchenGuides />
    <section className="marketing-questions layout-wrapper" id="questions" aria-labelledby="questions-title"><h2 id="questions-title">A few useful things to know.</h2><div>{kitchenQuestions.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div><Link className="marketing-text-link" to="/contact">Still have a question? Contact us</Link></section>
    <MarketingNextStep />
  </main>;
}
