/** @portOnly Explicit URL-only A/B experiment; ordinary gameplay remains inline. */
export function parseFrameExperiment(search: string) {
  const query = new URLSearchParams(search);
  const value = query.get('questFrameTest');
  return { schedule: value === 'after-render' ? 'after-render' as const : 'inline' as const,
    trace: value === 'after-render' || value === 'inline',
    requestedHz: query.get('questHz') === '72' ? 72 : 90 };
}
export const questFrameExperiment = parseFrameExperiment(typeof location === 'undefined' ? '' : location.search);
