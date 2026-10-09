import { catalogRequest } from "../utils/catalogApi";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useState, useEffect, useRef, useId, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { FaChevronDown, FaCheck, FaTimes } from "react-icons/fa";
import { apiUrl } from "../utils/api";
import SortDropdown from "./SortDropdown";

function FilterDropdown({ label, options, selected, open, onToggle, onClose, onSelect }) {
  const buttonRef = useRef(null);
  const optionsRef = useRef(null);
  const optionId = useId();
  const [position, setPosition] = useState(null);
  const focusedOpen = useRef(false);
  const startAtLast = useRef(false);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = buttonRef.current.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) { onClose(); return; }
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const placeAbove = below < 200 && above > below;
      const maxHeight = Math.min(320, Math.max(44, placeAbove ? above : below), Math.max(44, window.innerHeight - 16));
      const width = Math.min(280, window.innerWidth - 32);
      setPosition({ width, maxHeight, left: Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16)),
        top: placeAbove ? Math.max(8, bounds.top - maxHeight - 8) : bounds.bottom + 8 });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open) { focusedOpen.current = false; return; }
    if (!position || focusedOpen.current) return;
    const controls = optionsRef.current?.querySelectorAll("button:not(:disabled)");
    const initial = startAtLast.current ? controls?.[controls.length - 1] : controls?.[0];
    (initial || optionsRef.current)?.focus({ preventScroll: true });
    focusedOpen.current = true;
    startAtLast.current = false;
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!buttonRef.current?.contains(event.target) && !optionsRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, onClose]);

  const closeOnBlur = event => {
    if (!buttonRef.current?.contains(event.relatedTarget) && !optionsRef.current?.contains(event.relatedTarget)) onClose();
  };
  const handleKey = event => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && open) {
      event.preventDefault(); buttonRef.current?.focus(); onClose(); return;
    }
    if (event.target === buttonRef.current && !open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); startAtLast.current = event.key === "ArrowUp"; onToggle(); return;
    }
    if (!open || !optionsRef.current?.contains(event.target)) return;
    const controls = [...optionsRef.current.querySelectorAll("button:not(:disabled)")];
    const index = controls.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && controls.length) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
      controls[next].focus(); return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && index <= 0) {
      event.preventDefault(); buttonRef.current?.focus(); onClose();
    } else if (!event.shiftKey && (index === controls.length - 1 || !controls.length)) {
      event.preventDefault();
      // The portal is at the end of body; continue after its trigger in page order.
      const pageControls = [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")]
        .filter(control => control.tabIndex >= 0 && !control.matches(":disabled") && !control.closest("[inert]")
          && control.getClientRects().length > 0 && !optionsRef.current.contains(control));
      const triggerIndex = pageControls.indexOf(buttonRef.current);
      (pageControls[triggerIndex + 1] || buttonRef.current)?.focus(); onClose();
    }
  };

  return <div className="dropdown" onBlur={closeOnBlur} onKeyDown={handleKey}>
    <Button ref={buttonRef} type="button" className="dropdown-button" aria-expanded={open} aria-controls={optionId} onClick={onToggle}>
      <span>{label}</span>{selected.length > 0 && <span className="dropdown-count-badge" aria-label={`${selected.length} selected`}>{selected.length}</span>}<FaChevronDown aria-hidden="true" />
    </Button>
    {open && createPortal(<div ref={optionsRef} id={optionId} className="recipe-filter-options dropdown-content scrollable" style={{ ...position, visibility: position ? "visible" : "hidden" }} onBlur={closeOnBlur} onKeyDown={handleKey} role="group" tabIndex={-1} aria-label={`${label} options`}>
      {options.length ? options.map(({ label: optionLabel, value }) => <Button type="button" key={value} className="dropdown-item" aria-pressed={selected.includes(value)} onClick={() => onSelect(value)}>
        <span>{optionLabel}</span>{selected.includes(value) && <FaCheck aria-hidden="true" />}
      </Button>) : <p className="filter-options-empty">No options available.</p>}
    </div>, document.body)}
  </div>;
}

