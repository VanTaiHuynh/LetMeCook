import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { publicStorageUrl, supabase, supabaseUrl } from '../utils/supabaseClient';
import { storedRecipeImagePath } from '../utils/recipeImage';

const cache = new Map();

export default function RecipeImage({ src, alt = '', onError, ...props }) {
  const { user, loading: accountLoading } = useAuth();
  const source = publicStorageUrl(src);
  const path = storedRecipeImagePath(source, supabaseUrl, location.origin);
  const identity = path ? `${user?.id || 'guest'}|${path}` : `source|${source || ''}`;
  const [image, setImage] = useState({ identity: '', resolved: '', failed: false });

  useEffect(() => {
    let active = true;
    let timer;
    if (!path) {
      setImage({ identity, resolved: source || '', failed: !source });
      return;
    }
    setImage({ identity, resolved: '', failed: false });
    if (accountLoading) return;

    async function load() {
      let record = cache.get(identity);
      try {
        if (!record || record.expires < Date.now()) {
          const promise = supabase.storage.from('recipe-images').createSignedUrl(path, 300);
          record = { promise, expires: Date.now() + 240000 };
          cache.set(identity, record);
          if (cache.size > 1000) cache.delete(cache.keys().next().value);
        }
        const { data, error } = await record.promise;
        if (error || !data?.signedUrl) throw error || new Error('Image unavailable');
        if (!active) return;
        setImage({ identity, resolved: data.signedUrl, failed: false });
        timer = setTimeout(load, 240000);
      } catch {
        if (cache.get(identity) === record) cache.delete(identity);
        if (active) setImage({ identity, resolved: '', failed: true });
      }
    }
    load();
    return () => { active = false; clearTimeout(timer); };
  }, [path, source, identity, accountLoading]);

  // An old account's signed URL must not appear while the next effect is pending.
  const current = image.identity === identity ? image : { resolved: path ? '' : source || '', failed: !source };
  if (!current.resolved) return <span className={`product-image-status ${props.className || ''}`} role="status" aria-label={alt ? `${alt}: ${current.failed ? 'image unavailable' : 'loading image'}` : undefined}>{current.failed ? 'Image unavailable' : 'Loading image…'}</span>;
  return <img {...props} key={identity} src={current.resolved} alt={alt} onError={event => {
    setImage({ identity, resolved: '', failed: true });
    onError?.(event);
  }}/>;
}
