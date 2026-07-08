import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Protege tudo, exceto:
     * - api/telegram e api/cron (autenticacao propria por secret)
     * - _next e assets estaticos
     */
    "/((?!api/telegram|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
