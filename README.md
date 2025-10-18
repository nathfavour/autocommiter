# Autocommiter

Autocommiter is a small VS Code extension prototype that helps you generate commit messages from the Source Control (SCM) view. It provides a small "wand" action in the SCM view title and a status-bar button that inserts a generated commit message into the Git commit input box.

This project is an early prototype focusing on a lightweight, non-invasive UX: it uses the built-in Git extension when possible to read and set the commit input, and falls back to copying the message to clipboard if necessary.

## Features

- Generate a commit message and insert it into the SCM commit input.
- Status bar button (🪄) to trigger message generation.
- Small toolbar action in the Source Control view title for quick access.
- **Try Copilot first**: Uses GitHub Copilot's built-in commit message generation if available.
- **Intelligent API fallback**: When Copilot isn't available, uses GitHub Models API with automatic model detection and selection.
- **Model selection UI**: Choose from available models with one-time or persistent selection.
- **Automatic model caching**: Caches available models for fast model selection without extra network calls.
- Lightweight prototype generator with a clear hook to add LLM/GitHub/Copilot integrations.

## Usage

### Basic Usage

1. Open a repository in VS Code and make some changes (staged or unstaged).
2. Open the Source Control view (Ctrl+Shift+G / Cmd+Shift+G).
3. Click the status bar wand (right side) or the wand in the Source Control view title to generate a commit message.
4. The generated message will be inserted into the SCM commit input if VS Code's built-in Git extension is available.

### With GitHub Models API

When Copilot is not available, the extension can use the GitHub Models API to generate commit messages:

1. **First time setup**: The extension will prompt you for a GitHub API token (stored securely in VS Code).
2. **Model selection**: On first API usage, you'll be prompted to select a model. Choose one of:
   - `gpt-4o-mini` (fast and cost-effective, default)
   - `gpt-4o` (high quality)
   - `Meta-Llama-3.1-70B-Instruct` or other open models
   - Other available models in GitHub Models catalog

3. **Save your choice**: After selecting, you can:
   - **Use for this commit only**: Model selection won't persist.
   - **Save as default**: Your choice will be remembered and used for all future commits (unless changed in settings).

### Configuration

Open VS Code Settings and search for "Autocommiter" to find:

- **`autocommiter.selectedModel`**: Set your default AI model (e.g., `gpt-4o-mini`, `gpt-4o`, `Meta-Llama-3.1-70B-Instruct`)
- **`autocommiter.autoUpdateModels`**: Auto-refresh available models from the API (default: `true`)
- **`autocommiter.updateGitignore`** (optional): Automatically update `.gitignore` to protect sensitive files (default: `false`)
- **`autocommiter.gitignorePatterns`** (optional): Patterns to add to `.gitignore` when protection is enabled

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
- `src/modelManager.ts` handles model fetching, caching, and selection UI for GitHub Models API.
- `generateMessageFromContext` is a minimal placeholder where richer generation logic should plug in.

## Extending the generator (recommended next steps)

1. Use staged/unstaged diffs to build a richer prompt
   - Use the Git extension API to enumerate changed files and produce a short summary of additions/deletions per file.

2. Customize commit message style
   - Add extension settings for conventional commits, scope inclusion, etc.

3. UI polishing
   - Replace the text status bar item with an icon-only button.
   - Add more commit message style templates.

## Security & privacy

- API keys are stored securely in VS Code's SecretStorage.
- File diffs are compressed and sent to GitHub Models API for message generation.
- No data is stored on extension or external services beyond the API call itself.

## Contributing

Contributions are welcome. Open an issue or PR describing the feature you'd like to add.

## License

This project does not include a license by default. Add a LICENSE file if you want to make the code reusable.