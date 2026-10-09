Recipe ingestion source

These are the source scripts used to collect and verify the local recipe
library. Existing imported records and original photos remain in the local
database/Storage backup; they are not included in this source repository.

scrape_jsonld.py       Public recipe JSON-LD and original image references.
scrape_wikibooks.py    Recipe/ingredient parsing and Wikibooks collection.
localize_images.py    Downloads original recipe photographs to local files.
verify_dataset.py     Checks the collected records and downloaded originals.

Run each script with --help to review its arguments before starting an import.
Keep output datasets and original images in operator-managed data locations,
such as deploy/data/ and client/public/recipe-images/, which are gitignored.
The application importer is deploy/import-recipes.py; original images are
verified/migrated into Supabase by deploy/migrate-images-to-storage.py.
Source/provenance fields are retained by the ingestion pipeline.
