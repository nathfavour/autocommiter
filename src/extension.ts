import { exec } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import changesSummarizer from './changesSummarizer';
import { getModelForApi, refreshModelList } from './modelManager';
import { getGitmojifiedMessage, isGitmojEnabled } from './gitmoji';

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
	add(resources: vscode.Uri[]): Promise<void>;
	commit(message: string): Promise<void>;
	push(): Promise<void>;
}

interface GitAPI {
	repositories: GitRepository[];
	onDidOpenRepository: vscode.Event<GitRepository>;
	onDidCloseRepository: vscode.Event<GitRepository>;
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

// Normalize path to posix relative path from repoRoot
function toPosix(rel: string) {
	return rel.split(path.sep).join('/');
}

async function tryGenerateFromIDE(repo: GitRepository, availableCommands: string[]): Promise<string | undefined> {
	const commands = [
		{ id: 'cursor.generateGitCommitMessage', name: 'Cursor' },
		{ id: 'antigravity.generateCommitMessage', name: 'Antigravity' },
		{ id: 'github.copilot.git.generateCommitMessage', name: 'Copilot' },
		{ id: 'git.generateCommitMessage', name: 'VS Code' }
	];

	const appName = vscode.env.appName.toLowerCase();
	// Prioritize based on appName or command prefixes
	commands.sort((a, b) => {
		const aMatch = appName.includes(a.name.toLowerCase()) || availableCommands.some(c => c.startsWith(a.id.split('.')[0] + '.'));
		const bMatch = appName.includes(b.name.toLowerCase()) || availableCommands.some(c => c.startsWith(b.id.split('.')[0] + '.'));
		if (aMatch && !bMatch) {
			return -1;
		}
		if (!aMatch && bMatch) {
			return 1;
		}
		return 0;
	});

	for (const cmd of commands) {
		if (availableCommands.includes(cmd.id)) {
			try {
				const result = await vscode.commands.executeCommand(cmd.id, repo);
				if (result && typeof result === 'string' && result.trim().length > 0) {
					return result.trim();
				}
			} catch (e) {
				// ignore and try next
			}
		}
	}
	return undefined;
}

async function getOrPromptApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
	const keyId = 'autocommiter.apiKey';
	try {
		const existing = await context.secrets.get(keyId);
		if (existing) {
			return existing;
		}
	} catch { }

	const entered = await vscode.window.showInputBox({
		prompt: 'Enter GitHub API key (will be stored securely in VS Code SecretStorage)',
		ignoreFocusOut: true,
		password: true
	});
	if (entered && entered.trim().length > 0) {
		try {
			await context.secrets.store(keyId, entered.trim());
			return entered.trim();
		} catch (e) {
			// fallback
			return entered.trim();
		}
	}
	return undefined;
}

function callInferenceApi(apiKey: string, userPrompt: string, model: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify({
			messages: [
				{ role: 'system', content: 'You are a helpful assistant.' },
				{ role: 'user', content: userPrompt }
			],
			model: model
		});

		const url = new URL('https://models.inference.ai.azure.com/chat/completions');
		const opts: https.RequestOptions = {
			method: 'POST',
			hostname: url.hostname,
			path: url.pathname,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(payload),
				'Authorization': `Bearer ${apiKey}`
			}
		};

		const req = https.request(opts, res => {
			let body = '';
			res.on('data', d => body += d);
			res.on('end', () => {
				try {
					const json = JSON.parse(body);
					// try typical response shapes
					if (json.choices && Array.isArray(json.choices) && json.choices[0]?.message?.content) {
						resolve(String(json.choices[0].message.content));
						return;
					}
					if (json.output && Array.isArray(json.output) && json.output[0]?.content && json.output[0].content[0]?.text) {
						resolve(String(json.output[0].content[0].text));
						return;
					}
					// Additional fallback: try to extract any text-like content
					if (typeof json === 'string') {
						resolve(json);
						return;
					}
					// Check for error response
					if (json.error) {
						reject(new Error(`API Error: ${json.error.message || JSON.stringify(json.error)}`));
						return;
					}
					// Last resort: if we still have no content, reject instead of returning [object Object]
					reject(new Error(`Unexpected API response format: ${JSON.stringify(json).slice(0, 200)}`));
				} catch (e) {
					reject(e);
				}
			});
		});

		req.on('error', err => reject(err));
		req.write(payload);
		req.end();
	});
}

