# liquidations.city

The public storefront for the Surplus & Asset Liquidations Warehouse Outlet,
deployed by Cloudflare Workers Builds on every push to `main`.

- `site/` the public pages, prebuilt. Do not hand-edit; it is regenerated
  from the private site source with `build/package.py` and `build/workers_repo.py`.
- `worker.js` serves `site/` and runs the phone editor at `/admin`
  (photos and item edits saved in the D1 database bound as `DB`).
- `wrangler.json` Worker settings. The editor password is the
  `ADMIN_PASSWORD` secret in the Cloudflare dashboard.

Items added on a phone at /admin go straight to the database and do not
appear in this repo.
