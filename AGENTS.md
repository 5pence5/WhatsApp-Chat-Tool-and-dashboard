# Agent Guidelines

## Project context
- This repository powers a static dashboard that is intended to be served via GitHub Pages. Keep frontend assets (HTML, CSS, and client-side JavaScript) self-contained and compatible with static hosting from the repository root.

## Codebase overview
- `index.html` bootstraps the dashboard UI.
- `styles.css` defines the shared styling for the GitHub Pages experience.
- The `js/` directory hosts the chat parsing, statistics, and rendering logic. Prefer ES modules that modern browsers can load without bundling.
- The `tests/` directory contains Node.js regression suites that validate the parser and supporting utilities.

## Working conventions
- Use the Node.js `node:test` module for new or updated JavaScript tests in this repository.
- Keep test fixtures lightweight and favour the provided `test.zip` sample when possible.
- Summaries in pull requests should highlight notable testing improvements.
- When restructuring functionality or adding new areas, update this `AGENTS.md` (or introduce scoped variants) so future agents inherit accurate guidance.
