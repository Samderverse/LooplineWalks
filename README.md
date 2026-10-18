# Loopline Walks

A walking map and route planner for the Looplines around Worsley and Walkden, Greater Manchester. It runs in the browser and installs on an iPhone home screen like an app.

**Open it:** https://samderverse.github.io/LooplineWalks/

## What it does

- **Lines:** highlights every Loopline path from OpenStreetMap (Roe Green, Tyldesley, Linnyshaw and Ellenbrook), with the length of each and a total for the network. "Take me to the nearest Loopline" plots a walk from where you're standing.
- **Plan:** tap the map to drop stops and get a walking route along real footpaths, with distance in km and miles and a time estimate at stroll, steady or brisk pace. Stops can be dragged, and there are one-tap options for loop walks and out-and-back walks.
- **Walk:** records a walk as you go, with live distance, time and pace, and keeps the screen awake while recording.
- **Saved:** planned routes and recorded walks, kept on the device.
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
| `index.html` | App layout |
| `styles.css` | Design, including light and dark mode |
| `app.js` | Map, route planning, walk recording and saved walks |
| `sw.js` | Service worker for offline use and caching |
| `manifest.webmanifest` | Home-screen name, icon and full-screen settings |
| `icons/` | App icons |

## Updating the app

1. Upload the changed files to this repository and commit.
2. In `sw.js`, change the version number in `const VERSION = 'lw-v2'` (for example to `lw-v3`). Without this, phones keep showing the old cached copy.
3. On the phone, close and reopen the app twice: the first open downloads the update, the second shows it.

## Data and services

No API keys or accounts are needed. Everything comes from free, open services:

- **Map data and Loopline paths:** [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, through the Overpass API
- **Walking routes:** [OSRM](https://project-osrm.org/) on routing.openstreetmap.de
- **Map tiles:** OpenStreetMap, [CyclOSM](https://www.cyclosm.org/) and Esri World Imagery
- **Map library:** [Leaflet](https://leafletjs.com/)

Saved walks and settings stay in the phone's browser storage. Nothing is sent anywhere else. Note that the home-screen app and Safari keep separate storage.

## Known limits

- iPhones pause GPS for web apps when the screen locks, so keep the app open on screen while recording a walk.
- The first load of the Loopline paths can take a little while if the OpenStreetMap data server is busy. After that they're stored on the phone and refresh in the background weekly.
- Walking routes need a signal. Without one, the planner shows the straight-line distance between stops.
