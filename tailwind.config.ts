import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Noto Sans JP"',
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Hiragino Sans",
          "Hiragino Kaku Gothic ProN",
          "Meiryo",
          "sans-serif",
        ],
      },
      colors: {
        primary: {
          DEFAULT: "#60a5fa",
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        accent: {
          DEFAULT: "#f59e0b",
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
        surface: {
          DEFAULT: "#f8fafc",
          light: "#ffffff",
          lighter: "#f1f5f9",
          card: "rgba(255, 255, 255, 0.85)",
          border: "rgba(0, 0, 0, 0.06)",
        },
        success: {
          DEFAULT: "#10b981",
          light: "#34d399",
        },
        error: {
          DEFAULT: "#ef4444",
          light: "#f87171",
        },
      },
    },
  },
  plugins: [],
};
export default config;
