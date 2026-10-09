import { ownProfile } from "../utils/accountApi";
import Button from "../components/ui/Button";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../utils/supabaseClient";
import { FaBars, FaSearch, FaTimes, FaUserCircle } from "react-icons/fa";
import SearchBarModal from "./SearchBarModal";
import { navbarLogo as logo } from "../utils/siteAsset";

export default function MainNav() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(() => window.matchMedia("(max-width: 1040px)").matches);
  const [accountOpen, setAccountOpen] = useState(false);
  const [avatar, setAvatar] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [showSearchModal, setShowSearchModal] = useState(false);
  const navRef = useRef(null);
  const accountRef = useRef(null);
  const accountButtonRef = useRef(null);
  const searchButtonRef = useRef(null);
  const menuButtonRef = useRef(null);

  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 1040px)");
    const update = event => setCompactNav(event.matches);
    viewport.addEventListener("change", update);
    return () => viewport.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const controller = new AbortController(); setAvatar(null);
    if (user) ownProfile({ signal: controller.signal, actorId: user.id }).then(profile => { if (!controller.signal.aborted) setAvatar(profile.image_url || null); }).catch(() => {});
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (accountRef.current && !accountRef.current.contains(event.target)) setAccountOpen(false);
      if (navRef.current && !navRef.current.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && accountOpen) {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen, menuOpen]);

  const closeSearch = useCallback(() => {
    setShowSearchModal(false);
    searchButtonRef.current?.focus();
  }, []);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true); setAccountError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      navigate("/");
    } catch {
      setAccountError("Could not log out. Try again.");
    } finally { setLoggingOut(false); }
  };

  const items = [
    { path: user ? "/dashboard" : "/", label: "Home", end: true },
    { path: "/features", label: "Features" },
    { path: "/recipes", label: "Recipes" },
    { path: "/meal-planner", label: "Meal planner" },
    { path: "/sunny", label: "Sunny AI" },
    ...(user ? [{ path: "/pantry", label: "Kitchen" }] : []),
  ];

  const links = (<div id="main-navigation-links" className={`nav-links ${menuOpen ? "is-open" : ""}`}>
          {items.map((item) => <NavLink key={item.path} to={item.path} end={item.end} onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>{item.label}</NavLink>)}
          {!user && <NavLink to="/login" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link lmc-login-link${isActive ? " active" : ""}`}>Log in</NavLink>}
      </div>);

  return <div className="banner-nav lmc-navigation">
    <nav ref={navRef} className="layout-wrapper main-nav" aria-label="Main navigation">
      <NavLink to={user ? "/dashboard" : "/"} className="lmc-brand" aria-label="Let Me Cook home">
        <img src={logo} alt="Let Me Cook" className="logo" />
      </NavLink>
      {!compactNav && links}
      <div className="lmc-navigation-controls">
        {user && <div className="lmc-account" ref={accountRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false); }}>
          <Button type="button" className="lmc-icon-button" ref={accountButtonRef} aria-label="Account menu"
            aria-expanded={accountOpen} aria-controls="account-menu" onClick={() => { setMenuOpen(false); setAccountOpen((value) => !value); }}>
            {avatar ? <img src={avatar} alt="" className="avatar-icon-nav" onError={() => setAvatar(null)} /> : <FaUserCircle aria-hidden="true" />}
          </Button>
          {accountOpen && <ul className="lmc-account-menu" id="account-menu" onClick={event => { if (event.target.closest('a')) setAccountOpen(false); }}>
            <li><NavLink to="/profile">My Profile</NavLink></li>
            <li><NavLink to="/favourites">My favorites</NavLink></li>
            <li><NavLink to="/user-recipe">My Recipes</NavLink></li>
            {user.app_metadata?.role === "admin" && <li><NavLink to="/admin">Operations</NavLink></li>}
            <li><Button type="button" disabled={loggingOut} onClick={logout}>{loggingOut ? "Logging out…" : "Log Out"}</Button></li>
            {accountError && <li><p className="lmc-account-error" role="alert">{accountError}</p></li>}
          </ul>}
        </div>}
        <Button type="button" className="lmc-icon-button" ref={searchButtonRef} aria-label="Search recipes with Sunny"
          onClick={() => { setMenuOpen(false); setAccountOpen(false); setShowSearchModal(true); }}><FaSearch aria-hidden="true" /></Button>
        <Button type="button" ref={menuButtonRef} className="lmc-icon-button lmc-menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen} aria-controls="main-navigation-links" onClick={() => { setAccountOpen(false); setMenuOpen((value) => !value); }}>
          {menuOpen ? <FaTimes aria-hidden="true" /> : <FaBars aria-hidden="true" />}
        </Button>
      </div>
      {compactNav && links}
    </nav>
    {showSearchModal && <SearchBarModal onClose={closeSearch} />}
  </div>;
}
