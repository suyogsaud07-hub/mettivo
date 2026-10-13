import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "outline";
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = "default",
  className = "",
  ...props
}) => {
  const variants = {
    default:
      "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800",
    elevated:
      "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl shadow-neutral-200/50 dark:shadow-black/40",
    outline: "bg-transparent border-2 border-neutral-300 dark:border-neutral-700",
  };

  return (
    <div
      className={`rounded-2xl ${variants[variant]} overflow-hidden ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
