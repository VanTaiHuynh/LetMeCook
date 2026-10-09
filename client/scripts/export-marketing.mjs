import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Export only the public presentation. The application, public recipe archive,
// runtime configuration, account code and API clients never enter this release.
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.dirname(clientRoot);
const releaseRoot = path.resolve(process.argv[2] || path.join(repoRoot, '../../outputs/LetMeCook-marketing-launch'));
const publicRoot = path.join(releaseRoot, 'public');
const site = 'https://letmecook.ca';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const pages = [
  { route: '/', title: 'LetMeCook — A good dinner starts here', description: 'Meet Sunny, your AI cooking companion. Find meals you love, plan your week and enjoy every step.', module: null },
  { route: '/features', title: 'LetMeCook features — A little help for every meal', description: 'Explore taste-led dinner ideas, ingredient photos, meal plans, shopping lists, voice guidance and your shared kitchen.', module: '/src/pages/Features.jsx' },
  { route: '/how-it-works', title: 'How LetMeCook works — One good meal at a time', description: 'Find a meal, plan dinners, check your groceries and cook at your own pace with Sunny.', module: '/src/pages/HowItWorks.jsx' },
  { route: '/about', title: 'About LetMeCook — Less dinner stress, more kitchen joy', description: 'Meet the cooking experience that brings recipes, planning and Sunny together around your everyday life.', module: '/src/pages/About.jsx' },
  { route: '/privacy', title: 'LetMeCook privacy policy', description: 'Privacy information for the LetMeCook presentation website.', module: '/src/features/marketing/PublicPrivacy.jsx' },
  { route: '/terms', title: 'LetMeCook terms and conditions', description: 'Terms for browsing the LetMeCook presentation website.', module: '/src/features/marketing/PublicTerms.jsx' },
];

const assets = [
  ['src/assets/navbarlogo.png', 'assets/navbarlogo.png'],
  ['src/assets/sunnythechef.png', 'assets/sunnythechef.png'],
  ['src/assets/sunnythumbsup.png', 'assets/sunnythumbsup.png'],
  ['public/favicon_logo.ico', 'favicon.ico'],
  ['public/fonts/raleway/Raleway-Variable.woff2', 'fonts/raleway/Raleway-Variable.woff2'],
  ['public/fonts/raleway/Raleway-Italic-Variable.woff2', 'fonts/raleway/Raleway-Italic-Variable.woff2'],
  ['public/fonts/raleway/OFL.txt', 'fonts/raleway/OFL.txt'],
];
const stylesheets = ['src/styles.css', 'src/design-system.css', 'src/pages/Home.css', 'src/pages/StartupIdeas.css', 'src/pages/MarketingPages.css', 'src/pages/InformationPages.css', 'src/pages/About.css'];

