import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211d",
        moss: "#315747",
        gold: "#b58a3c",
        paper: "#f8f7f2"
      }
    }
  },
  plugins: []
};

export default config;
