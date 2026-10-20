import type { MetadataRoute } from "next";

// Only the public pages. Everything behind sign-in is left out on purpose.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://ideahq.cloud";
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/guide`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/auth/signin`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
