# Tabata Timer

Minimal Tabata/HIIT interval timer written in plain HTML, CSS, and JavaScript.
[Live Tabata Page](https://tabata.sanetomore.com/)

## What it does
- Collects warm-up, work, rest, and interval counts (bounded at 0–20 inputs) and builds an ordered phase schedule.
- Streams the session on the page with a labeled timer, progress bar, and “Next Up” list that always highlights the active phase.
- Exposes Start, Pause/Resume, and Reset controls plus optional Web Audio API cues for countdown beeps and new intervals.

## Run it
Open `index.html` directly in any modern browser—no build tools or dependencies required. Edit `style.css` for theme changes and `script.js` for logic tweaks.
