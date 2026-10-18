import { loadPublicSpace } from "@/lib/support/public-store";
import { aiAvailable } from "@/lib/support/ai";
import { renderWidget } from "@/lib/support/widget-html";
import { notFoundPage } from "@/lib/support/page-shell";

// PUBLIC page: the support widget, shown in an iframe on the owner's site.
export async function GET(_req: Request, { params }: { params: { key: string } }) {
  const space = await loadPublicSpace(params.key);
  if (!space) {
    const nf = notFoundPage("Support is not available here.");
    return new Response(nf.html, { status: 404, headers: nf.headers });
  }
  const { html, headers } = renderWidget(space, { aiAvailable: aiAvailable({ aiEnabled: space.aiEnabled }, space.notes.length), page: false });
  return new Response(html, { headers });
}
