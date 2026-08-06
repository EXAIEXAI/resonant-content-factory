import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const generateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ materialId: z.string().uuid(), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { generateReviewById } = await import("@/lib/review.server");
    const review = await generateReviewById(context.supabase as never, data.materialId, {
      force: data.force ?? false,
    });
    if (!review) throw new Error("Не удалось сформировать разбор");
    return { review };
  });
