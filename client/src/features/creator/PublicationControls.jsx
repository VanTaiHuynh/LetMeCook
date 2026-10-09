import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Field from '../../components/ui/Field';
import { useKitchen, useKitchenResource } from '../../utils/useKitchen';

export default function PublicationControls() {
  const { mutate, busy, isOwner, setNotice } = useKitchen();
  const resource = useKitchenResource(isOwner ? '/workspace/publication' : null);
  const [publication, setPublication] = useState(null); const [slug, setSlug] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => { if (resource.data) { setPublication(resource.data); setSlug(resource.data.slug || ''); setAcknowledged(false); } }, [resource.data]);
  if (!isOwner) return null;
  const save = async published => {
    const response = await mutate(published ? 'Publish collection' : 'Unpublish collection', '/workspace/publication', { slug, published, version: publication.version, publishingAcknowledged: published && acknowledged }, 'PUT', false);
    if (response) { setPublication(response); setAcknowledged(false); setNotice(published ? 'Collection published to its local URL.' : 'Your collection is unpublished.'); }
  };
  return <details className="kitchen-disclosure kitchen-disclosure-secondary"><summary>Public collection</summary>
    {resource.loading && !publication ? <p role="status">Loading publication controls…</p> : resource.error ? <div className="kitchen-error"><p>{resource.error}</p><Button className="kitchen-secondary" onClick={resource.reload}>Retry publication</Button></div> : publication && <>
      {!publication.featureEnabled && <p className="kitchen-help">Public collections are currently unavailable.</p>}
      {publication.published && publication.slug && <p><Link className="kitchen-text-link" to={`/collections/${encodeURIComponent(publication.slug)}`}>Open public collection</Link></p>}
      {publication.featureEnabled && <><Field>Collection address<input value={slug} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" disabled={!!busy} onChange={event => { setSlug(event.target.value); setAcknowledged(false); }} placeholder="my-kitchen" /></Field>
        <p className="kitchen-help">{publication.eligibleRecipeCount} eligible recipes; {publication.omittedRecipeCount} omitted.</p>
        {!publication.published && <Field className="kitchen-checkbox"><input type="checkbox" checked={acknowledged} disabled={!!busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I checked the recipe and original photo permissions for this public collection.</span></Field>}
      </>}
      <div className="kitchen-actions">{publication.published ? <Button className="kitchen-secondary" disabled={!!busy} onClick={() => save(false)}>Unpublish collection</Button> : publication.featureEnabled && <Button className="kitchen-primary" disabled={!!busy || !acknowledged || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !publication.eligibleRecipeCount} onClick={() => save(true)}>Publish collection</Button>}</div>
    </>}
  </details>;
}