export default function FilterBar({ filters, setFilters, sort, setSort, minRating = "", setMinRating, onClearAll }) {
  const [openDropdownGroup, setOpenDropdownGroup] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);
  const [filterError, setFilterError] = useState(false);
  const [filterRequestVersion, setFilterRequestVersion] = useState(0);
  const closeFilters = useCallback(() => setOpenDropdownGroup(null), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setFilterError(false);
    const fetchFilters = async () => {
      try {
        const endpoints = { categories: apiUrl("/categories"), cuisines: apiUrl("/cuisines"), dietaryPreferences: apiUrl("/dietary-preferences") };
        const results = await Promise.all(Object.entries(endpoints).map(async ([key, url]) => {
          const data = await catalogRequest(url, { signal: controller.signal });
          return [key, data.map(item => ({ label: item.name.charAt(0).toUpperCase() + item.name.slice(1).toLowerCase(), value: item.name }))];
        }));
        const dynamicFilters = Object.fromEntries(results);
        if (active) setFilterOptions({
          categories: { label: "Category", options: dynamicFilters.categories },
          cuisines: { label: "Cuisine", options: dynamicFilters.cuisines },
          dietaryPreferences: { label: "Diet", options: dynamicFilters.dietaryPreferences },
        });
      } catch {
        if (active && !controller.signal.aborted) setFilterError(true);
      }
    };
    fetchFilters();
    return () => { active = false; controller.abort(); };
  }, [filterRequestVersion]);

  const handleSelect = (group, value) => setFilters(previous => ({
    ...previous,
    [group]: (previous[group] || []).includes(value) ? previous[group].filter(item => item !== value) : [...(previous[group] || []), value],
  }));

  const clearAll = () => {
    if (onClearAll) onClearAll();
    else { setFilters({ categories: [], cuisines: [], dietaryPreferences: [] }); setMinRating?.(""); }
    closeFilters();
  };

  return <div className="filter-bar">
    <div className="filter-top-row">
      <div className="filter-dropdowns">
        {filterOptions ? Object.entries(filterOptions).map(([group, { label, options }]) => <FilterDropdown key={group} label={label} options={options} selected={filters[group] || []}
          open={openDropdownGroup === group} onToggle={() => setOpenDropdownGroup(previous => previous === group ? null : group)} onClose={closeFilters} onSelect={value => handleSelect(group, value)} />)
          : <div className="filter-options-feedback">
            <p className="product-status" role={filterError ? "alert" : "status"}>{filterError ? "Recipe filters are unavailable. You can still browse the collection." : "Loading recipe filters…"}</p>
            {filterError && <Button type="button" className="lmc-button lmc-button--secondary" onClick={() => setFilterRequestVersion(previous => previous + 1)}>Retry filters</Button>}
          </div>}
      </div>
      <div className="sort-by">
        {setMinRating && <Field className="sort-bar product-sort-control"><span>Minimum overall rating</span>
          <select aria-label="Minimum overall recipe rating" value={minRating} onChange={event => setMinRating(event.target.value)}>
            <option value="">Any rating</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}+ stars</option>)}
            {minRating && !Number.isInteger(Number(minRating)) && <option value={minRating}>{minRating}+ stars</option>}
          </select></Field>}
        <SortDropdown sort={sort} setSort={setSort} />
      </div>
    </div>
    <div className="selected-filters">
      {Object.entries(filters).flatMap(([group, values]) => values.map(value => <Button type="button" key={`${group}-${value}`} className="filter-tag" aria-label={`Remove ${value} filter`} onClick={() => setFilters(previous => ({ ...previous, [group]: previous[group].filter(item => item !== value) }))}>
        {value.charAt(0).toUpperCase() + value.slice(1)} <FaTimes aria-hidden="true" />
      </Button>))}
      {minRating && <Button type="button" className="filter-tag" aria-label="Remove minimum rating filter" onClick={() => setMinRating?.("")}>Overall {minRating}+ stars <FaTimes aria-hidden="true" /></Button>}
      {(minRating || Object.values(filters).some(values => values.length > 0)) && <Button type="button" className="clear-all" onClick={clearAll}>Clear all</Button>}
    </div>
  </div>;
}
