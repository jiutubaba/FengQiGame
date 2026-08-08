import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, Info, RefreshCw, X } from "lucide-react";

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  className = "",
  children,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === "sm" ? 14 : 16} strokeWidth={1.8} />}
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children, dot = false }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "暂时无法读取数据",
  description,
  onRetry,
}) {
  return (
    <div className="error-state" role="alert">
      <div className="error-state-icon">
        <CircleAlert size={23} strokeWidth={1.6} />
      </div>
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {onRetry && (
        <Button icon={RefreshCw} onClick={onRetry}>
          重新尝试
        </Button>
      )}
    </div>
  );
}

export function InlineAlert({ tone = "info", title, description, action }) {
  const Icon = tone === "danger" ? CircleAlert : Info;
  return (
    <div
      className={`inline-alert inline-alert-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon size={18} strokeWidth={1.7} />
      <div>
        {title && <strong>{title}</strong>}
        {description && <p>{description}</p>}
      </div>
      {action && <div className="inline-alert-action">{action}</div>}
    </div>
  );
}

export function FilterSummary({ items = [], resultText, onClear }) {
  if (!items.length && !resultText) return null;
  return (
    <div className="filter-summary" role="status" aria-live="polite">
      <span className="filter-summary-label">当前视图</span>
      {items.map((item, index) => (
        <span className="filter-summary-chip" key={`${item}-${index}`}>
          {item}
        </span>
      ))}
      {resultText && (
        <span className="filter-summary-result">{resultText}</span>
      )}
      {items.length > 0 && onClear && (
        <button type="button" onClick={onClear}>
          <X size={14} />
          清除筛选
        </button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  danger = false,
  wide = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
}) {
  const titleId = useId();
  const modalRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef(null);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = modalRef.current?.querySelector(
        "[data-modal-initial-focus]",
      );
      const firstInput = modalRef.current?.querySelector(
        "input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled])",
      );
      const firstControl = modalRef.current?.querySelector(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
      (preferred || firstInput || firstControl || modalRef.current)?.focus();
    });
    const handler = (event) => {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const controls = [
        ...modalRef.current.querySelectorAll(
          "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => !element.hidden && element.offsetParent !== null);
      if (!controls.length) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, [open, closeOnEscape]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <section
        ref={modalRef}
        className={`modal ${wide ? "modal-wide" : ""} ${danger ? "modal-danger" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolveRef = useRef(null);
  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        setRequest(
          typeof options === "string"
            ? { title: "确认操作", description: options }
            : options,
        );
      }),
    [],
  );
  const finish = useCallback((confirmed) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);
  useEffect(
    () => () => {
      resolveRef.current?.(false);
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(request)}
        onClose={() => finish(false)}
        title={request?.title || "确认操作"}
        eyebrow="CONFIRM ACTION"
        danger={request?.tone !== "primary"}
        closeOnBackdrop={false}
        footer={
          <>
            <Button data-modal-initial-focus onClick={() => finish(false)}>
              取消
            </Button>
            <Button
              variant={request?.tone === "primary" ? "primary" : "danger"}
              onClick={() => finish(true)}
            >
              {request?.confirmLabel || "确认"}
            </Button>
          </>
        }
      >
        <div className="confirm-copy">
          <CircleAlert size={20} />
          <div>
            <p>{request?.description}</p>
            {request?.detail && <small>{request.detail}</small>}
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm)
    throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = "success") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(
      () => setItems((current) => current.filter((item) => item.id !== id)),
      2600,
    );
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => {
          const Icon =
            item.tone === "danger"
              ? CircleAlert
              : item.tone === "info"
                ? Info
                : CheckCircle2;
          return (
            <div className={`toast toast-${item.tone}`} key={item.id}>
              <Icon size={17} />
              {item.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function Field({ label, hint, error, children, className = "" }) {
  return (
    <label className={`field ${error ? "field-invalid" : ""} ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <small className="field-error" role="alert">
          {error}
        </small>
      ) : (
        hint && <small>{hint}</small>
      )}
    </label>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? "is-on" : ""}`}
        onClick={() => onChange?.(!checked)}
      >
        <span />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

export function SectionHead({ eyebrow, title, description, actions }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}
