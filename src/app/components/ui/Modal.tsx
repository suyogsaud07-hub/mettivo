import React from "react";
import { useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: "sm" | "md" | "lg" | "full";
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
}) => {
  if (!isOpen) return null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const widthMap = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    full: "w-full max-w-[90vh]",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className={`${widthMap[width]} relative rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl w-full max-w-md mx-4`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 rounded-full bg-neutral-200 dark:bg-neutral-800 p-1.5 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors"
          aria-label="Close"
        >
          <svg
            className="h-4 w-4 stroke-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {title && (
          <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {title}
            </h3>
          </div>
        )}

        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
};
