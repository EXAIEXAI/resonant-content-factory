// Google OAuth callback: обменивает code на токены и сохраняет подключение конкретного сервиса.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        const err = url.searchParams.get("error");

        const back = (q: string) => Response.redirect(`${origin}/integrations?${q}`, 302);
        if (err) return back(`google=error&message=${encodeURIComponent(err)}`);
        if (!code) return back("google=error&message=no_code");

        const { verifyState, exchangeCode, fetchGoogleEmail, saveConnection } = await import("@/lib/google.server");
        const parsed = await verifyState(state);
        if (!parsed) return back("google=error&message=bad_state");

        try {
          const tokens = await exchangeCode(code, origin);
          if (!tokens.refresh_token) {
            return back(`google=error&provider=${parsed.provider}&message=no_refresh_token`);
          }
          const email = await fetchGoogleEmail(tokens.access_token);
          await saveConnection({
            userId: parsed.userId,
            provider: parsed.provider,
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            expiresIn: tokens.expires_in,
            email,
            scopes: tokens.scope ?? null,
          });
          return back(`google=connected&provider=${parsed.provider}`);
        } catch (e) {
          return back(
            `google=error&provider=${parsed.provider}&message=${encodeURIComponent(
              e instanceof Error ? e.message : String(e),
            )}`,
          );
        }
      },
    },
  },
});
