import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "secondary" | "success" | "warning" | "error";
  size?: "sm" | "md" | "lg";
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}) => {
  const variants = {
    primary: "bg-rose-500/20 text-rose-600 dark:bg-rose-500/30 dark:text-rose-400",
    secondary: "bg-neutral-200/30 text-neutral-800 dark:bg-neutral-800/30 dark:text-neutral-200",
    success: "bg-green-500/20 text-green-600 dark:bg-green-500/30 dark:text-green-400",
    warning: "bg-yellow-500/20 text-yellow-600 dark:bg-yellow-500/30 dark:text-yellow-400",
    error: "bg-rose-500/20 text-rose-600 dark:bg-rose-500/30 dark:text-rose-400",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-xs rounded",
    md: "px-3 py-1 text-sm rounded-md",
    lg: "px-4 py-1.5 text-base rounded-xl",
  };

  return (
    <span
      className={`inline-flex items-center justify-center font-medium ${variants[
        variant
      ]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
