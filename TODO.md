# TODO: Intelligent GitHub Account Management

Enhance `autocommiter` to handle multiple GitHub accounts seamlessly using `gh` CLI and a local SQLite index.

## High-Level Goals
- [ ] Implement a lightweight SQLite database to index repositories and their associated GitHub accounts.
- [ ] Automate GitHub account switching via `gh auth switch`.
- [ ] Automatically configure local `user.name` and `user.email` for repositories.
- [ ] Implement intelligent email discovery for GitHub accounts.
- [ ] Ensure all operations happen "behind the scenes" with zero user configuration.

## Tasks

### Phase 1: Infrastructure & Discovery
- [ ] Research and select a lightweight SQLite integration for the VS Code extension (or Go CLI).
- [ ] Implement a repository-to-account mapping logic based on git remotes.
- [ ] Create a utility to list all logged-in GitHub accounts via `gh auth status`.

### Phase 2: Intelligence & Automation
- [ ] Implement "Smart Email Discovery":
    - Try `gh api user`.
    - Fallback to `gh api user/emails` for private emails.
- [ ] Implement automatic `gh auth switch` logic:
    - Compare current `gh` user with the repository's owner/requirements.
    - Switch if a matching account is found.
- [ ] Implement automatic local git configuration:
    - `git config --local user.name`
    - `git config --local user.email`

### Phase 3: Integration & Optimization
- [ ] Integrate the account management logic into the `autocommiter.generateMessage` workflow.
- [ ] Implement the "lightning fast index" using SQLite to avoid redundant `gh` or `git` calls.
- [ ] Ensure robust error handling (e.g., when `gh` CLI is not installed or no matching account is found).

## Deep Analysis

### 1. The SQLite Index
The database should be stored in the extension's global storage or a shared location if the Go CLI needs access.
Table Schema:
- `repositories`: `path` (PK), `remote_url`, `github_username`, `last_synced_at`
- `accounts`: `username`, `email`, `name`, `hostname`, `is_active`

### 2. Matching Repositories to Accounts
When in a repository:
1. Get `git remote get-url origin`.
2. Parse the owner/org.
3. Check the SQLite index for a known mapping.
4. If unknown, use `gh api` to check which of the currently logged-in accounts has write access to this repo.
5. Store the mapping.

### 3. Account Switching & Git Config
Before `git commit` and `git push`:
1. Check if the current `gh` user matches the indexed user for this repo.
2. If not, run `gh auth switch --user <username>`.
3. Verify or update `git config --local user.name` and `git config --local user.email` to match the `gh` account details.

### 4. Smart Email Discovery
GitHub CLI can be used to fetch the user's details:
- `gh api user --pq .login,.name,.email`
- If email is null: `gh api user/emails --pq '.[] | select(.primary == true) | .email'`
