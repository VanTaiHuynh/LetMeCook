import { catalogRequest } from "../utils/catalogApi";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { apiUrl } from "../utils/api";
import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FaTimes, FaCamera, FaSearch, FaArrowRight, FaSpinner } from "react-icons/fa";
import { sunnyChef as chef } from "../utils/siteAsset";
import RecipeImage from "./RecipeImage";
import "./SearchBarModal.css";

export default function SearchBarModal({ onClose }) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchSettled, setSearchSettled] = useState(false);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const backgroundRoots = [...document.body.children]
      .filter(element => !element.contains(dialogRef.current) && !['SCRIPT', 'STYLE'].includes(element.tagName))
      .map(element => ({ element, previousInert: element.inert }));
    backgroundRoots.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.(); }
      if (event.key !== "Tab") return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), textarea:not(:disabled), a[href]')];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      backgroundRoots.forEach(({ element, previousInert }) => { element.inert = previousInert; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSuggestions([]);
    setError("");
    setLoading(false);
    setSearchSettled(false);
    if (!inputValue.trim()) return () => controller.abort();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ keyword: inputValue.trim(), page: "0", size: "5" });
        const data = await catalogRequest(apiUrl(`/recipes/search?${query}`), { signal: controller.signal });
        if (!controller.signal.aborted) setSuggestions(Array.isArray(data.content) ? data.content : []);
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message);
      } finally {
        if (!controller.signal.aborted) { setLoading(false); setSearchSettled(true); }
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [inputValue]);

  const openSunny = () => {
    const query = new URLSearchParams();
    if (inputValue.trim()) query.set("prompt", inputValue.trim());
    navigate(`/sunny${query.size ? `?${query}` : ""}`);
    onClose();
  };

  return createPortal(<div className="sunny-search-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="sunny-search-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sunny-search-heading">
      <div className="sunny-search-topbar"><Button type="button" className="lmc-icon-button sunny-search-close" aria-label="Close search" onClick={onClose}><FaTimes aria-hidden="true" /></Button></div>
      <div className="sunny-search-header"><div><h2 id="sunny-search-heading">What’s cooking?</h2><p>Find a recipe by name, or ask Sunny for ideas.</p></div><img src={chef} alt="" /></div>
      <form onSubmit={(event) => { event.preventDefault(); if (inputValue.trim()) openSunny(); }}>
        <Field htmlFor="sunny-modal-prompt">Ask Sunny or find a recipe</Field>
        <textarea id="sunny-modal-prompt" aria-describedby="sunny-search-input-help" ref={inputRef} rows={3} maxLength={2000} value={inputValue}
          placeholder="A vegan dinner with mushrooms… or a recipe title"
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (inputValue.trim()) openSunny(); } }} />
        <p id="sunny-search-input-help" className="sunny-search-input-help">Press Enter to ask Sunny. Shift + Enter adds a new line.</p>
        <div className="sunny-search-actions">
          <Button type="submit" disabled={!inputValue.trim()} className="lmc-button lmc-button--primary sunny-search-ask">Ask Sunny <FaArrowRight aria-hidden="true" /></Button>
          <Button type="button" className="lmc-button lmc-button--secondary" disabled={!inputValue.trim()} onClick={() => { navigate(`/search?${new URLSearchParams({ keyword: inputValue.trim() })}`); onClose(); }}><FaSearch aria-hidden="true" /> Search titles</Button>
          <Button type="button" className="lmc-button lmc-button--quiet" onClick={openSunny}><FaCamera aria-hidden="true" /> Add a photo</Button>
        </div>
      </form>
      {loading && <p className="sunny-search-feedback" role="status"><FaSpinner className="sunny-search-spinner" aria-hidden="true" /> Finding recipe titles…</p>}
      {error && <p className="sunny-search-feedback" role="status">{error}</p>}
      {searchSettled && !loading && !error && inputValue.trim() && !suggestions.length && <p className="sunny-search-feedback" role="status">No matching titles yet. Ask Sunny to search by ingredients and cooking preferences.</p>}
      {suggestions.length > 0 && <ul className="sunny-search-suggestions" aria-label="Matching recipe titles">{suggestions.map((recipe) => <li key={recipe.id}>
        <Button type="button" onClick={() => { navigate(`/recipes/${recipe.id}`); onClose(); }}>
          {recipe.imageUrl && <RecipeImage src={recipe.imageUrl} alt="" loading="lazy" />}<span>{recipe.title}</span><FaArrowRight aria-hidden="true" />
        </Button>
      </li>)}</ul>}
      <p className="sunny-search-footnote">Photos open in Sunny, where you can review the ingredients before searching.</p>
    </section>
  </div>, document.body);
}
