import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// Minimal Git types for the built-in Git extension API we consume
interface GitExtension {
	getAPI(version: number): GitAPI;
}

interface RepositoryState {
	indexChanges?: any[];
	workingTreeChanges?: any[];
	mergeChanges?: any[];
}

interface GitRepository {
	inputBox: { value: string };
	rootUri: vscode.Uri;
	state?: RepositoryState;
}

interface GitAPI {
	repositories: GitRepository[];
}

function runGitCommand(cmd: string, cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(cmd, { cwd }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr || stdout || error.message));
				return;
			}
			resolve(stdout || '');
		});
	});
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "autocommiter" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const helloDisposable = vscode.commands.registerCommand('autocommiter.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from autocommiter!');
	});

	context.subscriptions.push(helloDisposable);

	// Generate commit message command (prototype)
	const generateDisposable = vscode.commands.registerCommand('autocommiter.generateMessage', async () => {
		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Autocommit: staging, generating and pushing…' }, async (progress) => {
			progress.report({ message: 'Locating repository…' });
			try {
				const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
				let message = '';

				if (!gitExt) {
					vscode.window.showErrorMessage('Git extension not available.');
					return;
				}

				const api = gitExt.getAPI(1);
				const repo = api.repositories[0];
				if (!repo) {
					vscode.window.showErrorMessage('No Git repository found in workspace.');
					return;
				}

				const cwd = repo.rootUri?.fsPath;
				if (!cwd) {
					vscode.window.showErrorMessage('Repository root not found.');
					return;
				}

				// 1) Stage all changes
				progress.report({ message: 'Staging changes (git add .)…' });
				await runGitCommand('git add .', cwd);

				// 2) Verify staged files exist
				progress.report({ message: 'Checking staged changes…' });
				const staged = (await runGitCommand('git diff --staged --name-only', cwd)).trim();
				if (!staged) {
					vscode.window.showInformationMessage('No changes to commit — Autocommit skipped.');
					return;
				}

				// 3) Try Copilot generator first
				progress.report({ message: 'Generating commit message (Copilot preferred)…' });
				try {
					const copilotResult = await vscode.commands.executeCommand('github.copilot.git.generateCommitMessage');
					if (copilotResult && typeof copilotResult === 'string' && copilotResult.trim().length > 0) {
						message = copilotResult.trim();
						vscode.window.showInformationMessage('Autocommit used Copilot to generate the commit message.');
					}
				} catch (e) {
					// ignore and fall back
				}

				// 4) Fallback generator
				if (!message) {
					const current = repo.inputBox.value || '';
					message = await generateMessageFromContext(current, cwd);
				}

				// 5) Commit using temp file to avoid quoting issues
				progress.report({ message: 'Committing staged changes…' });
				const tmpFile = path.join(os.tmpdir(), `autocommiter_msg_${Date.now()}.txt`);
				fs.writeFileSync(tmpFile, message, { encoding: 'utf8' });
				try {
					await runGitCommand(`git commit -F "${tmpFile.replace(/"/g, '\\"')}"`, cwd);
					vscode.window.showInformationMessage('Autocommit committed changes locally.');
				} finally {
					// best-effort cleanup
					try { fs.unlinkSync(tmpFile); } catch {}
				}

				// 6) Push
				progress.report({ message: 'Pushing to remote…' });
				await runGitCommand('git push', cwd);
				vscode.window.showInformationMessage('Autocommit pushed changes to remote.');

				// 7) Clear the SCM commit input since the message is no longer needed
				try {
					repo.inputBox.value = '';
				} catch (e) {
					// ignore if unable to clear
				}
			} catch (err: any) {
				console.error('autocommiter autocommit error', err);
				vscode.window.showErrorMessage(`Autocommit failed: ${err?.message ?? String(err)}`);
			}
		});
	});

	context.subscriptions.push(generateDisposable);

	// Status bar item (wand emoji) placed near the right
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	status.text = '🪄 Autocommit';
	status.command = 'autocommiter.generateMessage';
	status.tooltip = 'Autocommit — generate a commit message using Autocommiter';
	status.show();
	context.subscriptions.push(status);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// Very small heuristic generator — placeholder for integrating with GitHub/Copilot APIs.
async function generateMessageFromContext(currentInput: string, repoRoot?: string): Promise<string> {
	// If user already typed something, preserve it verbatim
	if (currentInput && currentInput.trim().length > 0) {
		return currentInput.trim();
	}

	// Otherwise craft a short, generic message. In future this should inspect staged changes or call GitHub/Copilot.
	return 'chore: automated commit generated by Autocommiter';
}
