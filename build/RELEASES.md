# Dexify Releases

<!--
  CASCADE INSTRUCTIONS — Version Management
  ==========================================
  This file is Cascade's memory for tracking Dexify release versions.

  CURRENT VERSION: v1.1.0

  When the user asks to bump a version or create a release:
  1. Decide the bump type (patch/minor/major) based on the changes.
  2. Update "CURRENT VERSION" above to the new version.
  3. Add a new "## vX.Y.Z" section at the top of the changelog below.
  4. Update "version" in package.json to match.
  5. Commit both files with message: "release: vX.Y.Z"
  6. Create a git tag: git tag vX.Y.Z
  7. Push: git push origin main --tags
  8. The GitHub Actions workflow (.github/workflows/release.yml) will
     automatically build macOS, Windows, and Linux artifacts and publish
     a GitHub Release with the notes from this file.

  Versioning guide:
  - patch (0.0.x): Bug fixes, small tweaks
  - minor (0.x.0): New features, UI changes, non-breaking improvements
  - major (x.0.0): Breaking changes, major rewrites
-->

## v1.1.0 — 2026-02-11
- Redesigned settings page with section-based layout and search placeholder
- Player empty state with animated transitions
- Entity remove button with hover animation
- Expanded webhook system for session and debug endpoints
- Reworked context menus with new action types
- Rewritten track multi-select with improved selection logic
- Enhanced notifications menu
- Download library improvements: simplified playlist subtitles, offline tracklist and playlist mirror updates
- Entity header and download action rework
- Added debug tooling modules
- Build system: electron-builder configs for macOS, Windows, and Linux
- GitHub Actions release workflow for automated cross-platform builds

## v1.0.0 — 2025-01-01
- Initial packaged release (macOS dmg/zip, Windows nsis)
- Electron-based desktop client with Deezer integration
- Offline download library with playlist mirroring
- Search, playback, and library management
