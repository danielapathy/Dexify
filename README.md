# Spotify UI Recreation

High-fidelity recreation of the Spotify desktop layout (sidebar + home view + player bar).

## Icons

- Currently used in this project: Remix Icon (via `remixicon`).
  - Docs: https://www.npmjs.com/package/remixicon

Other good options (all support npm and/or CDN):

- Bootstrap Icons (SVG + icon font): https://icons.getbootstrap.com/
- Font Awesome Free: https://fontawesome.com/docs/web/setup/packages
- Material Symbols (Google Fonts): https://fonts.google.com/icons
- Lucide (SVG icons + packages): https://lucide.dev/icons/file

## Run

- Electron (recommended):
  - `npm install`
  - `npm start`
- Browser:
  - `npm install` (icons load from `node_modules/`)
  - `npm run start:web` then open `http://localhost:5173`

## Login popup + local session webhook

Electron opens a popup for login (default `about:blank`, or set `MUSIC_APP_LOGIN_URL`). The main process also starts a local-only HTTP server bound to `127.0.0.1` to let you fetch the captured `ARL` cookie state.

- Configure login:
  - `MUSIC_APP_LOGIN_URL` (default `about:blank`)
  - Captured cookie name: `arl`
- Stored on disk:
  - `.session/arl.enc.json` (encrypted; ignored by git)
- Password manager / KeePass support:
  - You can load a Chrome-compatible extension (e.g. KeePassXC-Browser) by setting `KEEPASSXC_EXTENSION_DIR` (or `CHROME_EXTENSIONS` as a comma-separated list of extension dirs).
- Configure webhook:
  - `SESSION_WEBHOOK_PORT` (default `3210`)
  - `SESSION_WEBHOOK_TOKEN` (optional; if set, requests must include header `x-webhook-token: <token>`)
  - `SESSION_WEBHOOK_EXPOSE_ARL=true` (optional; includes `arl` in `/session` response)
- Endpoints:
  - `GET /health`
  - `GET /session`
