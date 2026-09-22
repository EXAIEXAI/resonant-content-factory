import { Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Download, ExternalLink, Mic, MicOff, Loader2 } from "lucide-react";
import {
  ensureMaterialSummary,
  generateMaterialEssay,
  generateMaterialScript,
} from "@/lib/quickflow.functions";
import { downloadTextAsDocx } from "@/lib/docx-download";
import { getOriginalUrl } from "@/components/MaterialCard";

function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, sample * (sample < 0 ? 32768 : 32767), true);
      offset += 2;
    }
  return new Blob([bytes], { type: "audio/wav" });
}

function VoiceComment({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [listening, setListening] = useState(false);
  const [working, setWorking] = useState(false);
  const recRef = useRef<{
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    node: ScriptProcessorNode;
    chunks: Float32Array[];
  } | null>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec) {
        rec.stream.getTracks().forEach(t => t.stop());
        rec.node.disconnect();
        rec.source.disconnect();
        void rec.context.close();
        recRef.current = null;
      }
    },
    [],
  );

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const node = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(node);
      node.connect(context.destination);
      recRef.current = { stream, context, source, node, chunks };
      setListening(true);
    } catch {
      toast.error("Нет доступа к микрофону — разрешите запись в браузере");
    }
  };

  const stop = async () => {
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    if (!rec) return;
    rec.stream.getTracks().forEach(t => t.stop());
    rec.node.onaudioprocess = null;
    rec.node.disconnect();
    rec.source.disconnect();
    const blob = encodeWav(rec.chunks, rec.context.sampleRate);
    await rec.context.close();
    if (blob.size < 2048) {
      toast.error("Запись пустая — попробуйте ещё раз");
      return;
    }
    setWorking(true);
    try {
      const form = new FormData();
      form.append("file", new File([blob], "recording.wav", { type: "audio/wav" }));
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        toast.error(data.error || "Не удалось распознать речь");
        return;
      }
      const next = (valueRef.current ? valueRef.current.trim() + " " : "") + data.text;
      valueRef.current = next;
      onChange(next);
      toast.success("Текст распознан");
    } catch {
      toast.error("Не удалось распознать речь");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={5}
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => (listening ? void stop() : void start())}
        >
          {working ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : listening ? (
            <MicOff className="w-4 h-4 mr-2" />
          ) : (
            <Mic className="w-4 h-4 mr-2" />
          )}
          {working ? "Распознаю…" : listening ? "Остановить запись" : "Надиктовать голосом"}
        </Button>
        {listening && <span className="text-xs text-muted-foreground">Идёт запись…</span>}
      </div>
    </div>
  );
}


function TextBlock({ title, text, fileName }: { title: string; text: string; fileName: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="font-serif text-xl">{title}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => downloadTextAsDocx(title, text, fileName)}>
          <Download className="w-4 h-4 mr-2" /> Скачать Word
        </Button>
      </CardHeader>
      <CardContent>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
      </CardContent>
    </Card>
  );
}

type Stage = "summary" | "essay_comment" | "essay" | "script_comment" | "script";

export function SavedFlow({ id, backTo }: { id: string; backTo: string }) {
  const ensure = useServerFn(ensureMaterialSummary);
  const genEssay = useServerFn(generateMaterialEssay);
  const genScript = useServerFn(generateMaterialScript);

  const [stage, setStage] = useState<Stage>("summary");
  const [essayComment, setEssayComment] = useState("");
  const [scriptComment, setScriptComment] = useState("");
  const [essay, setEssay] = useState<{ id: string; text: string } | null>(null);
  const [script, setScript] = useState<string | null>(null);

  const { data: material } = useQuery({
    queryKey: ["saved-material", id],
    queryFn: async () =>
      (await supabase.from("raw_materials").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: analysis, isFetching: analyzing } = useQuery({
    queryKey: ["saved-material-summary", id],
    queryFn: async () => (await ensure({ data: { materialId: id } } as any)) as any,
    staleTime: Infinity,
  });

  const essayMut = useMutation({
    mutationFn: async () =>
      (await genEssay({ data: { materialId: id, comment: essayComment || null } } as any)) as any,
    onSuccess: (r: any) => {
      setEssay({ id: r.id, text: r.generated_text ?? "" });
      setStage("essay");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scriptMut = useMutation({
    mutationFn: async () =>
      (await genScript({
        data: { materialId: id, essayId: essay!.id, comment: scriptComment || null },
      } as any)) as any,
    onSuccess: (r: any) => {
      setScript(r.generated_text ?? "");
      setStage("script");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const originalUrl = material ? getOriginalUrl(material) : null;
  const keyPoints: any[] = Array.isArray(analysis?.key_points) ? analysis.key_points : [];

  return (
    <div className="space-y-6">
      <Link to={backTo as any} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4 mr-1" /> К сохранённым роликам
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl sm:text-3xl">{material?.title ?? "Загрузка..."}</h1>
          <p className="text-muted-foreground text-sm mt-1">{material?.channel_title}</p>
        </div>
        {originalUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={originalUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" /> Открыть оригинал
            </a>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-xl">О чём этот ролик</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {analyzing && !analysis ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Готовлю краткое описание...
            </div>
          ) : (
            <>
              <p className="text-sm leading-relaxed">{analysis?.summary || "Описание пока недоступно"}</p>
              {keyPoints.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Основные мысли автора</div>
                  <ul className="space-y-2">
                    {keyPoints.map((p: any, i: number) => (
                      <li key={i} className="text-sm flex gap-2">
                        <Badge variant="secondary" className="shrink-0">{i + 1}</Badge>
                        <span>
                          {p?.thesis ?? String(p)}
                          {p?.quote ? <span className="text-muted-foreground"> — «{p.quote}»</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {stage === "summary" && (
        <Card>
          <CardContent className="py-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="text-sm">Понравилось? Сформируем по этому ролику эссе.</div>
            <div className="flex gap-2">
              <Button onClick={() => setStage("essay_comment")}>Да, написать эссе</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "essay_comment" && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-xl">Ваш комментарий к ролику</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Комментарий учтётся вместе с промтом для эссе. Можно пропустить — тогда будет использован только промт.
            </p>
            <VoiceComment
              value={essayComment}
              onChange={setEssayComment}
              placeholder="Что важно подчеркнуть, с чем согласны или спорите..."
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => essayMut.mutate()} disabled={essayMut.isPending}>
                {essayMut.isPending ? "Пишу эссе..." : "Написать эссе"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {essay && (
        <TextBlock
          title="Эссе"
          text={essay.text}
          fileName={`Эссе — ${(material?.title ?? "ролик").slice(0, 60)}`}
        />
      )}

      {stage === "essay" && (
        <Card>
          <CardContent className="py-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="text-sm">Написать по этому эссе сценарий ролика?</div>
            <Button onClick={() => setStage("script_comment")}>Да, написать сценарий</Button>
          </CardContent>
        </Card>
      )}

      {stage === "script_comment" && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-xl">Комментарий к сценарию</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <VoiceComment
              value={scriptComment}
              onChange={setScriptComment}
              placeholder="Пожелания к сценарию: акценты, формат, длительность..."
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => scriptMut.mutate()} disabled={scriptMut.isPending}>
                {scriptMut.isPending ? "Пишу сценарий..." : "Написать сценарий"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {script && (
        <TextBlock
          title="Сценарий"
          text={script}
          fileName={`Сценарий — ${(material?.title ?? "ролик").slice(0, 60)}`}
        />
      )}
    </div>
  );
}
