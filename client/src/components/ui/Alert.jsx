import Button from './Button';
export default function Alert({ children, as = 'div', tone = 'error', className = '', onRetry, retryLabel = 'Retry', ...props }) {
  const Element = as;
  return <Element {...props} role={tone === 'error' ? 'alert' : 'status'} className={`lmc-alert ${className}`.trim()}>
    {children}{onRetry && <Button className="lmc-button lmc-button--secondary" onClick={onRetry}>{retryLabel}</Button>}
  </Element>;
}
