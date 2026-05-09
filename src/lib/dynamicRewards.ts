const BPS = 10_000n;

export type PendingDynamicRewardSource = {
  source: string;
  day: bigint;
  generation: number;
  volume: bigint;
  settled: boolean;
};

export type PendingDynamicRewardRate = {
  generation: number;
  rateBps: bigint;
};

export type PendingDynamicRewardEligibility = {
  day: bigint;
  eligibleGeneration: number;
};

export type PendingDynamicRewardRow = PendingDynamicRewardSource & {
  rateBps: bigint;
  reward: bigint;
};

export function calculatePendingDynamicRewardRows(
  sources: readonly PendingDynamicRewardSource[],
  rates: readonly PendingDynamicRewardRate[],
  eligibility: readonly PendingDynamicRewardEligibility[],
): PendingDynamicRewardRow[] {
  const rateByGeneration = new Map(rates.map((rate) => [rate.generation, rate.rateBps]));
  const eligibleByDay = new Map(eligibility.map((row) => [row.day.toString(), row.eligibleGeneration]));

  return sources.flatMap((source) => {
    if (source.settled || source.volume <= 0n) return [];

    const eligibleGeneration = eligibleByDay.get(source.day.toString()) ?? 0;
    if (eligibleGeneration < source.generation) return [];

    const rateBps = rateByGeneration.get(source.generation) ?? 0n;
    const reward = (source.volume * rateBps) / BPS;
    if (reward <= 0n) return [];

    return [{ ...source, rateBps, reward }];
  });
}

export function sumPendingDynamicRewards(rows: readonly Pick<PendingDynamicRewardRow, 'reward'>[]) {
  return rows.reduce((sum, row) => sum + row.reward, 0n);
}
