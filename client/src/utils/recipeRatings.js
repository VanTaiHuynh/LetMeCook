const CATEGORIES = ['cost', 'time', 'difficulty', 'overall'];

export function normalizeRatingSummary(summary) {
  const result = { cost: null, time: null, difficulty: null, overall: null, overallCount: 0 };
  if (!summary || typeof summary !== 'object') return result;
  for (const category of CATEGORIES) {
    const value = summary[category];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5)
      result[category] = value;
  }
  if (Number.isInteger(summary.overallCount) && summary.overallCount >= 0)
    result.overallCount = summary.overallCount;
  if (!result.overallCount) result.overall = null;
  return result;
}

export function aggregateRecipeRatings(rows = []) {
  const result = {};
  for (const category of CATEGORIES) {
    const values = rows.filter(row => row.category === category && row.value != null && row.value !== '')
      .map(row => Number(row.value)).filter(value => Number.isFinite(value) && value >= 1 && value <= 5);
    result[category] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    if (category === 'overall') result.overallCount = values.length;
  }
  return result;
}

export function ratingStars(average) {
  if (!Number.isFinite(average) || average < 1 || average > 5) return '';
  const filled = Math.round(average);
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}
