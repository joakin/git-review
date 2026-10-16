# git-review

A Git review app for phones, tablets, and desktop. Review changes, browse and search files, inspect
commits, and copy anchored feedback into an editing session. The app reads repositories without
modifying them. Feedback stays in your browser.

**[Open git-review](https://chimeces.com/git-review/)** and add the private HTTPS address of an
agent running on your code host. Your device must be able to reach that host; Tailscale provides the
intended private connection.

The agent has **no built-in user authentication**. Keep it behind Tailscale Serve or an equivalent
trusted access boundary, and expose only the intended project root. Any client that can reach it can
read accessible files. CORS controls browser requests; it is not authentication.

## Run locally

Requires Bun and Git; file search also needs ripgrep (`rg`). From the repository root:

```sh
bun install
bun run dev --root /path/to/projects
```

Open the printed URL. The local server combines the frontend and agent. Clipboard writes and
microphone capture require localhost or HTTPS; dictation also needs optional host tools.

See [operation and deployment](docs/current/operations.md) for private HTTPS, phone installation,
independent agents, static hosting, and data transfer. The [documentation guide](docs/README.md)
covers development and repository structure.

Source is available for inspection under the [copyright notice](LICENSE).
