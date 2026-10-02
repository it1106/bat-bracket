import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Tailwind's default scale, multiplied by --text-scale (see globals.css)
      // so text-* classes grow on phones with the rest of the text. For a
      // one-off size, use text-[length:calc(12px*var(--text-scale))] rather
      // than text-[12px], which wouldn't scale.
      fontSize: {
        xs: ["calc(0.75rem * var(--text-scale))", { lineHeight: "calc(1rem * var(--text-scale))" }],
        sm: ["calc(0.875rem * var(--text-scale))", { lineHeight: "calc(1.25rem * var(--text-scale))" }],
        base: ["calc(1rem * var(--text-scale))", { lineHeight: "calc(1.5rem * var(--text-scale))" }],
        lg: ["calc(1.125rem * var(--text-scale))", { lineHeight: "calc(1.75rem * var(--text-scale))" }],
        xl: ["calc(1.25rem * var(--text-scale))", { lineHeight: "calc(1.75rem * var(--text-scale))" }],
        "2xl": ["calc(1.5rem * var(--text-scale))", { lineHeight: "calc(2rem * var(--text-scale))" }],
        "3xl": ["calc(1.875rem * var(--text-scale))", { lineHeight: "calc(2.25rem * var(--text-scale))" }],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