const navItems = [['/', 'Home'], ['/features', 'Features'], ['/how-it-works', 'How it works'], ['/about', 'About']];
function navigation(route) {
  const links = navItems.map(([href, label]) => `<a class="nav-link${href === route ? ' active' : ''}" href="${href}"${href === route ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<header class="lmc-navigation public-navigation"><nav class="layout-wrapper main-nav" aria-label="Main navigation"><a href="/" class="lmc-brand" aria-label="LetMeCook home"><img class="logo" src="/assets/navbarlogo.png" alt="LetMeCook" width="98" height="56"></a><div class="nav-links public-desktop-nav">${links}</div><details class="public-mobile-nav"><summary>Menu</summary><div class="nav-links">${links}</div></details></nav></header>`;
}
function footer() {
  return `<footer class="footer"><div class="layout-wrapper"><div class="footer-inner"><div class="lmc-footer-brand"><img src="/assets/navbarlogo.png" alt="LetMeCook" width="98" height="68" loading="lazy"><p>A little inspiration. A better dinner.</p></div><nav class="footer-nav" aria-label="Footer navigation"><div><h2>The experience</h2><a href="/features">Features</a><a href="/how-it-works">How it works</a></div><div><h2>LetMeCook</h2><a href="/">Home</a><a href="/about">About</a></div><div><h2>Policies</h2><a href="/privacy">Privacy policy</a><a href="/terms">Terms &amp; conditions</a></div></nav><p class="footer-copy">© 2024–${Math.max(2024, new Date().getFullYear())} LetMeCook. All rights reserved.</p></div></div></footer>`;
}

// Public buttons name the information their link opens. They never pretend to
// start a chat, save a meal plan, open an account or submit an offline form.
function publicLinks(markup, route) {
  const mappings = {
    '/sunny': route === '/how-it-works' ? ['/features#discover', 'Explore dinner inspiration'] : ['/how-it-works#choose', 'See how to start with Sunny'],
    '/meal-planner': route === '/how-it-works' ? ['/features#plan', 'Explore meal planning'] : ['/how-it-works#week', 'See how to plan your week'],
    '/pantry': ['/features#shop', 'Explore pantry and shopping'],
    '/edit-profile': ['/how-it-works#guide-after-cooking', 'Explore taste feedback'],
    '/household': ['/how-it-works#guide-household', 'Explore household cooking'],
    '/favourites': ['/how-it-works#guide-recipes', 'Explore saved recipes'],
    '/user-recipe': ['/how-it-works#guide-recipes', 'Explore your recipe collection'],
    '/creator': ['/features#your-kitchen', 'Explore food creator features'],
    '/recipes': route === '/how-it-works' ? ['/features#cook', 'Explore cooking with Sunny'] : ['/how-it-works#cook', 'See how to cook along'],
    '/contact': ['/about', 'About LetMeCook'],
  };
  markup = markup.replace(/<a\b([^>]*?)href="([^"]+)"([^>]*?)>([\s\S]*?)<\/a>/g, (original, before, href, after, text) => {
    const mapped = mappings[href];
    return mapped ? `<a${before}href="${mapped[0]}"${after}>${mapped[1]}</a>` : original;
  });
  // The shared final invitation also needs to describe a public reading action.
  markup = markup.replace('Tell Sunny what you feel like eating, or find a recipe you love.', 'Explore the features, then follow the guide from dinner idea to cooking.');
  markup = markup.replace(/<details class="information-contents" open="">/g, '<details class="information-contents">');
  return markup.replace(/\/src\/assets\/(navbarlogo|sunnythechef|sunnythumbsup)\.png/g, '/assets/$1.png');
}

function home(journeyMarkup) {
  return `<main class="home-page public-home" lang="en"><section class="home-hero" aria-labelledby="home-title"><div class="layout-wrapper home-hero-grid"><div class="home-hero-copy"><h1 id="home-title">A good dinner<br>starts here.</h1><p class="home-hero-description">Your AI cooking companion. Find meals you love, plan your week and enjoy every step with Sunny.</p><div class="marketing-actions"><a class="lmc-button lmc-button--primary" href="/features">Discover the experience</a><a class="lmc-button lmc-button--secondary" href="/how-it-works">See how it works</a></div></div><div class="home-hero-visual"><section class="public-sunny-panel" aria-labelledby="public-sunny-title"><img src="/assets/sunnythechef.png" alt="Sunny, your cooking companion" width="160" height="220" fetchpriority="high"><div><h2 id="public-sunny-title">A little help from Sunny.</h2><p>From the ingredients on hand to a dinner plan that fits your week.</p><ul><li>Dinner ideas around your tastes</li><li>Meals, portions and groceries together</li><li>Spoken steps and cooking timers</li></ul></div></section></div></div></section>${journeyMarkup}<section class="home-signup public-guide-invitation layout-wrapper" aria-labelledby="home-guide-title"><div class="home-signup-copy"><img src="/assets/sunnythumbsup.png" alt="Sunny giving a thumbs up" width="64" height="90" loading="lazy"><div><h2 id="home-guide-title">Make dinner feel simpler.</h2><p>Start with one meal. See how choosing, planning, shopping and cooking come together.</p></div></div><div class="home-signup-action"><a class="lmc-button lmc-button--primary" href="/how-it-works">Explore the cooking guide</a></div></section></main>`;
}

