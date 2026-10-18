import { loadPublicSpace } from "@/lib/support/public-store";
import { embedScript, EMBED_NOT_AVAILABLE } from "@/lib/support/embed-script";
import { publicOrigin } from "@/lib/support/http";

// PUBLIC script: /embed/KEY.js adds the Help button to the owner's site.
export async function GET(request: Request, { params }: { params: { file: string } }) {
  const key = params.file.endsWith(".js") ? params.file.slice(0, -3) : "";
  const space = await loadPublicSpace(key);
  const headers = { "Content-Type": "application/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300", Vary: "Referer" };
  if (!space) return new Response(EMBED_NOT_AVAILABLE, { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
  // Best effort: a page that is not on the allowed list gets no button at all,
  // instead of a button whose panel the browser would block. (The real
  // enforcement is frame-ancestors on the widget page.)
  const referer = request.headers.get("referer");
  if (referer) {
    let origin = "";
    try {
      origin = new URL(referer).origin;
    } catch {
      /* ignore */
    }
    if (origin && origin !== new URL(request.url).origin && !space.allowedOrigins.includes(origin)) {
      return new Response(EMBED_NOT_AVAILABLE, { status: 200, headers });
    }
  }
  return new Response(embedScript(space.key, publicOrigin(request), space.brandColor), { headers });
}
