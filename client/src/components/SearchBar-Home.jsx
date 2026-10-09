import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function SearchBar() {
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const adjustHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  useEffect(() => {
    adjustHeight();
  }, []);

  const openSunny = () => {
    const prompt = inputRef.current.value.trim();
    const params = new URLSearchParams();
    if (prompt) params.set("prompt", prompt);
    navigate(`/sunny${params.size ? `?${params}` : ""}`);
  };

  const handleInput = () => {
    adjustHeight();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();

      const prompt = inputRef.current.value.trim();
      if (!prompt) return;

      openSunny();
    }
  };

  return (
    <form className="search-box" onSubmit={(event) => { event.preventDefault(); openSunny(); }}>
      <div className="search-inner">
        <Field htmlFor="home-sunny-prompt">What would you like to cook?</Field>
        <textarea
          id="home-sunny-prompt"
          ref={inputRef}
          rows={2}
          className="search-input"
          placeholder="Chicken, mushrooms, 30 minutes…"
          maxLength={2000}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
        <div className="home-search-footer"><Button type="submit" className="home-sunny-submit">Ask Sunny</Button></div>
      </div>
    </form>
  );
}
