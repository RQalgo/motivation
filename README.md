# Stillpoint

A calm, full-screen motivational quote app for desktop and mobile. Plain HTML/CSS/JS, no build step.

## Features
- One quote at a time, set large over a different nature photo each time
- Focus music: a 74-second cycle of the 40 Hz gamma binaural track, looped gaplessly (0.9 MB, loads only when you press play)
- Next/previous: arrow buttons, keyboard arrows, mouse wheel, or swipe up/down on phones
- Like / dislike: tunes which themes and authors you see next (disliked quotes never return)
- Favourites wall: starred quotes pinned as notes on a felt board; tap a note to reopen it
- Double-tap (or double-click) a quote to favourite it; double-tap again to remove it
- Quote of the day: the installed app on Chrome/Edge (Android, Windows, macOS) can send one daily notification, picked from your likes
- Installable as an app (PWA); preferences and favorites stay in your browser

Keyboard: ← → next/previous, L like, D dislike, F favorite, M music.

## Run locally
Any static server works, e.g. `python -m http.server` in this folder, then open http://localhost:8000.

## Project layout
- `index.html`, `css/styles.css`
- `js/quotes.js`: the curated quotes, each tagged with themes
- `js/backgrounds.js`: Unsplash photo IDs
- `js/ambient.js`: the generative music
- `js/app.js`: navigation, preference model, favorites wall
