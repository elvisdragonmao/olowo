import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Absolute URLs for canonical, Open Graph, JSON-LD, robots.txt and sitemap.xml come from the public origin. */
function seo(origin: string): Plugin {
	return {
		name: "olowo-seo",
		transformIndexHtml: html => html.replaceAll("%SITE_ORIGIN%", origin),
		generateBundle() {
			this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\nDisallow: /v1/\n\nSitemap: ${origin}/sitemap.xml\n` });
			this.emitFile({
				type: "asset",
				fileName: "sitemap.xml",
				source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\t<url>\n\t\t<loc>${origin}/</loc>\n\t\t<changefreq>weekly</changefreq>\n\t</url>\n</urlset>\n`
			});
		}
	};
}

// The browser talks to Fastify through the same origin so the HttpOnly session cookie stays first-party.
export default defineConfig(({ mode }) => {
	const origin = (process.env.VITE_PUBLIC_ORIGIN || loadEnv(mode, process.cwd(), "VITE_").VITE_PUBLIC_ORIGIN || "https://olowo.emtech.cc").replace(/\/+$/, "");
	return {
		build: {
			outDir: "dist/client"
		},
		server: {
			host: "0.0.0.0",
			proxy: {
				"/v1": process.env.OLOWO_API_ORIGIN ?? "http://127.0.0.1:8787"
			}
		},
		plugins: [react(), seo(origin)]
	};
});
