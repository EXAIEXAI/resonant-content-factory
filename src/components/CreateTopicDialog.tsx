import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { createTopic } from "@/lib/topics.functions";

export function CreateTopicDialog({ triggerClassName }: { triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const navigate = useNavigate();
  const create = useServerFn(createTopic);

  const mutation = useMutation({
    mutationFn: () => create({ data: { title } }),
    onSuccess: (row) => {
      toast.success("Тема создана — подберите ролики");
      setOpen(false);
      setTitle("");
      navigate({ to: "/topics/$id", params: { id: row.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={triggerClassName}>
          <Lightbulb className="w-4 h-4 mr-2" /> Создать тему ролика
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-serif">Новая тема ролика</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Интересующая тема</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Например: управление продажами в кризис"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && title.trim().length >= 3) mutation.mutate(); }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Контент-завод предложит подходящие ролики, затем — 10 уточняющих тем на выбор.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={title.trim().length < 3 || mutation.isPending}>
            {mutation.isPending ? "Создаю..." : "Продолжить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