function document(page, markup) {
  const canonical = `${site}${page.route === '/' ? '/' : page.route}`;
  return `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(page.title)}</title><meta name="description" content="${escape(page.description)}"><meta name="robots" content="index, follow"><meta name="theme-color" content="#FED369"><link rel="canonical" href="${canonical}"><link rel="icon" href="/favicon.ico"><link rel="preload" href="/fonts/raleway/Raleway-Variable.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/assets/marketing.css"><meta property="og:type" content="website"><meta property="og:site_name" content="LetMeCook"><meta property="og:title" content="${escape(page.title)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${site}/assets/sunnythechef.png"><meta property="og:image:alt" content="Sunny, the LetMeCook cooking companion"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(page.title)}"><meta name="twitter:description" content="${escape(page.description)}"><meta name="twitter:image" content="${site}/assets/sunnythechef.png"></head><body class="lmc-app public-marketing"><a class="lmc-skip-link" href="#main-content">Skip to content</a>${navigation(page.route)}<div id="main-content" tabindex="-1">${markup}</div>${footer()}</body></html>\n`;
}

const publicCss = `
/* Public presentation uses the shared Sunny brand without app controls. */
.public-navigation .main-nav { grid-template-columns:auto minmax(0,1fr); grid-template-areas:"brand links"; }
.public-mobile-nav { display:none; }
.public-home .home-hero-grid { grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); }
.public-home .marketing-actions { margin-top:0; }
.public-home .marketing-actions .lmc-button--primary { background:var(--lmc-ink); color:var(--lmc-surface); }
.public-home .marketing-actions .lmc-button--primary:hover { background:#403D34; }
.public-sunny-panel { display:flex; align-items:center; gap:24px; width:100%; padding:32px; border-radius:var(--lmc-radius-card); background:var(--lmc-cream); }
.public-sunny-panel > img { flex:0 0 132px; width:132px; height:190px; object-fit:contain; }
.public-sunny-panel h2 { font-size:26px; line-height:1.3; margin-bottom:12px; }
.public-sunny-panel p { max-width:35ch; color:var(--lmc-muted); }
.public-sunny-panel ul { margin:16px 0 0; padding-left:18px; color:var(--lmc-ink); font-size:14px; line-height:1.6; }
.public-sunny-panel li + li { margin-top:8px; }
.public-guide-invitation .home-signup-action { align-items:flex-start; }
.public-marketing { scrollbar-color:var(--lmc-gold) var(--lmc-cream); }
.public-marketing summary { cursor:pointer; }
.public-marketing :where(a,summary):focus-visible { outline:3px solid var(--lmc-ink); outline-offset:4px; }
@media(max-width:1040px) { .public-navigation .public-desktop-nav { display:flex; grid-template-columns:none; margin:0; padding:0; border:0; } .public-sunny-panel { padding:24px; gap:16px; } .public-sunny-panel > img { flex-basis:100px; width:100px; height:154px; } .public-sunny-panel h2 { font-size:22px; } }
@media(max-width:740px) { .public-home .home-hero-grid { grid-template-columns:minmax(0,1fr); } .public-sunny-panel { padding:24px 20px; } .public-sunny-panel > img { flex-basis:110px; width:110px; height:158px; } .public-guide-invitation .home-signup-action { align-items:stretch; } }
@media(max-width:600px) { .public-navigation .main-nav { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; } .public-navigation .public-desktop-nav { display:none; } .public-mobile-nav { display:block; margin-left:auto; } .public-mobile-nav summary { display:list-item; min-height:48px; padding:12px 16px; border:1px solid var(--lmc-line); border-radius:var(--lmc-radius-control); font-size:14px; font-weight:650; } .public-mobile-nav[open] { flex:1 1 100%; margin:0; } .public-mobile-nav[open] > summary { width:max-content; margin-left:auto; } .public-navigation .public-mobile-nav .nav-links { display:flex; flex-direction:column; align-items:stretch; justify-content:flex-start; width:100%; margin-top:12px; padding:8px 0 0; border-top:1px solid var(--lmc-line); } .public-navigation .public-mobile-nav .nav-link { width:100%; } .public-home .marketing-actions { gap:12px; } .public-home .marketing-actions a { flex:1 1 auto; } }
@media(max-width:360px) { .public-sunny-panel { gap:12px; } .public-sunny-panel > img { flex-basis:74px; width:74px; height:124px; } .public-sunny-panel h2 { font-size:20px; } }
`;

