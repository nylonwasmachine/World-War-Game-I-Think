# 🌍 World Conquest

A pixel-style browser conquest game using the entire world as the map.

## Play locally

You can open `index.html` in a browser, although some browsers restrict map-data requests from local files. A tiny local web server is recommended.

For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

1. Create a new GitHub repository.
2. Upload `index.html`, `style.css`, and `game.js`.
3. Go to **Settings → Pages**.
4. Select **Deploy from a branch**.
5. Choose the `main` branch and `/ (root)`.
6. Open the Pages URL.

## Controls

- Click a country: inspect it
- Conquer button: claim territory
- Mouse wheel: zoom
- Drag: move around the map
- Save Game: save to browser local storage

## Next upgrades

This prototype is intentionally simple. Possible upgrades include multiplayer, armies, diplomacy, cities, borders, wars between AI nations, custom factions, sound effects, animated pixel art, and a persistent online database.
