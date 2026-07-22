# mtg-online

Local multiplayer MTG tabletop (rules-light) with room codes, MTG Arena deck import, and Scryfall images.

## Prereqs

- Node.js (tested with Node 25)
- `AllPrintings.json` at repo root (already in this workspace)

## Setup

```zsh
cd /Users/chezkaquinola/mtg-online
npm install

# one-time (or whenever AllPrintings.json changes)
npm -w server run build:index
```

## Run (dev)

```zsh
npm run dev:all
```

- Client: `http://127.0.0.1:5173/`
- Server: `http://localhost:3001/healthz`
- Index status: `http://localhost:3001/index/status`

## How to play (current MVP)

- Create a room, copy the room code, friend joins with the code.
- Paste an MTG Arena deck list and click **Import**.
- Draw/shuffle.
- Click cards in **Hand** to play them to the **Battlefield**.
- Click a battlefield card to **tap/untap**.
- Use **To GY / To hand / Exile** to move cards.
- Use **Attach…** then **Attach here** to attach one permanent to another.
- Use **+ Counter** / **Clear counters** to manage counters.
- Chat + game log are synced to everyone.

## Environment variables

- Server:
  - `PORT` (default `3001`)
  - `CLIENT_ORIGIN` (default `http://localhost:5173`)
- Client:
  - `VITE_SERVER_URL` (default `http://localhost:3001`)

## Notes

- Scryfall images are fetched by `scryfallId` and cached on disk under `server/.cache/scryfall/`.
- This is currently a **tabletop simulator** (players can do things out of order); it does not enforce full MTG rules yet.