await fs.mkdir(releaseRoot, { recursive: true });
await fs.rm(publicRoot, { recursive: true, force: true });
await fs.mkdir(publicRoot, { recursive: true });
for (const [source, target] of assets) {
  await fs.mkdir(path.dirname(path.join(publicRoot, target)), { recursive: true });
  await fs.copyFile(path.join(clientRoot, source), path.join(publicRoot, target));
}
const css = (await Promise.all(stylesheets.map(file => fs.readFile(path.join(clientRoot, file), 'utf8')))).join('\n');
await fs.writeFile(path.join(publicRoot, 'assets/marketing.css'), css + publicCss);

const vite = await createServer({ configFile: false, root: clientRoot, plugins: [react()], appType: 'custom', server: { middlewareMode: true }, publicDir: false, ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'import', 'default'] } } });
const renderedPages = new Map();
try {
  const { StaticRouter } = await vite.ssrLoadModule('react-router-dom');
  const StartupIdeas = (await vite.ssrLoadModule('/src/pages/StartupIdeas.jsx')).default;
  for (const page of pages) {
    const Component = page.module ? (await vite.ssrLoadModule(page.module)).default : StartupIdeas;
    let markup = renderToStaticMarkup(React.createElement(StaticRouter, { location: page.route }, React.createElement(Component, { presentationOnly: true })));
    markup = publicLinks(markup, page.route);
    if (page.route === '/') markup = home(markup);
    const destination = page.route === '/' ? publicRoot : path.join(publicRoot, page.route.slice(1));
    await fs.mkdir(destination, { recursive: true });
    const html = document(page, markup);
    renderedPages.set(page.route, html);
    await fs.writeFile(path.join(destination, 'index.html'), html);
  }
} finally {
  await vite.close();
}

// Make future content changes fail the export if they introduce broken public
// links or accidentally pull interactive application controls into the release.
for (const [route, html] of renderedPages) {
  if (/<(?:script|form|iframe)\b/i.test(html)) throw new Error(`Interactive application markup found on ${route}`);
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    const target = new URL(href.replace(/&amp;/g, '&'), `${site}${route}`);
    if (target.origin !== site) continue;
    const targetHtml = renderedPages.get(target.pathname);
    if (!targetHtml) throw new Error(`Unexported public route: ${route} links to ${href}`);
    if (target.hash && !targetHtml.includes(`id="${decodeURIComponent(target.hash.slice(1))}"`)) throw new Error(`Missing public anchor: ${route} links to ${href}`);
  }
  for (const [, src] of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) {
    if (!assets.some(([, target]) => src === `/${target}`)) throw new Error(`Unlisted public image: ${route} uses ${src}`);
  }
}

const notFound = { route: '/404', title: 'LetMeCook — Page not found', description: 'Return to the LetMeCook experience.' };
await fs.writeFile(path.join(publicRoot, '404.html'), document(notFound, '<main class="marketing-page"><section class="layout-wrapper marketing-hero"><div class="marketing-hero-copy"><h1>This page is not here.</h1><p>Explore the LetMeCook experience, or return to the cooking guide.</p><div class="marketing-actions"><a class="lmc-button lmc-button--primary" href="/">Back to home</a><a class="lmc-button lmc-button--secondary" href="/how-it-works">Explore the guide</a></div></div></section></main>').replace('index, follow', 'noindex, follow'));
await fs.writeFile(path.join(publicRoot, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);
await fs.writeFile(path.join(publicRoot, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `<url><loc>${site}${page.route}</loc></url>`).join('\n')}\n</urlset>\n`);
for (const file of ['Dockerfile', 'nginx.conf', '.dockerignore']) await fs.copyFile(path.join(repoRoot, 'deploy/marketing', file), path.join(releaseRoot, file));
const manifest = {
  site,
  origin: 'http://127.0.0.1:8092',
  pages: pages.map(page => page.route),
  source: 'Shared marketing React pages and design-system CSS; static Home without API collection or forms',
  publicRuntime: 'Static HTML and CSS; native details navigation and disclosures; no JavaScript',
  assets: assets.map(([, target]) => target),
};
await fs.writeFile(path.join(releaseRoot, 'export-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Exported ${pages.length} public pages to ${publicRoot}`);
