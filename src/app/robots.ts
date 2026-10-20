import type { MetadataRoute } from "next";

const PRIVATE = ["/api/", "/ideas", "/projects", "/support", "/users", "/billing", "/welcome", "/widget/", "/help/", "/t/", "/embed/", "/auth/change-password"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: "https://ideahq.cloud/sitemap.xml",
    host: "https://ideahq.cloud",
  };
}
