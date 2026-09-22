import { createFileRoute } from "@tanstack/react-router";
import { SavedFlow } from "@/components/SavedFlow";

export const Route = createFileRoute("/_authenticated/briefing/$id")({
  head: () => ({
    meta: [
      { title: "Разбор сохранённого ролика · Контент-завод" },
      { name: "description", content: "Краткое описание ролика, эссе и сценарий по сохранённому видео." },
      { property: "og:title", content: "Разбор сохранённого ролика · Контент-завод" },
      { property: "og:description", content: "Краткое описание ролика, эссе и сценарий по сохранённому видео." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BriefingFlowPage,
});

function BriefingFlowPage() {
  const { id } = Route.useParams();
  return <SavedFlow id={id} backTo="/briefing" />;
}
