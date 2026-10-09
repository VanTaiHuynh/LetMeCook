import { PolicyDocument } from '../../components/InformationPages';

const sections = [
  {
    id: 'privacy-browsing',
    title: 'Browsing this website',
    body: <p>You can read about LetMeCook without creating an account. This presentation website has no sign-up, contact or payment forms, and does not accept ingredient photos, voice recordings or personal kitchen records.</p>,
  },
  {
    id: 'privacy-page-requests',
    title: 'Loading pages and keeping them secure',
    body: <>
      <p>Your browser sends information needed to load a page, including its address and details about the request. Our hosting services and Cloudflare process website traffic to deliver pages and help keep the site secure. This can include your IP address, browser and connection information.</p>
      <p>Read <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a> for how it handles information when providing these services.</p>
    </>,
  },
  {
    id: 'privacy-browser-storage',
    title: 'Cookies and browser storage',
    body: <p>The published pages do not include advertising or marketing analytics scripts, or save a profile or preferences in your browser. Images and fonts are served with the website. Hosting and security services may process request information or use their own security cookies. See <a href="https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/">Cloudflare’s cookie information</a> for details.</p>,
  },
  {
    id: 'privacy-external-links',
    title: 'Links to other websites',
    body: <p>When you follow a link to another website, that operator’s privacy practices apply. Review its notice before sharing information there.</p>,
  },
  {
    id: 'privacy-scope-and-updates',
    title: 'This notice and future changes',
    body: <p>This notice covers the presentation website at letmecook.ca. It does not describe personal data handling inside a separate cooking account or application. We will update this page if the information collected through this website changes.</p>,
  },
];

export default function PublicPrivacy() {
  return <PolicyDocument
    title="Privacy Policy"
    intro="This notice explains what happens when you browse the LetMeCook presentation website."
    topId="privacy-top"
    sections={sections}
    footerTo="/about"
    footerLabel="About LetMeCook"
  />;
}
