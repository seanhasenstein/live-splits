import type { MetadataRoute } from "next";
import {
  APP_DESCRIPTION,
  APP_NAME,
  BACKGROUND_COLOR,
  THEME_COLOR,
} from "@/config/app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    // Home-screen icons are added with the rest of "Add to home screen" (MVP item 11).
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
