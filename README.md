# Jewelcase

Turn any image into a clear-CD-case playlist cover, then slap stickers on it.

Your image is placed on the disc of a real clear jewel-case photo, and the photo's own glare and grooves are layered back on top so it looks printed. Stickers get a white die-cut border and can optionally have their background removed (runs in your browser).

## Run it

No build step and no dependencies, just Node:

```bash
npm run dev
```

Then open http://127.0.0.1:4400.

## Use it

- **Cover image**: upload, or drop it on the disc. Drag to move, scroll to zoom.
- **Add sticker**: upload, or drop it anywhere off the disc. Drag to move; the white handle resizes and rotates (shift snaps to 15°).
- **Canvas panel**: exact position, zoom, rotation and flip for the cover image; position, size, rotation, opacity, background removal, border, shadow and layer order for the selected sticker.
- Arrow keys nudge (shift = 10px), Backspace/Delete removes the selected sticker.
- **Download** saves a 1080×1080 JPG, ready to use as a playlist cover.

## Files

- `render.js`: composites the cover image into the case photo (disc measurements live in `TEMPLATE`)
- `stickers.js`: background removal, trimming, die-cut border
- `app.js`: canvas interaction and the [Tweakpane](https://tweakpane.github.io/docs/) panel
- `assets/case.jpg`: the clear-case template photo

## Credits

- Case template photo via Pinterest, credited there to audreykaker.
- Background removal: [@imgly/background-removal](https://github.com/imgly/background-removal-js) (AGPL-3.0), loaded from a CDN on first use.
