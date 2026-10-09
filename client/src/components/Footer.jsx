import { Link } from "react-router-dom";
import { navbarLogo as logo } from "../utils/siteAsset";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="layout-wrapper">
        <div className="footer-inner">
          <div className="lmc-footer-brand"><img src={logo} alt="Let Me Cook" /><p>A little inspiration. A better dinner.</p></div>
          <nav className="footer-nav" aria-label="Footer navigation">
            <div><h2>Cook with us</h2><Link to="/recipes">Recipes</Link><Link to="/sunny">Sunny AI</Link><Link to="/meal-planner">Meal planner</Link><Link to="/pantry">Your kitchen</Link></div>
            <div><h2>Let Me Cook</h2><Link to="/features">Features</Link><Link to="/how-it-works">How it works</Link><Link to="/about">About</Link><Link to="/contact">Contact</Link><Link to="/newsletter">Newsletter</Link></div>
            <div><h2>Policies</h2><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms &amp; Conditions</Link></div>
          </nav>
          <p className="footer-copy">
            © 2024–{Math.max(2024, new Date().getFullYear())} Let Me Cook. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
