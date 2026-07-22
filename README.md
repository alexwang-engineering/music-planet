# Nebula (星云)

![Status: Work in Progress](https://img.shields.io/badge/status-work_in_progress-yellow.svg)
[![CI](https://github.com/alexwang-engineering/music-planet/actions/workflows/ci.yml/badge.svg)](https://github.com/alexwang-engineering/music-planet/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

> 🚧 **Work in progress** — under active development, not feature-complete. Feedback and review welcome via the open draft PR.

A personal-use Electron desktop app that wraps NetEase Cloud Music (网易云音乐)
in a custom Three.js/WebGL player interface and packages as a macOS application.

## Highlights

- Electron main/renderer separation with a local API lifecycle managed by the
  desktop host.
- A custom 3D visualiser with user-tunable rhythm and motion controls.
- Session-cookie redaction before request or response data reaches logs.
- Electron web security remains enabled, and the companion API binds only to
  `127.0.0.1` instead of the local network.
- `electron-builder` packaging for Apple silicon and Intel macOS targets.

## How it works

- `main.js` is the Electron main process. On launch it spawns a local instance of the [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) (an unofficial NetEase Cloud Music API wrapper) on `127.0.0.1:3000`, waits for it to become ready, then opens the app window.
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

This runs two steps:

1. `predist` stages a minimal, production-only copy of
   [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) into
   `api-staging/`, which `electron-builder` bundles into the app's
   `extraResources` as `api-runtime`.
2. `electron-builder --mac --dir` packages an **unpacked** `.app` (no installer)
   for both Apple silicon and Intel.

The built app appears under `dist/`:

```bash
open "dist/mac-arm64/Nebula.app"   # Apple silicon
open "dist/mac/Nebula.app"         # Intel
```

On first launch the app spawns the bundled NetEase API on `127.0.0.1:3000`,
waits for it to become ready, then opens the player window — no separate server
step is needed for the packaged build.

## Notes for reviewers

This is a personal-use project — it does not ship or host any music itself; it talks to NetEase's own (unofficial, community-reverse-engineered) API to play back a user's own accessible content.

The upstream API is unofficial and may change without notice. Users are
responsible for following the service's terms and local copyright rules.

## Verify

```bash
npm ci
npm audit --audit-level=high
node --check main.js
```

GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) runs these installation,
high-severity dependency-audit and syntax checks on every push and pull request.

## Dependencies

The unofficial [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)
is pinned to `4.32.0` and staged at build time rather than listed as a runtime
dependency, so the bundled API is reproducible and does not shift when upstream
publishes a breaking change. The `predist` step also forces a
`music-metadata@11.14.0` override to resolve a transitive version conflict during
that staging install.

## License

Licensed under the [Apache License 2.0](LICENSE).
