import { useEffect, useState } from 'react';
import { recipeTagOptions } from '../../utils/catalogApi';
import useIngredientLookup from '../../utils/useIngredientLookup';

export function useRecipeTags() {
  const [state, setState] = useState({ dietary: [], cuisines: [], categories: [], loading: true, error: '' });
  const [revision, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setState(value => ({ ...value, loading: true, error: '' }));
    recipeTagOptions(controller.signal).then(value => { if (!controller.signal.aborted) setState({ ...value, loading: false, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setState(value => ({ ...value, loading: false, error: error.message })); });
    return () => controller.abort();
  }, [revision]);
  return { ...state, retry: () => retry(value => value + 1) };
}

export function useIngredientSuggestions(input) { return useIngredientLookup(input).items; }
