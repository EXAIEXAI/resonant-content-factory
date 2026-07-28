// Формула резонанса — взвешенная сумма 5 факторов
export const SCORE_WEIGHTS = {
  views: 0.15,
  reach: 0.25,
  engagement: 0.25,
  velocity: 0.2,
  recency: 0.15,
} as const;

export const FACTOR_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  views: "Просмотры",
  reach: "Относительный охват",
  engagement: "Реакции и глубина",
  velocity: "Скорость прироста",
  recency: "Свежесть",
};

export const FACTOR_DESCRIPTIONS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  views: "Абсолютное количество просмотров (лог-нормализация)",
  reach: "Просмотры / подписчики канала",
  engagement: "(Лайки + комментарии×2) / просмотры",
  velocity: "Темп набора просмотров с момента публикации",
  recency: "Понижающий коэффициент для старых материалов (30 дней)",
};

export type ScoreFactor = {
  key: keyof typeof SCORE_WEIGHTS;
  label: string;
  description: string;
  weight: number;
  raw: number;
  normalized: number;
  contribution: number;
};

export function computeScore(m: {
  views?: number | null;
  reactions?: number | null;
  comments_count?: number | null;
  subscribers?: number | null;
  published_at?: string | null;
}, weights: typeof SCORE_WEIGHTS = SCORE_WEIGHTS) {
  const views = m.views ?? 0;
  const reactions = m.reactions ?? 0;
  const comments = m.comments_count ?? 0;
  const subs = Math.max(m.subscribers ?? 1000, 100);

  const ageHours = m.published_at
    ? Math.max(1, (Date.now() - new Date(m.published_at).getTime()) / 3.6e6)
    : 720;

  // Нормализация в диапазон ~[0..1]
  const sViews = Math.min(Math.log10(views + 1) / 7, 1);              // 10^7 просмотров ≈ 1
  const sReach = Math.min(views / subs / 2, 1);                       // 2× подписчиков ≈ 1
  const sEngagement = Math.min(((reactions + comments * 2) / Math.max(views, 1)) * 20, 1);
  const sVelocity = Math.min(Math.log10(views / ageHours + 1) / 4, 1); // 10k просм/час ≈ 1
  const sRecency = Math.max(0, 1 - ageHours / (24 * 30));             // 30 дней → 0

  const rawValues = {
    views,
    reach: Number((views / subs).toFixed(3)),
    engagement: Number(((reactions + comments * 2) / Math.max(views, 1)).toFixed(4)),
    velocity: Number((views / ageHours).toFixed(2)),
    recency: Number((ageHours / 24).toFixed(1)), // возраст в днях
  };

  const normalized = { views: sViews, reach: sReach, engagement: sEngagement, velocity: sVelocity, recency: sRecency };

  const factors: ScoreFactor[] = (Object.keys(weights) as Array<keyof typeof weights>).map(k => ({
    key: k,
    label: FACTOR_LABELS[k],
    description: FACTOR_DESCRIPTIONS[k],
    weight: weights[k],
    raw: rawValues[k],
    normalized: Number(normalized[k].toFixed(3)),
    contribution: Number((weights[k] * normalized[k]).toFixed(3)),
  }));

  const score = Number(factors.reduce((s, f) => s + f.contribution, 0).toFixed(3));

  return {
    score,
    factors,
    // сохраняем совместимость со старым UI
    breakdown: {
      views: Number(sViews.toFixed(2)),
      reach: Number(sReach.toFixed(2)),
      engagement: Number(sEngagement.toFixed(2)),
      velocity: Number(sVelocity.toFixed(2)),
      recency: Number(sRecency.toFixed(2)),
    },
  };
}

export function pickTopParetoPerChannel<T extends { channel_id: string | null; engagement_score?: number | null }>(
  items: T[],
  minPerChannel = 3,
): T[] {
  const byChannel = new Map<string, T[]>();
  for (const it of items) {
    const k = it.channel_id ?? "__none__";
    if (!byChannel.has(k)) byChannel.set(k, []);
    byChannel.get(k)!.push(it);
  }
  const result: T[] = [];
  for (const arr of byChannel.values()) {
    arr.sort((a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0));
    const paretoCount = Math.max(minPerChannel, Math.ceil(arr.length * 0.2));
    result.push(...arr.slice(0, paretoCount));
  }
  return result.sort((a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0));
}
