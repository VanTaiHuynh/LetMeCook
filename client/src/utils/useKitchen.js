import { createContext, useContext, useEffect, useState } from "react";
import { kitchenRequest } from "./kitchenApi";

export const KitchenContext = createContext(null);
export const useKitchen = () => useContext(KitchenContext);

export function useKitchenResource(path) {
  const { householdId, revision } = useKitchen();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) { setData(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    kitchenRequest(path, { householdId, signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, householdId, revision, retry]);
  return { data, error, loading, reload: () => setRetry(value => value + 1) };
}
