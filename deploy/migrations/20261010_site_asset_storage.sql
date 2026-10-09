-- Public branding/marketing images are separate from private recipe uploads.
-- Browser writes remain restricted to existing account-owned image buckets.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('site-assets','site-assets',true,10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/x-icon','image/vnd.microsoft.icon'])
ON CONFLICT (id) DO NOTHING;
