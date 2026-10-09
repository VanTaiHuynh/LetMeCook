import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { FaSpinner } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import { kitchenRequest } from "../utils/kitchenApi";
import { KitchenContext } from "../utils/useKitchen";
import "../pages/Kitchen.css";

function actionMessage(label, complete = false) {
  if (label.startsWith("Find ")) return complete ? "Recipe ideas ready." : "Finding recipes…";
  if (label.startsWith("Ask ")) return complete ? "Sunny’s reply is ready." : "Checking the recipe…";
  if (label.startsWith("Preview ")) return complete ? "Preview ready." : "Preparing preview…";
  if (/^Check (?:current )?stock/.test(label)) return complete ? "Stock checked." : "Checking stock…";
  if (label.startsWith("Export ")) return complete ? "Download ready." : "Preparing download…";
  if (/^(Next|Previous) step/.test(label)) return complete ? "Your place is saved." : "Saving your place…";
  if (/^(Delete|Remove) /.test(label)) return complete ? "Removed." : "Removing…";
  return complete ? "Changes saved." : "Saving changes…";
}

function KitchenScope({ title, intro, householdId, onScope, children, embedded }) {
  const { pathname } = useLocation();
  const navRef = useRef(null);
  const errorRef = useRef(null);
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, updateError] = useState("");
  const [retryLoading, setRetryLoading] = useState(false);
  const setError = useCallback(value => { updateError(value); setRetryLoading(false); setConflict(false); }, []);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const actionRef = useRef(null);
  const activeRef = useRef(true);
  const reload = useCallback(() => { if (activeRef.current) setRevision(value => value + 1); }, []);
  useEffect(() => {
    if (!error || !errorRef.current) return;
    errorRef.current.focus({ preventScroll: true });
    errorRef.current.scrollIntoView({ block: "nearest" });
  }, [error]);
  useEffect(() => {
    const revealActiveTab = () => {
      const nav = navRef.current;
      const activeTab = nav?.querySelector('[aria-current="page"]');
      if (!activeTab) return;
      const bounds = nav.getBoundingClientRect();
      const tabBounds = activeTab.getBoundingClientRect();
      const leftEdge = bounds.left + 8;
      const rightEdge = bounds.right - 8;
      if (tabBounds.right > rightEdge) nav.scrollLeft += tabBounds.right - rightEdge;
      else if (tabBounds.left < leftEdge) nav.scrollLeft += tabBounds.left - leftEdge;
    };
    revealActiveTab();
    window.addEventListener("resize", revealActiveTab);
    return () => window.removeEventListener("resize", revealActiveTab);
  }, [pathname]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    kitchenRequest("/bootstrap", { householdId, signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(failure => { if (!controller.signal.aborted) { setError(failure.message); setRetryLoading(true); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [householdId, revision, setError]);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; actionRef.current?.abort(); }; }, []);
  const mutate = async (label, path, body, method, refresh = true) => {
    if (!activeRef.current || actionRef.current) return null;
    const controller = new AbortController(); actionRef.current = controller;
    setBusy(label); setError(""); setConflict(false); setNotice("");
    try {
      const value = await kitchenRequest(path, { householdId, body, method, signal: controller.signal });
      if (controller.signal.aborted || !activeRef.current) return null;
      setNotice(actionMessage(label, true)); if (refresh) reload(); return value;
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failure.message); setConflict(failure.status === 409); }
      return null;
    } finally { if (actionRef.current === controller) { actionRef.current = null; if (activeRef.current) setBusy(""); } }
  };
  const isCooking = embedded || pathname.startsWith("/cook-along/");
  const Container = embedded ? "div" : "main";
  const suffix = householdId ? `?householdId=${encodeURIComponent(householdId)}` : "";
  const isOwner = !householdId || data?.scope?.role === 'owner';
  const collaborationEnabled = data?.features?.collaborationEnabled === true;
  const value = { data, householdId, revision, loading, busy, mutate, reload, setNotice, setError, selectScope: onScope, collaborationEnabled, canEdit: !!data && data.scope?.role !== 'viewer' && (isOwner || collaborationEnabled), isOwner };
  return <KitchenContext.Provider value={value}><Container className={`kitchen-page ${embedded ? "kitchen-embedded" : `kitchen-tool-${pathname.split("/")[1] || "kitchen"}`}`}><div className="kitchen-shell">
    {!embedded && <div className={isCooking ? "kitchen-session-toolbar" : "kitchen-tools-header"}><header className={`kitchen-header${isCooking ? " kitchen-header-compact" : ""}`}>{!isCooking && <div><h1>{title}</h1><p>{intro}</p></div>}<Field className="kitchen-scope">Kitchen<select value={householdId || ""} disabled={!!busy} onChange={event => onScope(event.target.value || null)}><option value="">My personal kitchen</option>{(data?.households || []).map(household => <option value={household.id} key={household.id}>{household.name} · {household.role}</option>)}</select></Field></header>
    {!embedded && <nav ref={navRef} className="kitchen-nav" aria-label="Kitchen tools">{[["/pantry", "Pantry"], ["/meal-planner", "Meal planner"], ["/household", "Household"], ["/evidence", "Evidence"], ["/creator", "Creator"]].map(([path, label]) => <NavLink key={path} to={`${path}${suffix}`}>{label}</NavLink>)}</nav>}</div>}
    <div className="kitchen-feedback" aria-live="polite">{busy && <p className="kitchen-working"><FaSpinner className="kitchen-spinner" aria-hidden="true" />{actionMessage(busy)}</p>}{error && <div ref={errorRef} className="kitchen-error" role="alert" tabIndex={-1}><p>{error}</p>{(conflict || retryLoading) && <Button type="button" className="kitchen-secondary" onClick={reload} disabled={!!busy}>{conflict ? "Reload latest data" : "Retry loading"}</Button>}</div>}{notice && <p className="kitchen-notice" role="status">{notice}</p>}</div>
    {loading && !data ? <div className="kitchen-loading" role="status"><span>Loading your kitchen…</span><div className="kitchen-loading-lines" aria-hidden="true"><i /><i /><i /></div></div> : data ? <>{householdId && !value.canEdit && <p className="kitchen-scope-note">Read-only access. The owner manages this kitchen.</p>}<div className="kitchen-content">{children}</div>{!data.pantry?.length && !data.recentSessions?.length && value.canEdit && <details className="kitchen-start"><summary>Start your kitchen</summary><div className="kitchen-actions"><Link className="kitchen-secondary" to={`/pantry${suffix}`}>Add stock</Link><Link className="kitchen-secondary" to={`/meal-planner${suffix}`}>Plan dinners</Link><Link className="kitchen-text-link" to="/recipes">Choose a recipe</Link></div></details>}</> : !loading && !error ? <div className="kitchen-empty">No kitchen data available.</div> : null}
  </div></Container></KitchenContext.Provider>;
}

export default function KitchenShell({ title, intro, children, embedded = false }) {
  const Container = embedded ? "div" : "main";
  const { user, loading } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const householdId = params.get("householdId") || null;
  if (loading) return <Container className={`kitchen-page${embedded ? " kitchen-embedded" : ""}`}><div className="kitchen-empty" role="status">Checking your account…</div></Container>;
  if (!user) return <Container className={`kitchen-page${embedded ? " kitchen-embedded" : ""}`}><div className="kitchen-shell kitchen-signin"><h1>{title}</h1><p>{intro}</p><p className="kitchen-signin-help">Sign in to save your kitchen and continue where you left off.</p><div className="kitchen-actions"><Link className="kitchen-primary" to="/login" state={{ from: { pathname: location.pathname, search: location.search } }}>Sign in</Link><Link className="kitchen-text-link" to="/recipes">Browse recipes</Link></div></div></Container>;
  return <KitchenScope key={`${user.id}:${householdId || "personal"}`} title={title} intro={intro} embedded={embedded} householdId={householdId} onScope={id => { const next = new URLSearchParams(params); if (id) next.set("householdId", id); else next.delete("householdId"); setParams(next); }}>{children}</KitchenScope>;
}
