import { useEffect, useState } from 'react';
import { plannerRequest } from '../../utils/plannerApi';
export default function usePlannerPreferences(userId, authLoading) {
  const [state, setState] = useState({ ownerId: null, data: null, error: '', loading: false });
  const [revision, retry] = useState(0);
  useEffect(() => {
    if (authLoading || !userId) { setState({ ownerId: null, data: null, error: '', loading: false }); return; }
    const controller = new AbortController(); setState({ ownerId: userId, data: null, error: '', loading: true });
    plannerRequest('/preferences', { signal: controller.signal, authenticated: true, actorId: userId }).then(data => {
      if (!controller.signal.aborted) setState({ ownerId: userId, data, error: '', loading: false });
    }).catch(error => { if (!controller.signal.aborted) setState({ ownerId: userId, data: null, error: error.message, loading: false }); });
    return () => controller.abort();
  }, [userId, authLoading, revision]);
  return { data: state.ownerId === userId ? state.data : null, error: state.ownerId === userId ? state.error : '', loading: !!userId && (state.ownerId !== userId || state.loading), retry: () => retry(value => value + 1) };
}
