"use client";

import React from "react";

export interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg" | "xl";
  online?: boolean;
}

const sizes = {
  sm: "w-8 h-8 text-sm",
  md: "w-12 h-12 text-base",
  lg: "w-16 h-16 text-xl",
  xl: "w-24 h-24 text-3xl",
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt = "",
  fallback,
  size = "md",
  online = false,
}) => {
  const [hasError, setHasError] = React.useState(false);

  const displayFallback =
    fallback || (alt ? alt.slice(0, 2).toUpperCase() : "?");

  return (
    <div className="relative inline-block">
      <div
        className={`rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden flex items-center justify-center flex-shrink-0 ${sizes[size]} ${
          online ? "ring-2 ring-green-500 ring-offset-2 dark:ring-offset-neutral-950" : ""
        }`}
      >
        {src && !hasError ? (
          <img
            src={src}
            alt={alt}
            className="w-full h-full object-cover"
            onError={() => setHasError(true)}
          />
        ) : (
          <span className="text-neutral-600 dark:text-neutral-400 font-medium">
            {displayFallback}
          </span>
        )}
      </div>
      {online && (
        <span className="absolute bottom-0 right-0 block w-3 h-3 bg-green-500 rounded-full ring-2 ring-white dark:ring-neutral-950" />
      )}
    </div>
  );
};
