import { Link } from "react-router-dom";
import { sunnyChef as sunny } from "../utils/siteAsset";

/** Account forms share one continuous Sunny and form canvas. */
export default function AuthLayout({ children, recovery = false }) {
  return (
    <main className="product-page product-auth-page layout-wrapper">
      <div className="auth-layout">
        <aside className="auth-brand-panel" aria-label="Your LetMeCook kitchen">

          <h2>{recovery ? "Back to your kitchen." : "Cook something good."}</h2>
          <p>{recovery ? "Get back to your saved recipes and weekly plans." : "Save recipes, plan your week and cook with Sunny."}</p>
          <img src={sunny} alt="" className="auth-sunny" />
          <Link to="/recipes" className="auth-explore-link">Explore recipes</Link>
        </aside>
        <div className="auth-form-panel">{children}</div>
      </div>
    </main>
  );
}
