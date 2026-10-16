# Workspace map

| Location                                              | Responsibility and documentation                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`apps/web/`](../../apps/web/README.md)               | Preact frontend, navigation, source presentation, feedback, and browser-local data.                     |
| [`apps/agent/`](../../apps/agent/README.md)           | Read-only HTTP API, project/filesystem/Git access, media, transcription, and cloud launcher.            |
| [`packages/shared/`](../../packages/shared/README.md) | Runtime-neutral contracts, parsers, and shared mechanisms.                                              |
| [`scripts/`](../../scripts/)                          | Builds, local server composition, dependency notices, icons, and secret scanning.                       |
| [`deploy/`](../../deploy/)                            | Linux prerequisite installer.                                                                           |
| [`qa/`](../../qa/)                                    | Browser checks, fixture preparation, capture tools, and shared test support. See [testing](testing.md). |
| [`.github/workflows/`](../../.github/workflows/)      | Static deployment, cloud artifact packaging, and secret scans.                                          |

The root [manifest](../../package.json) owns workspace commands and tooling.
[Architecture](architecture.md) describes cross-package ownership; [operations](operations.md)
describes generated artifacts and running the app.
