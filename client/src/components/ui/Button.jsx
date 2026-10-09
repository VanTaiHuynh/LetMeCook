/** Native button with the existing page class; the shared class adds consistent focus/disabled behavior. */
export default function Button({ children, className = '', busy = false, disabled, type = 'button', ...props }) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`lmc-control ${className}`.trim()}>{children}</button>;
}
