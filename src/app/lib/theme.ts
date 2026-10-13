/** Brand design tokens for the dating-platform MVP. */

export const colors = {
  // Primary accent — warm, social, romantic but modern
  rose: {
    50: "#fdf2f8",
    100: "#fce7f3",
    200: "#fbcfe8",
    300: "#f9a8d4",
    400: "#f472b6",
    500: "#e11d48",
    600: "#be123c",
    700: "#9f1239",
    800: "#881337",
    900: "#7f1d1d",
  },
  neutral: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    900: "#18181b",
  },
  background: "var(--background)",
  foreground: "var(--foreground)",
} as const;

export const brand = {
  primary: colors.rose[500],
  primaryHover: colors.rose[600],
  surface: "var(--background)",
  border: "rgba(0, 0, 0, 0.08)",
  error: colors.rose[600],
};

export const textSizes = {
  xs: "text-sm",
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
  xl: "text-2xl",
} as const;

export const containerMaxWidth = "max-w-md";
