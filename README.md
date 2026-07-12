# Nebula (星云)

> 🚧 **Work in progress** — under active development, not feature-complete. Feedback and review welcome via the open draft PR.

A personal-use Electron desktop app that wraps NetEase Cloud Music (网易云音乐) in a 3D/WebGL player UI.

## How it works

- `main.js` is the Electron main process. On launch it spawns a local instance of the [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) (an unofficial NetEase Cloud Music API wrapper) on `localhost:3000`, waits for it to become ready, then opens the app window.
- `app/index.html` is the renderer — the player UI, built with Three.js/WebGL for the 3D visuals.
- API request/response logs are sanitized before being printed (cookies redacted) since NetEase session cookies can appear in query strings.

## Run locally

```bash
npm install
npm start
```

## Build a distributable

```bash
npm run dist
```

Packages the app with `electron-builder` (`--mac --dir` target) and bundles the NetEase API package into `extraResources`.

## Notes for reviewers

This is a personal-use project — it does not ship or host any music itself; it talks to NetEase's own (unofficial, community-reverse-engineered) API to play back a user's own accessible content.
