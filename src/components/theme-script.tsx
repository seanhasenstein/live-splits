import { THEME_STORAGE_KEY } from "@/components/theme";

/**
 * Applies a saved theme before first paint, so a dark preference never
 * flashes light. Follows the Next.js "preventing flash before hydration"
 * pattern: the script is real on the server and inert on the client, so
 * React doesn't warn about rendering a <script>.
 */
export function ThemeScript() {
  const code = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
