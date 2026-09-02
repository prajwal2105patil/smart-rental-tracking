import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import basicSsl from "@vitejs/plugin-basic-ssl"
import path from "path"

/**
 * `npm run dev`        http on localhost — desktop work.
 * `npm run dev:phone`  https on every interface — the ONLY way a real phone can use the
 *                      camera. getUserMedia requires a secure context: localhost counts,
 *                      http://192.168.x.x does not. Over plain LAN http the browser
 *                      blocks the camera before any of our code runs, so the scan page
 *                      could only ever show its fallback.
 *
 * The certificate is self-signed, so the phone shows a warning once — tap through it.
 *
 * Phone mode also PROXIES THE API through this server, and it has to. The browser base
 * URL is baked in at build time, and on a phone "localhost:8000" is the phone itself, so
 * every call would fail; pointing it at the laptop's LAN address instead fails a second
 * time, because a page served over https may not call http — the browser blocks it as
 * mixed content before the request leaves. Proxying makes the API same-origin: the phone
 * calls https://<laptop>:5199/api/... and this server forwards it to the API on the
 * laptop's own loopback. No mixed content, no CORS, and nothing to configure per venue.
 * `.env.phone` sets VITE_API_URL=/api to match.
 */
export default defineConfig(({ mode }) => {
  const phone = mode === "phone"
  return {
    plugins: [react(), tailwindcss(), ...(phone ? [basicSsl()] : [])],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: {
      port: 5199,
      strictPort: true,
      host: phone ? true : "localhost",
      proxy: phone
        ? {
            "/api": {
              target: "http://localhost:8000",
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/api/, ""),
            },
          }
        : undefined,
    },
  }
})
