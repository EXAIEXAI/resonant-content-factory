import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

const SHARED_EMAIL = "juliavvrn@gmail.com";

/**
 * Возвращает сессию общего рабочего аккаунта, чтобы завод открывался по ссылке
 * без ввода логина и пароля. Пароль не используется: ссылка-токен выпускается
 * серверным ключом и сразу обменивается на сессию.
 */
export const getSharedSession = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: SHARED_EMAIL,
  });
  if (linkError || !link?.properties?.hashed_token) {
    throw new Error(linkError?.message ?? "Не удалось открыть общий доступ");
  }

  const anon = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (error || !data.session) {
    throw new Error(error?.message ?? "Не удалось открыть общий доступ");
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
});