async function ensureGitignoreSafety(repoRoot: string): Promise<void> {
	// Check if user has enabled gitignore updates
	const config = vscode.workspace.getConfiguration('autocommiter');
	const shouldUpdate = config.get<boolean>('updateGitignore', false);

	if (!shouldUpdate) {
		console.log('Autocommiter: .gitignore updates disabled by user settings');
		return;
	}

	const gitignorePath = path.join(repoRoot, '.gitignore');
	let existing = '';
	try {
		existing = fs.readFileSync(gitignorePath, 'utf8');
	} catch (e) {
		existing = '';
	}

	const lines = existing.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

	// helper to match patterns (supports simple globs with *)
	const patternMatches = (pattern: string, p: string) => {
		// convert gitignore pattern to regex
		const esc = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
		const re = new RegExp('^' + esc + '$');
		return re.test(p);
	};

	const isIgnored = (relPath: string) => {
		const p = toPosix(relPath);
		for (const pat of lines) {
			// direct compare
			if (pat === p) {
				return true;
			}
			// directory pattern
			if (pat.endsWith('/')) {
				if (p === pat.slice(0, -1) || p.startsWith(pat)) {
					return true;
				}
			}
			// try glob match
			try {
				const esc = pat.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
				const re = new RegExp('^' + esc + '$');
				if (re.test(p)) {
					return true;
				}
			} catch {
				// ignore bad patterns
			}
		}
		return false;
	};

	// Get patterns from settings
	const configPatterns = config.get<string[]>('gitignorePatterns', ['*.env*', '.env*', 'docx/', '.docx/']);
	const required = configPatterns;
	const toAppend: string[] = [];
	for (const req of required) {
		let found = false;
		for (const l of lines) {
			if (l === req) {
				found = true;
				break;
			}
			// rough match using simple glob logic
			try {
				const esc = l.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
				if (new RegExp('^' + esc + '$').test(req)) {
					found = true;
					break;
				}
			} catch { }
		}
		if (!found) {
			toAppend.push(`# Added by Autocommiter: ensure ${req}`);
			toAppend.push(req);
		}
	}

	// Find nested .git directories, skipping ignored directories
	const nestedGitParents: string[] = [];
	function walk(dir: string) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const e of entries) {
			const full = path.join(dir, e.name);
			const rel = path.relative(repoRoot, full);
			const relPosix = toPosix(rel || '.');
			if (isIgnored(relPosix)) {
				// skip this directory entirely
				if (e.isDirectory()) {
					continue;
				}
			}
			if (e.isDirectory()) {
				if (e.name === '.git') {
					const parent = path.dirname(full);
					const parentRel = toPosix(path.relative(repoRoot, parent));
					// ignore the repo root .git
					if (parentRel === '' || parentRel === '.') {
						continue;
					}
					if (!nestedGitParents.includes(parentRel)) {
						nestedGitParents.push(parentRel);
					}
					continue;
				}
				// recurse
				try {
					walk(full);
				} catch { }
			}
		}
	}
	try { walk(repoRoot); } catch (e) { /* ignore walk errors */ }

	// Parse .gitmodules if present
	const gitmodulesPath = path.join(repoRoot, '.gitmodules');
	const gitmodulePaths: string[] = [];
	try {
		const gm = fs.readFileSync(gitmodulesPath, 'utf8');
		const pathRe = /^\s*path\s*=\s*(.+)$/gim;
		let m: RegExpExecArray | null;
		while ((m = pathRe.exec(gm)) !== null) {
			gitmodulePaths.push(toPosix(m[1].trim()));
		}
	} catch { }

	// For each nested git parent, ensure it's not listed in gitmodules and not ignored already
	for (const p of nestedGitParents) {
		if (gitmodulePaths.includes(p)) {
			continue;
		}
		if (isIgnored(p)) {
			continue;
		}
		// As an extra safety check, cd into the directory and ensure it's not referenced in .gitmodules in that subrepo
		try {
			const subGitmodules = path.join(repoRoot, p, '.gitmodules');
			if (fs.existsSync(subGitmodules)) {
				const sub = fs.readFileSync(subGitmodules, 'utf8');
				// if submodule config references back to this path, skip
				if (sub.includes(p)) {
					continue;
				}
			}
		} catch { }
		toAppend.push(`# Added by Autocommiter: ignore nested repo ${p}`);
		toAppend.push(p + '/');
	}

	if (toAppend.length > 0) {
		const toWrite = (existing && existing.trim().length > 0 ? existing + '\n' : '') + toAppend.join('\n') + '\n';
		try {
			fs.writeFileSync(gitignorePath, toWrite, { encoding: 'utf8' });
			vscode.window.showInformationMessage('Autocommiter updated .gitignore to protect sensitive files and nested repos.');
		} catch (e) {
			vscode.window.showWarningMessage('Autocommiter could not update .gitignore automatically. Please ensure .env and docx are ignored and subrepo paths are added.');
		}
	}
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

	const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
	const api = gitExt?.getAPI(1);

	// Helper to get repositories to process
	async function getTrackedRepositories(): Promise<GitRepository[]> {
		if (!api) {
			return [];
		}
		const allRepos = api.repositories;
		const trackedRepoPaths = context.workspaceState.get<string[]>('autocommiter.trackedRepos');
		if (trackedRepoPaths && trackedRepoPaths.length > 0) {
			return allRepos.filter(r => trackedRepoPaths.includes(r.rootUri.toString()));
		}
		return allRepos;
	}

	// Generate commit message command (prototype)
	const generateDisposable = vscode.commands.registerCommand('autocommiter.generateMessage', async () => {
		if (!api) {
			vscode.window.showErrorMessage('Git extension not available.');
			return;
		}

		const repos = await getTrackedRepositories();
		if (repos.length === 0) {
			vscode.window.showErrorMessage('No Git repositories found or selected.');
			return;
		}

		const availableCommands = await vscode.commands.getCommands(true);

		vscode.window.withProgress({ 
			location: vscode.ProgressLocation.Notification, 
			title: 'Autocommit: processing repositories…',
			cancellable: false 
		}, async (progress) => {
			const results: { name: string, success: boolean, error?: string }[] = [];

			for (const repo of repos) {
				const cwd = repo.rootUri?.fsPath;
				if (!cwd) { continue; }
				const repoName = path.basename(cwd);
				
				try {
					let message: string | undefined = '';

					// 1) Stage all changes
					progress.report({ message: `[${repoName}] Ensuring .gitignore safety…` });
					try { await ensureGitignoreSafety(cwd); } catch { }
					progress.report({ message: `[${repoName}] Staging changes…` });
					await runGitCommand('git add .', cwd);

					// 2) Verify staged files exist
					progress.report({ message: `[${repoName}] Checking staged changes…` });
					const staged = (await runGitCommand('git diff --staged --name-only', cwd)).trim();
					if (!staged) {
						continue;
					}

					// 3) Try IDE-specific or Copilot generator
					progress.report({ message: `[${repoName}] Generating commit message (IDE/Copilot)…` });
					message = await tryGenerateFromIDE(repo, availableCommands);

					// 4) If IDE/Copilot failed, try API-key-based inference fallback.
					if (!message) {
						progress.report({ message: `[${repoName}] Generating commit message (API fallback)…` });
						try {
							const apiKey = await getOrPromptApiKey(context);
							if (apiKey) {
								const selectedModel = await getModelForApi(context, apiKey);
								if (selectedModel) {
									const fileChanges = await changesSummarizer.buildFileChanges(cwd);
									const fileNames = fileChanges.map(f => f.file).slice(0, 50).join('\n');
									const compressedJson = changesSummarizer.compressToJson(fileChanges, 400);
									const userPrompt = `reply only with a very concise but informative commit message, and nothing else:\n\nFiles:\n${fileNames}\n\nSummaryJSON:${compressedJson}`;
									try {
										const aiResult = await callInferenceApi(apiKey, userPrompt, selectedModel);
										if (aiResult && aiResult.trim().length > 0) {
											message = aiResult.trim();
										}
									} catch (apiErr) {
										console.error(`[${repoName}] API call failed`, apiErr);
									}
								}
							}
						} catch (e) {
							console.error(`[${repoName}] API key retrieval failed`, e);
						}
					}

					// 5) Fallback generator (local)
					if (!message) {
						const current = repo.inputBox.value || '';
						message = await generateMessageFromContext(current, cwd);
					}

					// Apply gitmoji if enabled
					const config = vscode.workspace.getConfiguration('autocommiter');
					if (isGitmojEnabled(config)) {
						message = getGitmojifiedMessage(message || '');
					}

					// 5) Commit
					progress.report({ message: `[${repoName}] Committing changes…` });
					const tmpFile = path.join(os.tmpdir(), `autocommiter_msg_${Date.now()}_${repoName}.txt`);
					fs.writeFileSync(tmpFile, message || '', { encoding: 'utf8' });
					try {
						await runGitCommand(`git commit -F "${tmpFile.replace(/"/g, '\\"')}"`, cwd);
					} finally {
						try { fs.unlinkSync(tmpFile); } catch { }
					}

					// 6) Push
					progress.report({ message: `[${repoName}] Pushing to remote…` });
					await runGitCommand('git push', cwd);
					
					// 7) Clear the SCM commit input
					try {
						repo.inputBox.value = '';
					} catch (e) { }

					results.push({ name: repoName, success: true });
				} catch (err: any) {
					console.error(`[${repoName}] Autocommit error`, err);
					results.push({ name: repoName, success: false, error: err?.message ?? String(err) });
				}
			}

			// Final summary
			const successful = results.filter(r => r.success);
			const failed = results.filter(r => !r.success);

			if (successful.length > 0) {
				vscode.window.showInformationMessage(`Autocommit successful for: ${successful.map(r => r.name).join(', ')}`);
			}
			if (failed.length > 0) {
				vscode.window.showErrorMessage(`Autocommit failed for: ${failed.map(r => `${r.name} (${r.error})`).join(', ')}`);
			}
			if (successful.length === 0 && failed.length === 0) {
				vscode.window.showInformationMessage('No changes to commit in any repository.');
			}
		});
	});

	context.subscriptions.push(generateDisposable);

	// Select repositories command
	const selectReposDisposable = vscode.commands.registerCommand('autocommiter.selectRepos', async () => {
		if (!api) {
			vscode.window.showErrorMessage('Git extension not available.');
			return;
		}

		const allRepos = api.repositories;
		if (allRepos.length === 0) {
			vscode.window.showInformationMessage('No Git repositories found.');
			return;
		}

		const trackedRepoPaths = context.workspaceState.get<string[]>('autocommiter.trackedRepos') || [];

		const items = allRepos.map(repo => ({
			label: path.basename(repo.rootUri.fsPath),
			description: repo.rootUri.fsPath,
			picked: trackedRepoPaths.length === 0 || trackedRepoPaths.includes(repo.rootUri.toString()),
			uri: repo.rootUri.toString()
		}));

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: 'Select repositories to track for autocommit (leave empty to track all)'
		});

		if (selected) {
			const newTrackedPaths = selected.map(s => s.uri);
			await context.workspaceState.update('autocommiter.trackedRepos', newTrackedPaths);
			if (newTrackedPaths.length === 0) {
				vscode.window.showInformationMessage('Autocommit will now track all repositories in the workspace.');
			} else {
				vscode.window.showInformationMessage(`Autocommit is now tracking ${newTrackedPaths.length} selected repositories.`);
			}
		}
	});
	context.subscriptions.push(selectReposDisposable);

	// Refresh models command (fetches from API and caches)
	const refreshModelsDisposable = vscode.commands.registerCommand('autocommiter.refreshModels', async () => {
		try {
			const apiKey = await getOrPromptApiKey(context);
			if (!apiKey) {
				vscode.window.showWarningMessage('API key is required to fetch models. Please provide it when prompted.');
				return;
			}

			vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Autocommiter: Fetching models…' }, async (progress) => {
				progress.report({ message: 'Fetching available models from GitHub Models API…' });
				const result = await refreshModelList(context, apiKey);

				if (result.success) {
					vscode.window.showInformationMessage(`✓ ${result.message}`);
				} else {
					vscode.window.showErrorMessage(`✗ ${result.message}`);
				}
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Failed to refresh models: ${msg}`);
		}
	});
	context.subscriptions.push(refreshModelsDisposable);

	// Select model command (shows model picker UI)
	const selectModelDisposable = vscode.commands.registerCommand('autocommiter.selectModel', async () => {
		try {
			const apiKey = await getOrPromptApiKey(context);
			if (!apiKey) {
				vscode.window.showWarningMessage('API key is required to select a model. Please provide it when prompted.');
				return;
			}

			const selection = await getModelForApi(context, apiKey, true);
			if (selection) {
				vscode.window.showInformationMessage(`✓ Model selected: ${selection}`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Failed to select model: ${msg}`);
		}
	});
	context.subscriptions.push(selectModelDisposable);

	// Status bar item (wand emoji) placed near the right
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	status.text = '🪄 Autocommit';
	status.command = 'autocommiter.generateMessage';
	status.tooltip = 'Autocommit — generate a commit message using Autocommiter';
	status.show();
	context.subscriptions.push(status);
}

// This method is called when your extension is deactivated
export function deactivate() { }

// Very small heuristic generator — placeholder for integrating with GitHub/Copilot APIs.
async function generateMessageFromContext(currentInput: string, repoRoot?: string): Promise<string> {
	// If user already typed something, preserve it verbatim
	if (currentInput && currentInput.trim().length > 0) {
		return currentInput.trim();
	}

	// Otherwise craft a short, generic message. In future this should inspect staged changes or call GitHub/Copilot.
	return 'chore: automated commit generated by Autocommiter';
}
