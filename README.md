# Autocommiter

Autocommiter is a small VS Code extension prototype that helps you generate commit messages from the Source Control (SCM) view. It provides a small "wand" action in the SCM view title and a status-bar button that inserts a generated commit message into the Git commit input box.

This project is an early prototype focusing on a lightweight, non-invasive UX: it uses the built-in Git extension when possible to read and set the commit input, and falls back to copying the message to clipboard if necessary.

## Features

- Generate a commit message and insert it into the SCM commit input.
- Status bar button (🪄) to trigger message generation.
- Small toolbar action in the Source Control view title for quick access.
- Lightweight prototype generator with a clear hook to add LLM/GitHub/Copilot integrations.

## Usage

1. Open a repository in VS Code and make some changes (staged or unstaged).
2. Open the Source Control view (Ctrl+Shift+G / Cmd+Shift+G).
3. Click the status bar wand (right side) or the wand in the Source Control view title to generate a commit message.
4. The generated message will be inserted into the SCM commit input if VS Code's built-in Git extension is available. Otherwise it will be copied to the clipboard and you can paste it manually.

Tip: The current generator is a simple placeholder; see "Extending the generator" below to connect to an LLM or GitHub/Copilot.

## Development

Requirements
- Node.js and pnpm (pnpm is used by this workspace)
- VS Code

Run locally

1. Install dependencies:

```bash
pnpm install
```

2. Start the TypeScript and bundler watchers (the workspace already includes watch tasks):

```bash
pnpm run watch
```

3. Open this project in VS Code and press F5 to launch an Extension Development Host. In the new window, open a Git workspace and try the wand button in Source Control.

Build and package

```bash
pnpm run package
# or use `vsce package` if you prefer
```

Notes on typechecks
- The project uses `tsconfig.json` with `skipLibCheck` and explicit `types` entries to avoid third-party ambient type issues during development.

## Code highlights

- `src/extension.ts` registers the command `autocommiter.generateMessage`, adds a status bar item, and attempts to use the `vscode.git` extension's API to read and write the `inputBox` value for the repository.
- `generateMessageFromContext` is a minimal placeholder where richer generation logic should plug in.

## Extending the generator (recommended next steps)

1. Use staged/unstaged diffs to build a richer prompt
   - Use the Git extension API to enumerate changed files and produce a short summary of additions/deletions per file.

2. Integrate an LLM provider
   - Add an extension setting to accept an API key (or use the `vscode.authentication` API to get GitHub credentials).
   - Provide an option to choose between providers (OpenAI, Anthropic, local model, etc.).
   - Send a concise prompt including the file list and small diffs to generate a high-quality commit message.

3. Explore Copilot/GitHub integration
   - Copilot integration is not a public API; however you can integrate with GitHub's REST API for repository context or use the user's authenticated GitHub token for richer context.

4. UI polishing
   - Replace the text status bar item with an icon-only button.
   - Add settings for style (conventional commits, short/long, scope inclusion).

## Security & privacy

If you integrate a third-party LLM, make sure to:

- Explicitly show in the extension settings when network calls are made and what data is sent.
- Allow users to opt in/out of sending patch contents to external services.

## Contributing

Contributions are welcome. Open an issue or PR describing the feature you'd like to add.

## License

This project does not include a license by default. Add a LICENSE file if you want to make the code reusable.

---

If you'd like, I can now:

- Implement LLM integration (OpenAI/Anthropic) and add settings to store API keys securely.
- Improve the generator to inspect diffs and produce conventional commit messages.
- Add tests and CI configuration.

Which should I do next?
