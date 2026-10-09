Let Me Cook SEO runtime

Default local behavior
PUBLIC_SITE_ORIGIN is empty and SEO_INDEXING_ENABLED is false. Every HTML
route has noindex, no invented external canonical, and no recipe JSON-LD.
Sitemaps contain no URLs. Search, Sunny, meal plans, accounts, kitchens,
workspace, newsletter management and error pages remain noindex even when
public indexing is enabled. Query variants also remain noindex.

Runtime
The web image includes a small Node gateway on loopback port 9403. Nginx
continues serving hashed assets, proxying /api to Spring and checking original
recipe image permissions with auth_request. The gateway creates initial HTML
head metadata and a readable public recipe/catalog fallback for every visitor;
there is no crawler detection. React then renders the same application.
Node supervises Nginx, forwards termination, and stops on either process failure.
The existing web health check requests / through both Nginx and the gateway.

Visibility and freshness
Only anonymous existing Spring API responses can supply recipe metadata,
fallback content or sitemap entries. JWTs and cookies are never forwarded.
Recipe requests recheck current visibility every time; there is no positive
recipe cache. HTML/XML use Cache-Control:no-store. Private, withheld or missing
recipes receive generic noindex HTML with HTTP404. Recipe/backend availability
errors receive HTTP503 and Retry-After. Catalog outages have a safe noindex
shell; general static pages can still load. React RecipeSEO independently
checks anonymous visibility before adding share metadata to an owner-view page.

Indexing configuration, only after the official origin is confirmed
Set PUBLIC_SITE_ORIGIN to the actual HTTPS origin, without credentials,
subpath, query or fragment. Set SEO_INDEXING_ENABLED=true only when public
distribution permissions, HTTPS and public deployment are ready. Do not use
the example.org origin from unit fixtures as a production domain. The current
10,000 imported source recipes/images are not automatically licensed for public
publication by this change; current platform visibility/approval gates remain
authoritative. No production domain or external publication was configured.

Compose passes matching VITE_PUBLIC_SITE_ORIGIN/VITE_SEO_INDEXING_ENABLED build
args and runtime settings. Runtime HTML also carries safe JSON configuration,
which React reads, so initial and client metadata agree. Rebuild the web image
when changing public site configuration. For Vite development only, use the
matching VITE_* values in client/.env; the default template remains noindex.

Sitemaps and structured data
/sitemap.xml references /sitemaps/pages.xml and numbered recipe files of at
most500 rows. A current catalog of10,000 public recipes produces20 recipe files.
Public page entries include /features and /how-it-works. Both use the same
explicit indexing policy as the home, catalog and other public information
pages, render without querying private kitchen data, and remain noindex for
local configuration or query variants. The public HTML navigation links to
both marketing pages. Their addition does not change recipe release gates.
Current capacity is50,000 recipes; extend sharding before exceeding it. Sitemap
images are permanent /recipe-images/ source assets only, never upload/signed
storage URLs. Image requests still recheck existing distribution permissions.
No artificial lastmod is emitted. Recipe JSON-LD uses actual name, original
photo URL, listed ingredients, instructions, known total time/servings, and
source attribution. Separate prep/cook times, imported publication dates,
nutrition, dietary certifications and review aggregates are not fabricated.
User uploads without a permanent crawlable source image get no Recipe schema.

Checks
From the repository root:
  node client/src/utils/seo.test.mjs
  node deploy/seo/gateway.test.mjs
Or on a Node release supporting it:
  node --test --test-isolation=none client/src/utils/seo.test.mjs deploy/seo/gateway.test.mjs
Scoped lint: from client, npx eslint src/components/SEO.jsx src/utils/seo.js

After the root agent rebuilds the web container, verify initial HTML and rendered
DOM titles/descriptions/robots, one canonical and one JSON-LD tag where eligible,
local noindex, private/unavailable404, transient503, anonymous sitemap contents,
and original image permission checks. External indexing/rich-result validation
requires the real permitted public site; no ranking or indexing claim is made.

Primary references checked2026-10-08
https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
https://developers.google.com/search/docs/appearance/structured-data/recipe
https://developers.google.com/search/docs/appearance/title-link
https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
https://developers.google.com/search/docs/crawling-indexing/block-indexing

Google recommends useful descriptive titles, absolute consistent canonicals,
real visible recipe facts and crawlable image URLs. A crawler must be allowed
to read a page to see noindex; robots.txt is not an authorization mechanism.
