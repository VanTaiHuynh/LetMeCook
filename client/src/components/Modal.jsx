import Button from "../components/ui/Button";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { FaInfoCircle, FaQuestionCircle } from "react-icons/fa";
import "../modal.css";

export default function Modal({ isOpen, onClose, onConfirm, message, showConfirmButtons, title, confirmLabel = "Confirm", confirmVariant = "primary" }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const backgroundRoots = [...document.body.children]
      .filter(element => !element.contains(dialogRef.current) && !["SCRIPT", "STYLE"].includes(element.tagName))
      .map(element => ({ element, previousInert: element.inert }));
    backgroundRoots.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector("button")?.focus();
    const onKey = event => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.(); }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
      const first = controls[0];
      const last = controls.at(-1);
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      backgroundRoots.forEach(({ element, previousInert }) => { element.inert = previousInert; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);
  if (!isOpen) return null;

  return createPortal(<div className="lmc-modal-overlay">
    <section className="lmc-modal-dialog" ref={dialogRef} role={showConfirmButtons ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
      <span className="lmc-modal-mark" aria-hidden="true">{showConfirmButtons ? <FaQuestionCircle /> : <FaInfoCircle />}</span>
      <h2 id={titleId}>{title || (showConfirmButtons ? "Please confirm" : "Update")}</h2>
      <p id={messageId}>{message}</p>
      <div className="lmc-modal-actions">
        {showConfirmButtons ? <>
          <Button type="button" className="lmc-button lmc-button--secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" className={`lmc-button lmc-button--${confirmVariant === "danger" ? "danger" : "primary"}`} onClick={onConfirm}>{confirmLabel}</Button>
        </> : <Button type="button" className="lmc-button lmc-button--primary" onClick={onClose}>OK</Button>}
      </div>
    </section>
  </div>, document.body);
}
