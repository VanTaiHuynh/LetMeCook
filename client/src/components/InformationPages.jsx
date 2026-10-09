import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import '../pages/InformationPages.css';

function useWideReadingLayout() {
  const [wide, setWide] = useState(() => typeof window === 'undefined' || (window.matchMedia ? window.matchMedia('(min-width: 900px)').matches : window.innerWidth >= 900));
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(min-width: 900px)');
    const update = event => setWide(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function InformationHero({ title, intro, id, children, aside }) {
  return <header className={`information-hero${aside ? ' information-pair' : ''}`}>
    <div className="information-hero-copy">
      <h1 id={id} className="product-page-title">{title}</h1>
      {intro && <p className="information-intro">{intro}</p>}
      {children}
    </div>
    {aside && <aside className="information-hero-aside">{aside}</aside>}
  </header>;
}

export function PolicyDocument({ title, intro, topId, sections, footerTo = '/contact', footerLabel = 'Questions? Contact us' }) {
  const wide = useWideReadingLayout();
  return <main className="product-page information-page information-policy">
    <div className="layout-wrapper information-shell">
      <InformationHero title={title} intro={intro} id={topId} />
      <div className="information-reading">
        <aside className="information-contents-rail">
          <details className="information-contents" open={wide}>
            <summary>On this page</summary>
            <nav aria-label="On this page">
              {sections.map(({ id, title: sectionTitle }) => <a key={id} href={`#${id}`}>{sectionTitle}</a>)}
            </nav>
          </details>
        </aside>
        <article className="information-document" aria-label={title}>
          {sections.map(({ id, title: sectionTitle, body }) => <section key={id} className="information-clause" aria-labelledby={id}>
            <h2 id={id}>{sectionTitle}</h2>
            <div className="information-clause-body">{body}</div>
          </section>)}
          <div className="information-document-footer"><a href={`#${topId}`}>Back to top</a><Link to={footerTo}>{footerLabel}</Link></div>
        </article>
      </div>
    </div>
  </main>;
}

export function RecoveryPage({ code, title, children, image, primaryTo, primaryLabel, secondaryTo = '/', secondaryLabel = 'Back to home' }) {
  return <main className="product-page information-page information-recovery">
    <div className="layout-wrapper information-shell">
      <div className="information-recovery-grid information-pair">
        <section className="information-recovery-copy">
          <p className="information-error-code">Error {code}</p>
          <h1 className="product-page-title">{title}</h1>
          <p className="information-intro">{children}</p>
          <div className="information-actions"><Link className="lmc-button lmc-button--primary" to={primaryTo}>{primaryLabel}</Link><Link className="lmc-button lmc-button--secondary" to={secondaryTo}>{secondaryLabel}</Link></div>
        </section>
        <div className="information-recovery-art"><img src={image} alt="" /></div>
      </div>
    </div>
  </main>;
}
