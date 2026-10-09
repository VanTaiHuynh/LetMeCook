import "./Kitchen.css";
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import RecipeImage from '../components/RecipeImage';
import { CollectionSEO } from '../components/SEO';
import { catalogRequest } from '../utils/catalogApi';
import { safeAccent } from '../utils/kitchen';

export default function PublicCollection() {
  const { slug } = useParams(); const [revision, retry] = useState(0);
  const [state, setState] = useState({ slug: '', loading: true, data: null, error: null });
  useEffect(() => {
    const controller = new AbortController(); setState({ slug, loading: true, data: null, error: null });
    const load = async () => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw Object.assign(new Error('Unavailable collection'), {status:404});
      const data = await catalogRequest(`/collections/${encodeURIComponent(slug)}`, { signal: controller.signal, contractVersion: 'creator.v1' });
      if (data.slug !== slug || typeof data.name !== 'string' || !Array.isArray(data.recipes) || data.recipes.length > 48) throw new Error('Collection could not be read. Try again.');
      if (!controller.signal.aborted) setState({slug,loading:false,data,error:null});
    };
    load().catch(error => { if (!controller.signal.aborted) setState({slug,loading:false,data:null,error}); });
    return () => controller.abort();
  }, [slug, revision]);
  const loading = state.slug !== slug || state.loading; const data = !loading ? state.data : null;
  return <main className="kitchen-page product-public-collection"><div className="kitchen-shell">
    <CollectionSEO collection={data} loading={loading} />
    {loading ? <div className="kitchen-loading" role="status"><span>Loading collection…</span><div className="kitchen-loading-lines" aria-hidden="true"><i /><i /><i /></div></div> : state.error || !data ? <div className="kitchen-panel kitchen-collection-unavailable"><h1>{state.error?.status === 404 ? 'Collection unavailable' : 'Collection could not be loaded'}</h1>
      {state.error?.status === 404 && <p>Explore the recipe library for more cooking ideas.</p>}{state.error?.status !== 404 && <Alert>{state.error?.message}<Button className="kitchen-secondary" onClick={() => retry(value => value + 1)}>Retry</Button></Alert>}
      <Link to="/recipes" className="kitchen-primary">Explore recipes</Link></div> : <>
      <header className="kitchen-collection-header" style={{borderTopColor:safeAccent(data.accentColor)}}><div><h1 className="kitchen-collection-title">{data.name}</h1>{data.description && <p>{data.description}</p>}</div><Link to="/recipes" className="kitchen-secondary">Explore recipes</Link></header>
      <div className="kitchen-recipe-grid">{data.recipes.map(recipe => <article key={recipe.id} className="kitchen-recipe-card"><Link to={`/recipes/${recipe.id}`}><RecipeImage src={recipe.imageUrl} alt={recipe.title} loading="lazy"/><h2 className="kitchen-collection-recipe-title">{recipe.title}</h2></Link><p>{recipe.cookTime > 0 ? `${recipe.cookTime} min` : 'Time not listed'}</p></article>)}</div>
    </>}
  </div></main>;
}
