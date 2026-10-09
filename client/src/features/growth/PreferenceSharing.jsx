import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import { useKitchen, useKitchenResource } from '../../utils/useKitchen';

export default function PreferenceSharing() {
  const { householdId, mutate, busy, setNotice } = useKitchen();
  const resource = useKitchenResource(householdId ? `/households/${householdId}/preference-sharing` : null);
  const [consent, setConsent] = useState(null);
  useEffect(() => { setConsent(resource.data); }, [resource.data]);
  if (!householdId) return null;
  const save = async enabled => {
    const result = await mutate(enabled ? 'Share my preferences' : 'Revoke my preference sharing', `/households/${householdId}/preference-sharing`, { enabled, version: consent.version }, 'PUT', false);
    if (result) { setConsent(result); setNotice(enabled ? 'Your saved restrictions and tastes can be used when a household plan explicitly includes shared preferences.' : 'Sharing revoked. Future household plans will exclude your preferences.'); }
  };
  return <section className="kitchen-panel"><details className="kitchen-disclosure"><summary>My preference sharing</summary>
    <p>Choose whether this household can use your saved food restrictions and tastes in its plans.</p>
    {resource.loading && !consent ? <p role="status">Loading your choice…</p> : resource.error ? <div className="kitchen-error"><p>{resource.error}</p><Button className="kitchen-secondary" onClick={resource.reload}>Retry sharing</Button></div> : consent && <>
      <p className="kitchen-help">{consent.enabled ? 'Your sharing is enabled.' : 'Sharing is off.'} You control only your own choice.</p>
      <Button className={consent.enabled ? 'kitchen-secondary' : 'kitchen-primary'} disabled={!!busy} onClick={() => save(!consent.enabled)}>{consent.enabled ? 'Revoke my sharing' : 'Share my preferences'}</Button>
      <Link className="kitchen-text-link" to="/edit-profile">Review my saved restrictions</Link>
    </>}
  </details></section>;
}
