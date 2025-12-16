# Bucknell Room Finder

Find open classrooms on Bucknell’s campus fast. This single-page app pulls live course meeting data, maps it to buildings/rooms, and paints a weekly schedule so you can spot free time slots at a glance.

## Live  on Vercel
- Live site: **https://bucknell-room-finder.vercel.app/**

## Quick Start
1. Install deps (only Vercel CLI analytics helpers are listed):
   `npm install`
2. Run locally (only `npx serve .` works reliably for CORS):
   `npx serve .`

## Screenshot
Screenshot lives at `docs/ss.png` and renders here:

![Bucknell Room Finder screenshot](docs/ss.png)

## Highlights
- Clean “availability first” schedule grid with Bucknell branding and dark mode toggle.
- Live course data with fall/spring term selector, room filtering, and graceful fallbacks (CSV/sample data if CORS blocks the API locally).
- Caches legacy room lists across terms to keep dropdowns complete, even when API data is sparse.

## Project Layout
- `index.html` – UI markup, Bootstrap/Font Awesome imports, dark-mode toggle.
- `app.js` – data fetching, CORS-proxied API fallbacks, schedule grid rendering.
- `buildings.json` / `courses.json` / `courseinformation 2025 (2).csv` – local data + fallbacks.
- `styles.css` – any extra overrides (most styles are inlined in `index.html`).

## Deploy
- Already live on Vercel; re-deploy with `vercel --prod` or any static host.
- When hosted, set `USE_CORS_PROXY = false` so the API is called directly.

## Notes
- Tech: Vanilla JS, Bootstrap 5 for layout, Font Awesome for icons.
- API source: `https://pubapps.bucknell.edu/CourseInformation/data/course/term/`
- Error handling: falls back to CSV then sample data to keep the UI usable if the network blocks requests.

## Contributing
- PRs welcome—future students can add semesters, refine UI, or improve data loading. Open an issue if you spot a bug first.

