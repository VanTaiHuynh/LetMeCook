import { useCallback, useMemo, useState } from 'react';
import { sourceFlowTiming } from './cookingTiming';

/** Source timings stay automatic; a cook's edits replace only the selected step. */
export default function useRecipeStepTiming(identity, steps = []) {
  const sourceKey = JSON.stringify(steps);
  const key = `${identity}:${sourceKey}`;
  const sources = useMemo(() => JSON.parse(sourceKey).map(sourceFlowTiming), [sourceKey]);
  const [edits, setEdits] = useState({ key: '', values: {} });
  const values = edits.key === key ? edits.values : {};
  const overridden = sources.map((_, index) => Object.hasOwn(values, index));
  const durations = sources.map((source, index) => overridden[index] ? values[index] : source.seconds ?? 0);
  const change = useCallback((index, seconds) => {
    if (!Number.isInteger(index) || index < 0 || index >= sources.length) return;
    setEdits(current => ({ key, values: { ...(current.key === key ? current.values : {}), [index]: seconds } }));
  }, [key, sources.length]);
  const reset = useCallback(index => {
    setEdits(current => {
      if (current.key !== key) return { key, values: {} };
      const next = { ...current.values }; delete next[index];
      return { key, values: next };
    });
  }, [key]);
  return { sources, durations, overridden, change, reset };
}
