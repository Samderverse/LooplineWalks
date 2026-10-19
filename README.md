# Loopline Walks

A walking map, route planner and walk log for the Looplines around Worsley and Walkden, Greater Manchester. It runs in the browser and installs on an iPhone home screen like an app.

**Open it:** https://samderverse.github.io/LooplineWalks/

## What it does

- **Lines:** highlights every Loopline path from OpenStreetMap (Roe Green, Tyldesley, Linnyshaw and Ellenbrook), with the length of each and a total for the network. "Take me to the nearest Loopline" plots a walk from where you're standing.
- **Plan:** tap the map to drop stops and get a walking route along real footpaths, with distance in km and miles, a time estimate at stroll, steady or brisk pace, and which Looplines it uses. Stops can be dragged, and there are one-tap options for loop walks and out-and-back walks.
- **Walk:** logs a walk as you go, with live distance, time and pace, and keeps the screen awake while recording.
- **Routes:** walks you've planned and saved. Each opens to its distance, walking time and the Looplines it follows, with Edit in planner, Rename, Share and Delete.
- **Journeys:** walks you've logged, newest first and grouped by month, with this month's and all-time totals. Each opens to its distance, time, pace and how much of each Loopline you covered.
- **Share:** turns any route or journey into a picture card (Post 4:5 or Story 9:16) for Instagram, WhatsApp, Facebook or Messages through the iPhone share menu, or a GPX file for Strava, Komoot and OS Maps. Start and finish are trimmed by 200 m by default, so a walk from your door doesn't show where you live.
- **Day and night:** the moon/sun button switches instantly. Settings (tap the logo) also has Match phone and Sunrise & sunset, which switches at local sunset.
- **Backup:** Settings exports everything to a file for Files or iCloud Drive, and restores it on another phone.
- **Map controls:** live GPS location, three map styles (Standard, Paths and Satellite), and nearby cafés, pubs, toilets and parking within 150 m of the lines.
- **Works offline:** after the first load, the Loopline paths and any map areas you've viewed work without signal.

## Install on iPhone

1. Open the link above in **Safari**.
2. Tap **⋯** (or the Share button), then **Share › Add to Home Screen**.
3. Make sure **Open as Web App** is on, then tap **Add**.
4. Allow location the first time you tap the location button.

If location is blocked, go to **Settings › Privacy & Security › Location Services › Safari Websites** and set it to **While Using**.

## Files

| File | Purpose |
|---|---|
| `index.html` | App layout, settings, share and dialog panels |
| `styles.css` | Design, including day and night themes |
| `app.js` | Map, planning, walk logging, routes and journeys, sharing, backup |
| `sw.js` | Service worker for offline use and caching |
| `manifest.webmanifest` | Home-screen name, icon and full-screen settings |
| `icons/` | App icons |

## Updating the app

1. Upload the changed files to this repository and commit.
2. In `sw.js`, change the version number in `const VERSION = 'lw-v3'` (for example to `lw-v4`). Without this, phones keep showing the old cached copy.
3. On the phone, close and reopen the app twice: the first open downloads the update, the second shows it.

## Data and services

No API keys or accounts are needed. Everything comes from free, open services:

- **Map data and Loopline paths:** [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, through the Overpass API (four mirrors, tried in turn)
- **Walking routes:** [OSRM](https://project-osrm.org/) on routing.openstreetmap.de
- **Map tiles:** OpenStreetMap, [CyclOSM](https://www.cyclosm.org/) and Esri World Imagery
- **Map library:** [Leaflet](https://leafletjs.com/)

Routes, journeys and settings stay in the phone's browser storage. Nothing is sent anywhere else, and share cards are drawn on the phone. The home-screen app and Safari keep separate storage, and deleting the home-screen app deletes its data, so export a backup now and then.

## Version history

- **v2.0:** Routes and Journeys tabs with detail pages, Looplines-walked tracking, share cards and GPX export with a privacy trim, day/night toggle with a sunset option, backup and restore, more reliable first load.
- **v1.0:** map, planner, walk recorder and saved walks.

## Known limits

- iPhones pause GPS for web apps when the screen locks, so keep the app open on screen while logging a walk.
- Walking routes need a signal. Without one, the planner shows the straight-line distance between stops.
- A web app can't post straight to Instagram or Facebook; sharing goes through the iPhone share menu.
