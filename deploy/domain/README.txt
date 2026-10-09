LetMeCook public origin

The published Cloudflare tunnel routes for letmecook.ca and www.letmecook.ca
currently target http://localhost:9401. The web gateway redirects www to the
main HTTPS domain and proxies the application API and browser auth routes.
The connector token stays in protected operator configuration, outside Git.

From the repository root, verify the running public application:
  python3 deploy/domain/verify-public-origin.py https://letmecook.ca --expect-demo any --check-auth --check-www

To check the local application:
  python3 deploy/domain/verify-public-origin.py http://127.0.0.1:9401 --expect-demo any --check-auth --check-www

The successful optional host-nginx origin installer is also retained here:
  sudo bash deploy/domain/connect-letmecook.sh
It applies only the existing dedicated LetMeCook nginx site on port 8092,
waits for new nginx workers, checks the app and public domain, and restores
the previous own-site configuration if verification fails. It expects the
five named connectors from this installation to exist and remain running.
It neither reads tokens nor configures/restarts a connector. Do not use it
as a generic new-server setup script; review its prerequisites first.

Deployment source is in deploy/compose.yaml and deploy/compose.public.yaml.
Keep real deploy/.env.local and deploy/.env.roles private. Existing catalog
data and local Supabase Storage are restored separately from source code.
