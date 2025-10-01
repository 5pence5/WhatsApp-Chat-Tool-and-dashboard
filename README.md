# WhatsApp Chat Insights Dashboard

A fully client-side dashboard for exploring WhatsApp chat exports. Upload a `.zip` or `.txt` export and instantly explore engagement metrics, timelines, key words, and emoji usage. Generate a Markdown summary for retrospectives or knowledge bases — all without leaving your browser.

## Features

- 📦 **Drag-and-drop uploads** for standard WhatsApp exports (zip or raw text).
- 📊 **Interactive analytics** including participant activity, hourly rhythm, and quick insights.
- 🧠 **Smart text processing** for word frequencies, emoji counts, and streak detection.
- 🗓️ **Date filtering** to focus on specific time windows.
- 📝 **Markdown export** builder with configurable title and sample message count.
- 🔒 **Privacy-first** — processing happens locally in the browser, perfect for GitHub Pages hosting.

## Getting started locally

1. Install dependencies for the lightweight test harness:

   ```bash
   npm install
   ```

2. Run the parser regression test against the bundled example chat export:

   ```bash
   npm test
   ```

3. Open `index.html` directly in your browser (or via a simple static server) to try the dashboard.

## Deploying to GitHub Pages

The app is a static site. Commit the repository to GitHub and enable GitHub Pages (e.g., from the `main` branch or the `docs/` folder if you prefer). No build step or server runtime is required.

## Credits

- [Chart.js](https://www.chartjs.org/) powers the visualisations.
- [JSZip](https://stuk.github.io/jszip/) is used client-side to unpack WhatsApp archives.

Enjoy the insights! ✨
