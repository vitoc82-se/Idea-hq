// Light or dark, remembered in this browser. With nothing remembered the device setting decides, so people who
// already see dark pages keep seeing them. THEME_SCRIPT runs in the page <head> before anything is drawn, so there is
// no flash of the wrong theme; the switcher (components/theme-switcher.tsx) changes the same attribute.
export const THEME_KEY = "ideahq-theme";
export type Theme = "light" | "dark";

export const THEME_SCRIPT =
  `(function(){var d=document.documentElement;try{var t=localStorage.getItem("${THEME_KEY}");` +
  `if(t!=="light"&&t!=="dark")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";` +
  `d.setAttribute("data-theme",t)}catch(e){d.setAttribute("data-theme","light")}})();`;
