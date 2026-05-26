"use client";

import type { ReactNode } from "react";

type OverlayProps = {
  children: ReactNode;
  onClose: () => void;
  title: string;
  variant?: "side" | "center" | "wide";
};

export function Overlay({ children, onClose, title, variant = "side" }: OverlayProps) {
  return (
    <div className="detail-overlay" onClick={onClose} role="presentation">
      <aside
        aria-label={title}
        className={`detail-modal panel ${variant === "center" ? "detail-modal--center" : ""} ${
          variant === "wide" ? "detail-modal--wide" : ""
        }`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel__header">
          <h2>{title}</h2>
          <button aria-label={`Close ${title}`} className="icon-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
