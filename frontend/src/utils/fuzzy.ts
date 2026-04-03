const levenshtein = (a: string, b: string): number => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

export const findClosestMatch = (query: string, names: string[]): string | null => {
  const q = query.toLowerCase().trim();
  if (!q || names.length === 0) return null;
  const threshold = Math.max(2, Math.floor(q.length * 0.45));
  let best: string | null = null;
  let bestDist = Infinity;
  for (const name of names) {
    const candidates = [name.toLowerCase(), ...name.toLowerCase().split(/\s+/)];
    for (const candidate of candidates) {
      const dist = levenshtein(q, candidate);
      if (dist > 0 && dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = name;
      }
    }
  }
  return best;
};
