LetMeCook image storage

Recipe originals are stored in this server's local Supabase recipe-images bucket.
The bucket is private. Account uploads keep their account folder and signed URLs.
Imported original photos keep their existing /recipe-images/UUID.ext URL; nginx
checks recipe visibility and reads the corresponding object through Storage RLS
using only the anonymous browser key. No filesystem fallback is served.

Logo, Sunny, other branding images and favicon use the public site-assets bucket.
The web image does not bundle the old public image directory. Original source
files are retained for recovery and exact byte comparison.

Copy or verify originals, without printing credentials:
  python3 deploy/migrate-images-to-storage.py --apply

This operation is resumable. It never overwrites existing object bytes: each
existing or newly uploaded object must match its local original's SHA-256 hash.
It targets only Supabase local API 127.0.0.1:56421 and the letmecook database.
The operator credential remains in memory; the web container receives only the
public anonymous key. Source/permission metadata and recipe records are retained.

Normal deploy/local-up.sh runs this verification before building the web app.
deploy/backup-local.py includes both Storage object bytes and Storage DB metadata.
Keep that backup together with protected runtime configuration for recovery.
