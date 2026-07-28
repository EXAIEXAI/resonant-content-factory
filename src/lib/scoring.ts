// Формула резонанса
export function computeScore(m: {
  views?: number | null;
  reactions?: number | null;
  comments_count?: number | null;
  subscribers?: number | null;
  published_at?: string | null;
}, weights = { reach: 0.3, depth: 0.3, velocity: 0.2, age: 0.2 }) {
  const views = m.views ?? 0;
  const reactions = m.reactions ?? 0;
  const comments = m.comments_count ?? 0;
  const subs = Math.max(m.subscribers ?? 1000, 100);
  const reach = Math.min(views / subs, 5);
  const depth = (reactions + comments * 2) / Math.max(views, 1);
  const ageHours = m.published_at
    ? (Date.now() - new Date(m.published_at).getTime()) / 3.6e6
    : 720;
  const velocity = views / Math.max(ageHours, 1);
  const ageFactor = Math.max(0, 1 - ageHours / (24 * 30));
  const normVelocity = Math.min(velocity / 100, 5);
  const score =
    weights.reach * reach +
    weights.depth * depth * 10 +
    weights.velocity * normVelocity +
    weights.age * ageFactor * 3;
  return {
    score: Number(score.toFixed(3)),
    breakdown: {
      reach: Number(reach.toFixed(2)),
      depth: Number((depth * 10).toFixed(2)),
      velocity: Number(normVelocity.toFixed(2)),
      age: Number((ageFactor * 3).toFixed(2)),
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
