import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211d",
        forest: "#23362c",
        action: "#294a39",
        moss: "#315747",
        gold: "#b58a3c",
        "gold-on-dark": "#d2aa5f",
        paper: "#f8f7f2",
        surface: "#ffffff"
      }
    }
  },
  plugins: []
};

export default config;
