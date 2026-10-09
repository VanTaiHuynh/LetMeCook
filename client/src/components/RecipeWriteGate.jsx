import Button from "../components/ui/Button";
import { Link } from 'react-router-dom';
export default function RecipeWriteGate({state,title}) {
  return <main className="product-page product-recipe-form-page"><header className="lmc-page-header"><h1 className="product-page-title">{title}</h1></header><section className="recipe-editor-panel">{state.loading?<p role="status">Checking recipe editing controls…</p>:state.error?<div className="product-status" role="alert"><p>{state.error}</p><Button type="button" className="product-primary-link" onClick={state.retry}>Retry controls</Button></div>:<div className="product-status"><p>Recipe editing and photo uploads are paused for this reviewed catalog.</p><Link className="product-primary-link" to="/recipes">Explore recipes</Link></div>}</section></main>;
}
