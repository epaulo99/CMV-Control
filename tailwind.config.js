/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#09223B",
        brand: {
          50: "#ECF7F7",
          100: "#D2EDED",
          500: "#1793A5",
          600: "#117786",
          700: "#0D5E6A",
        },
        sand: "#FFF9ED",
      },
      boxShadow: {
        soft: "0 12px 35px -20px rgba(9, 34, 59, 0.45)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        rise: "rise 500ms ease-out both",
      },
    },
  },
  plugins: [],
};
