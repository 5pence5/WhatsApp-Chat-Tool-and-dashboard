# Agent Guidelines

## Project overview
- This repository hosts a static WhatsApp chat insights dashboard intended for GitHub Pages deployment. The entire experience runs client-side via `index.html`, `styles.css`, and scripts in `js/`.
- There is no build pipeline; edits to the HTML/CSS/JS are reflected directly when the site is served.

## Working expectations
- Run relevant checks whenever you touch application logic or data processing code. For this project, execute `npm test` to run the regression tests that validate the chat parser.
- When changes affect front-end behaviour, consider opening `index.html` locally to manually verify the UI.
- Keep documentation and instructions in sync with the implemented behaviour.

## Maintenance notes
- If you discover gaps, outdated steps, or new conventions, update this `AGENTS.md` (and any related docs) to reflect those learnings.
- Surface any issues that might impact GitHub Pages hosting, such as path assumptions or missing static assets.

Thanks for keeping the dashboard polished and reliable!
