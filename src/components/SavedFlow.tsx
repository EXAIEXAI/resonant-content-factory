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
import { ArrowLeft, Download, ExternalLink, FileText, Mic, MicOff, Loader2 } from "lucide-react";
import {
  ensureMaterialSummary,
  generateMaterialEssay,
  generateMaterialScript,
  saveMaterialTranscript,
} from "@/lib/quickflow.functions";
import { downloadTextAsDocx } from "@/lib/docx-download";
import { getOriginalUrl } from "@/components/MaterialCard";

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
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
  const recRef = useRef<{ stream: MediaStream; recorder: MediaRecorder; chunks: Blob[] } | null>(
    null,
  );
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec) {
        try {
          if (rec.recorder.state !== "inactive") rec.recorder.stop();
        } catch {
          /* ignore */
        }
        rec.stream.getTracks().forEach(t => t.stop());
        recRef.current = null;
      }
    },
    [],
  );

  const transcribe = async (blob: Blob, ext: string) => {
    if (blob.size < 2048) {
      toast.error("Запись пустая — попробуйте ещё раз");
      return;
    }
    setWorking(true);
    try {
      const mime = blob.type && blob.type.startsWith("audio/") ? blob.type : "audio/webm";
      const form = new FormData();
      form.append("file", new File([blob], `recording.${ext}`, { type: mime }));
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error || "Не удалось распознать речь");
        return;
      }
      const text = (data.text ?? "").trim();
      if (!text) {
        toast.error("Речь не распознана — говорите чуть громче и ближе к микрофону");
        return;
      }
      const next = (valueRef.current ? valueRef.current.trim() + " " : "") + text;
      valueRef.current = next;
      onChange(next);
      toast.success("Текст распознан");
    } catch {
      toast.error("Не удалось распознать речь");
    } finally {
      setWorking(false);
    }
  };

  const start = async () => {
    if (typeof MediaRecorder === "undefined") {
      toast.error("Браузер не поддерживает запись звука");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const type = (mimeType || "audio/webm").split(";")[0];
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        void transcribe(new Blob(chunks, { type }), ext);
      };
      recorder.onerror = () => toast.error("Ошибка записи звука");
      recorder.start(1000);
      recRef.current = { stream, recorder, chunks };
      setListening(true);
    } catch {
      toast.error("Нет доступа к микрофону — разрешите запись в браузере");
    }
  };

  const stop = () => {
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    if (!rec) return;
    try {
      if (rec.recorder.state !== "inactive") rec.recorder.stop();
      else rec.stream.getTracks().forEach(t => t.stop());
    } catch {
      rec.stream.getTracks().forEach(t => t.stop());
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
          onClick={() => (listening ? stop() : void start())}
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

function TranscriptCard({
  id,
  transcript,
  onSaved,
}: {
  id: string;
  transcript: string;
  onSaved: () => void;
}) {
  const save = useServerFn(saveMaterialTranscript);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const has = transcript.trim().length > 50;

  const mut = useMutation({
    mutationFn: async () => (await save({ data: { materialId: id, text } } as any)) as any,
    onSuccess: (r: any) => {
      setOpen(false);
      setText("");
      if (r?.error) toast.error(`Расшифровка сохранена, но разбор не удался: ${r.error}`);
      else toast.success("Расшифровка сохранена, разбор пересобран");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFile = async (file: File) => {
    const content = await file.text();
    setText(content);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="font-serif text-xl">Расшифровка ролика</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(o => !o)}>
          <FileText className="w-4 h-4 mr-2" />
          {open ? "Свернуть" : has ? "Заменить расшифровку" : "Вставить расшифровку"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {has ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Расшифровка загружена ({transcript.trim().length.toLocaleString("ru-RU")} символов) — показать текст
            </summary>
            <div className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {transcript}
            </div>
          </details>
        ) : (
          <p className="text-sm text-muted-foreground">
            YouTube не отдаёт субтитры этого ролика роботам, поэтому описание строится только по названию.
            Откройте ролик на YouTube → «Ещё» → «Показать расшифровку видео», скопируйте текст и вставьте
            его сюда — описание и мысли будут по реальным словам автора.
          </p>
        )}

        {open && (
          <div className="space-y-3">
            <Textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={8}
              placeholder="Вставьте текст расшифровки (таймкоды можно не убирать)…"
            />
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".txt,.srt,.vtt,.md"
                className="text-sm"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <Button
                size="sm"
                disabled={mut.isPending || text.trim().length < 50}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Сохраняю и разбираю…
                  </>
                ) : (
                  "Сохранить и пересобрать разбор"
                )}
              </Button>
            </div>
          </div>
        )}
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

  const { data: material, refetch: refetchMaterial } = useQuery({
    queryKey: ["saved-material", id],
    queryFn: async () =>
      (await supabase.from("raw_materials").select("*").eq("id", id).maybeSingle()).data,
  });

  const [forceKey, setForceKey] = useState(0);
  const {
    data: analysis,
    isFetching: analyzing,
    refetch: refetchAnalysis,
  } = useQuery({
    queryKey: ["saved-material-summary", id, forceKey],
    queryFn: async () =>
      (await ensure({ data: { materialId: id, force: forceKey > 0 } } as any)) as any,
    staleTime: Infinity,
    retry: 1,
  });

  const retryAnalysis = () => {
    setForceKey(k => k + 1);
    void refetchAnalysis();
  };

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
          {analyzing ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Готовлю краткое описание...
            </div>
          ) : (
            <>
              {analysis?.summary ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis.summary}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {analysis?.error
                      ? `Описание пока не готово: ${analysis.error}`
                      : "Описание пока не готово."}
                  </p>
                  <Button size="sm" variant="outline" onClick={retryAnalysis}>
                    Сформировать описание заново
                  </Button>
                </div>
              )}
              {keyPoints.length > 0 && (
                <div className="space-y-3">
                  <div className="text-sm font-medium">Основные мысли автора</div>
                  <ul className="space-y-3">
                    {keyPoints.map((p: any, i: number) => (
                      <li key={i} className="text-sm flex gap-2 leading-relaxed">
                        <Badge variant="secondary" className="shrink-0">{i + 1}</Badge>
                        <span className="whitespace-pre-wrap">
                          {p?.thesis ?? String(p)}
                          {p?.quote ? <span className="text-muted-foreground"> — «{p.quote}»</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" variant="ghost" onClick={retryAnalysis}>
                    Пересобрать описание
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <TranscriptCard
        id={id}
        transcript={String((material as any)?.raw_transcript ?? "")}
        onSaved={() => {
          void refetchMaterial();
          retryAnalysis();
        }}
      />

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
