/** Retains native label semantics and each feature's layout. Nested controls remain implicitly labelled. */
export default function Field({ children, label, hint, error, className = '', ...props }) {
  return <label {...props} className={className || undefined}>{label}{children}
    {hint && <span className="lmc-field-help">{hint}</span>}
    {error && <span className="lmc-field-error" role="alert">{error}</span>}
  </label>;
}
