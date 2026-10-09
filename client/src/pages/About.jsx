import { Link } from 'react-router-dom';
import { InformationHero } from '../components/InformationPages';
import { sunnyChef as sunny } from "../utils/siteAsset";
import './About.css';

export default function About() {
  return <main className="product-page information-page information-about">
    <div className="layout-wrapper information-shell">
      <InformationHero title="About LetMeCook" id="about-top" intro="A little less dinner stress. A little more joy in the kitchen." aside={<img src={sunny} className="information-mascot" alt="Sunny, the LetMeCook cooking assistant" />}>
        <div className="information-actions"><Link to="/features" className="lmc-button lmc-button--primary">Explore the features</Link><Link to="/how-it-works" className="lmc-button lmc-button--secondary">See how it works</Link></div>
      </InformationHero>
      <section className="information-panel information-about-content about-purpose" aria-labelledby="about-purpose">
        <h2 id="about-purpose">Dinner should fit your life.</h2>
        <p>Some nights you want to try something new. Others, you just want a good meal
          with what is already in the fridge. LetMeCook starts with both: less time
          deciding, more room to enjoy making something.</p>
        <p>The experience we’re shaping brings recipes, planning and AI cooking support
          together around the way you eat, shop and cook.</p>
        <div className="about-story">
          <section aria-labelledby="about-inspiration">
            <h3 id="about-inspiration">Start with what you have</h3>
            <p>Ingredients on hand, a favorite flavor or a craving can be the starting
              point. Sunny is our friendly AI cooking companion, with a vision for
              turning ingredient photos and everyday questions into ideas that suit your taste.</p>
          </section>
          <section aria-labelledby="about-week">
            <h3 id="about-week">Make the week feel lighter</h3>
            <p>A few dinner ideas become a weekly plan, and a plan gives the grocery
              list a purpose. Shared household planning is part of that picture:
              a place for everyone’s preferences and a clearer sense of what to buy.</p>
          </section>
          <section aria-labelledby="about-cooking">
            <h3 id="about-cooking">Enjoy the cooking part</h3>
            <p>Clear steps, useful timers and voice guidance are at the heart of a
              calmer cooking experience. The goal is to keep the next step close,
              so you can focus on the food in front of you.</p>
          </section>
        </div>
      </section>
      <footer className="about-notes">
        <Link to="/privacy" className="about-privacy">Read the privacy policy</Link>
      </footer>
    </div>
  </main>;
}
