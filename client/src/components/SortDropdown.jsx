import Field from "../components/ui/Field";
const SORT_OPTIONS = {
  createdAt: "Most recent",
  viewCount: "Most popular",
  cookTime: "Cooking time",
  ratingAverage: "Highest rated",
};

export default function SortDropdown({ sort, setSort }) {
  return (
    <Field className="sort-bar product-sort-control">
      <span>Sort by</span>
      <select aria-label="Sort recipes" value={sort} onChange={(event) => setSort(event.target.value)}>
        {Object.entries(SORT_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </Field>
  );
}
