import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  className = "",
  id,
  ...props
}) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`
          w-full px-4 py-2.5 rounded-xl border
          bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100
          placeholder:text-neutral-400 dark:placeholder:text-neutral-600
          transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500
          disabled:opacity-50 disabled:cursor-not-allowed
          ${
            error
              ? "border-rose-500 focus:ring-rose-500 focus:border-rose-500"
              : "border-neutral-300 dark:border-neutral-700"
          }
          ${className}
        `}
        {...props}
      />
      {error ? (
        <p className="mt-1 text-sm text-rose-500">{error}</p>
      ) : helperText ? (
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};
