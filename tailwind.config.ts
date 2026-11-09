import type { Config } from "tailwindcss";
export default {
 content: ["./app/**/*.{ts,tsx}","./components/**/*.{ts,tsx}"],
 theme: { extend: { colors: {
  ink: "#172336", muted: "#667386", border: "#E5EAF0", canvas: "#F8FAFC",
  accent: "#2259D5", "accent-soft": "#EDF3FF", paid: "#16804C", "paid-soft":"#EAF7F0",
  warn: "#98630D", "warn-soft": "#FFF6E5"
 }, boxShadow: { subtle:"0 1px 3px rgba(18,35,61,.05)" }, borderRadius:{card:"14px"},
 keyframes: { criteriaIn: {from:{opacity:"0",transform:"translateY(6px)"},to:{opacity:"1",transform:"translateY(0)"}}, moneyIn:{from:{opacity:"0",transform:"translateY(9px)"},to:{opacity:"1",transform:"translateY(0)"}} },
 animation: {criteriaIn:"criteriaIn .32s ease both",moneyIn:"moneyIn .35s ease both"}
 } }, plugins: [],
} satisfies Config;
