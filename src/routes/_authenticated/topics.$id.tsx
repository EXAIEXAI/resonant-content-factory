import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { TopicFlow } from "@/components/TopicFlow";

export const Route = createFileRoute("/_authenticated/topics/$id")({
  head: () => ({
    meta: [
      { title: "Тема ролика · Контент-завод" },
      { name: "description", content: "Воронка темы: подбор роликов, выбор угла, эссе и сценарий." },
      { property: "og:title", content: "Тема ролика · Контент-завод" },
      { property: "og:description", content: "Воронка темы: подбор роликов, выбор угла, эссе и сценарий." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TopicPage,
});

function TopicPage() {
  const { id } = Route.useParams();
  return (
    <div className="space-y-6">
      <Link to="/topics" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> К темам
      </Link>
      <TopicFlow id={id} />
    </div>
  );
}
