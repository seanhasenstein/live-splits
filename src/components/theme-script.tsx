import { THEME_STORAGE_KEY } from "@/components/theme";

/**
 * Server component: an inline script in <head> that applies a saved theme
 * before first paint, so a dark preference never flashes light.
 */
export function ThemeScript() {
  const code = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
