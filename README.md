# aisum.org

Evergreen home of **AISUM**, the AI Safety Unconference, Melbourne. Run by [AI Safety Australia & New Zealand](https://www.aisafetyanz.com.au/) as a satellite event of EAGxAustralasia.

Static HTML, no build step. Styling and structure inherited from [aisum25](https://github.com/mjkerrison/aisum25) (the 2025 edition, still live at aisum25.com).

- `index.html` - landing page (currently a save-the-date placeholder for AISUM26)
- `styles.css`, `favicon.svg` - carried over from aisum25
- `aisum26.ics` - all-day save-the-date event served by the hero "Add to Apple / Outlook" button (Google gets a render?action=TEMPLATE link)
- `_redirects` - `/2025` -> aisum25.com

## Hosting

Cloudflare **Worker with static assets** (not a Pages project - the 2026 dashboard creates Workers by default), connected to this repo via Workers Builds. A push to `main` redeploys aisum.org in ~30s; `_redirects` and `.ics` content-type both verified working there.
