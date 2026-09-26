# Nebula (星云)

![Status: Work in Progress](https://img.shields.io/badge/status-work_in_progress-yellow.svg)
[![CI](https://github.com/alexwang-engineering/music-planet/actions/workflows/ci.yml/badge.svg)](https://github.com/alexwang-engineering/music-planet/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

> 🚧 **Work in progress** — under active development, not feature-complete.
> Feedback and review are welcome via GitHub issues.

A personal-use Electron desktop app that wraps NetEase Cloud Music (网易云音乐)
in a custom Three.js/WebGL player interface and packages as a macOS application.

## Highlights

- Electron main/renderer separation with a local API lifecycle managed by the
  desktop host.
- A custom 3D visualiser with user-tunable rhythm and motion controls.
- Three smoothly transitioning visual modes: the album-aware planet, a
  bass-reactive purple pulse wireframe, and the 2D liquid aura.
- Session-cookie redaction before request or response data reaches logs.
- Electron web security remains enabled, and the companion API binds only to
  `127.0.0.1` instead of the local network.
- `electron-builder` packaging for Apple silicon and Intel macOS targets.

## How it works

- `main.js` is the Electron main process. On launch it spawns a local instance of the [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) (an unofficial NetEase Cloud Music API wrapper) on `127.0.0.1:3000`, waits for it to become ready, then opens the app window.
- `app/index.html` is the renderer — the player UI, built with Three.js/WebGL for the 3D visuals.
- The pulse-wire mode reuses the same renderer, scene, animation loop, audio
  element, `AudioContext`, and `AnalyserNode` as the planet. A device-rate-aware
  20–180 Hz FFT window drives bounded simplex-noise vertex displacement through
  45 ms attack / 220 ms release smoothing; quiet passages return toward a sphere.
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
2. `electron-builder` packages signed-release-ready DMG and ZIP installers for
   both Apple silicon and Intel. Packaged Nebula checks the GitHub Releases page
   on launch, downloads a newer release in the background, and installs it on
   the next quit.

The built installers appear under `dist/`:

```bash
open "dist/Nebula-1.0.1-arm64.dmg" # Apple silicon example
open "dist/Nebula-1.0.1.dmg"        # Intel example
```

On first launch the app spawns the bundled NetEase API on `127.0.0.1:3000`,
waits for it to become ready, then opens the player window — no separate server
step is needed for the packaged build.

## Keep the project checkout current

Run this when opening the project in a development tab:

```bash
npm run sync:latest
```

It fetches `origin/main` and fast-forwards a clean local `main` checkout. Local
edits and feature branches are left untouched and reported for review.

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
that staging install. The root dependency tree forces `brace-expansion@5.0.8`
to retain the patched release required by the security audit.

## License

Licensed under the [Apache License 2.0](LICENSE).
