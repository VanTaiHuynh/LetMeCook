import { PolicyDocument } from '../../components/InformationPages';

const sections = [
  {
    id: 'terms-browsing',
    title: 'Using this website',
    body: <p>Use these pages responsibly. Do not attempt to disrupt the website, interfere with other visitors’ access or gain unauthorized access to its hosting services.</p>,
  },
  {
    id: 'terms-feature-information',
    title: 'Feature descriptions and examples',
    body: <p>This website introduces the LetMeCook cooking experience. Its links open feature information and guides. Dinner requests, meal plans and shopping checks labeled as examples illustrate how the experience fits into everyday life; they are not personal recommendations.</p>,
  },
  {
    id: 'terms-cooking-information',
    title: 'Cooking and dietary needs',
    body: <p>The content is general cooking and meal-planning information. It is not medical advice or a personalized diet plan, and does not guarantee that a meal is suitable for an allergy or dietary requirement. Check ingredient labels, recipe instructions and your own needs before cooking.</p>,
  },
  {
    id: 'terms-content-and-links',
    title: 'Content and external links',
    body: <p>Browsing this website does not grant permission to reuse its branding, images or written content. If you follow a link to another website, its content and terms are provided by that operator. Check the source and any permissions before reusing third-party material.</p>,
  },
  {
    id: 'terms-privacy',
    title: 'Privacy',
    body: <p>Our <a href="/privacy">Privacy Policy</a> explains request information and browser storage for this presentation website.</p>,
  },
  {
    id: 'terms-updates',
    title: 'Updates to these pages',
    body: <p>Feature information and these terms may change as LetMeCook develops. Review the current pages when returning to the website.</p>,
  },
];

export default function PublicTerms() {
  return <PolicyDocument
    title="Terms & Conditions"
    intro="These terms cover the LetMeCook presentation website and the feature information on it."
    topId="terms-top"
    sections={sections}
    footerTo="/about"
    footerLabel="About LetMeCook"
  />;
}
