# aisum.org

Evergreen home of **AISUM**, the AI Safety Unconference, Melbourne. Run by [AI Safety Australia & New Zealand](https://www.aisafetyanz.com.au/) as a satellite event of EAGxAustralasia.

Static HTML with no build step, plus one small Worker endpoint for the application form. Styling and structure inherited from [aisum25](https://github.com/mjkerrison/aisum25) (the 2025 edition, still live at aisum25.com).

- `public/` - everything served as a static file
  - `index.html` - landing page
  - `apply.html`, `apply.css`, `apply.js` - the application form, served at https://apply.aisum.org/
  - `faqs.html` - evergreen FAQs (`/faqs`)
  - `privacy.html` - privacy statement
  - `thanks.html` - post-subscribe landing page; set https://aisum.org/thanks as the Mailchimp "confirmation thank you page" URL (the Worker serves clean URLs and 307s the `.html` form)
  - `aisum26.ics` - all-day save-the-date event served by the hero "Add to Apple / Outlook" button (Google gets a render?action=TEMPLATE link)
  - `styles.css`, `favicon.svg` - carried over from aisum25
  - `_redirects` - `/2025` -> aisum25.com
- `src/worker.js` - handles `POST /api/apply` and the apply-subdomain routing; every other request falls through to `public/`
- `wrangler.jsonc` - Worker config (name, entry point, assets directory)
- `dev/` - local dev server and Worker tests (no dependencies, Node 22+)
- `social/` - source for the social cards; not served (see "Social cards" below)

## Application form

The form is a two-step page at https://apply.aisum.org/ (see "Apply subdomain" below). An engagement answer of 1 shows a "not the best fit right now" message instead of step 2, and nothing is submitted for those visitors. Otherwise the form posts JSON to `/api/apply`, where the Worker re-validates every field, verifies the Cloudflare Turnstile token, and creates a row in the Airtable applications table. The column mapping lives at the top of `src/worker.js`.

Two secrets are set on the Worker in the Cloudflare dashboard (Settings -> Variables and Secrets), never in this repo:

- `AIRTABLE_TOKEN` - Airtable personal access token with `data.records:write` on the base
- `TURNSTILE_SECRET` - secret key of the Turnstile widget; its public site key is the `data-turnstile-sitekey` attribute in `apply.html`

Local development:

```
node dev/serve.mjs            # http://localhost:3000, serves public/ and runs the Worker
node --test dev/worker.test.mjs
```

Without a `.dev.vars` file the dev server logs Airtable writes instead of sending them and uses Cloudflare's always-pass Turnstile test secret (pair it with the test site key `1x00000000000000000000AA`). Put `AIRTABLE_TOKEN=...` in `.dev.vars` (gitignored) to write real rows.

## Apply subdomain

The application form lives at **apply.aisum.org** so that it keeps working if aisum.org itself is ever pointed at a different app. Both hostnames are custom domains on the same Worker, and `src/worker.js` routes by hostname:

- `apply.aisum.org/` serves `apply.html`; `/faqs` and `/privacy` work there too, so the form doesn't depend on aisum.org.
- `aisum.org/apply` (the form's first address) redirects to `apply.aisum.org/`.
- Any other host (workers.dev, local dev) serves the form at `/apply` in place.

`/` and `/apply` are listed under `run_worker_first` in `wrangler.jsonc`, because the assets layer would otherwise answer them before the Worker could look at the hostname. `dev/serve.mjs` mirrors that list; open `http://apply.localhost:3000` to see the subdomain behaviour locally. The Turnstile widget needs no change: a widget registered for aisum.org covers its subdomains.

## Social cards

`social/cards.html` is the single source for the share images: two designs (`announce` with the event details, `theme` with the "what do we do now?" question) in three formats (landscape 1200x630, square 1080x1080, story 1080x1920). `node social/render.mjs` screenshots every combination into `social/out/` (gitignored) with headless Chrome, and refreshes `public/og.png`, the link-preview image referenced by the `og:image` tags on the home and apply pages. To change a date or a line of copy, edit `cards.html` and re-run the script.

## Mailing list

The hero subscribe form posts straight to the AISANZ Mailchimp audience (no Mailchimp JS) and applies the `AISUM26 EOI` tag via the hidden `tags` field. Honeypot field retained. The general AISANZ signup form on aisafetyanz.com.au applies `AISANZ general`; newsletter sends go to that tag, AISUM26 sends to this one.

## Hosting

Cloudflare **Worker with static assets** (not a Pages project - the 2026 dashboard creates Workers by default), connected to this repo via Workers Builds, which runs `npx wrangler deploy` against `wrangler.jsonc`. A push to `main` redeploys aisum.org in ~30s.
