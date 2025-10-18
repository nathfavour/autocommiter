import { exec } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import changesSummarizer from './changesSummarizer';
import * as modelManager from './modelManager';

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

// Normalize path to posix relative path from repoRoot
function toPosix(rel: string) {
	return rel.split(path.sep).join('/');
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

function callInferenceApi(apiKey: string, userPrompt: string, model: string = 'gpt-4o-mini'): Promise<string> {
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
				// Safety: ensure .gitignore has protections before staging
				progress.report({ message: 'Ensuring .gitignore safety…' });
				try { await ensureGitignoreSafety(cwd); } catch { }
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
				let copilotFailed = false;
				try {
					const copilotResult = await vscode.commands.executeCommand('github.copilot.git.generateCommitMessage');
					if (copilotResult && typeof copilotResult === 'string' && copilotResult.trim().length > 0) {
						message = copilotResult.trim();
						vscode.window.showInformationMessage('Autocommit used Copilot to generate the commit message.');
					}
				} catch (e) {
					copilotFailed = true;
				}

				// 4) If Copilot failed, silently try API-key-based inference fallback.
				// Prompt only if there is no stored API key (getOrPromptApiKey will prompt and store).
				if (!message && copilotFailed) {
					progress.report({ message: 'Generating commit message (API fallback)…' });
					try {
						const apiKey = await getOrPromptApiKey(context);
						// If user didn't provide a key (they cancelled the prompt), abandon the API fallback silently
						if (apiKey) {
							// Get the model to use (may prompt user if this is first time or on force selection)
							const selectedModel = await modelManager.getModelForApi(context, apiKey, false);
							if (!selectedModel) {
								console.log('Autocommiter: user cancelled model selection');
								vscode.window.showInformationMessage('Model selection cancelled. Falling back to local generator.');
							} else {
								// Build per-file changes and a compressed JSON payload (<=400 chars) to include with the prompt
								const fileChanges = await changesSummarizer.buildFileChanges(cwd);
								const fileNames = fileChanges.map(f => f.file).slice(0, 50).join('\n');
								const compressedJson = changesSummarizer.compressToJson(fileChanges, 400);
								const userPrompt = `reply only with a very concise but informative commit message, and nothing else:\n\nFiles:\n${fileNames}\n\nSummaryJSON:${compressedJson}`;
								try {
									const aiResult = await callInferenceApi(apiKey, userPrompt, selectedModel);
									if (aiResult && aiResult.trim().length > 0) {
										message = aiResult.trim();
										vscode.window.showInformationMessage(`Autocommit used ${selectedModel} to generate the commit message.`);
									}
								} catch (apiErr) {
									console.error('Autocommiter API call failed', apiErr);
									const errMsg = (apiErr as Error)?.message ?? String(apiErr);
									vscode.window.showWarningMessage(`API generation failed (${selectedModel}): ${errMsg}. Falling back to local generator.`);
								}
							}
						} else {
							// no key available; skip silently and fall back to local generator
							console.log('Autocommiter: no API key available, skipping API fallback.');
						}
					} catch (e) {
						console.error('Autocommiter API key retrieval failed', e);
						vscode.window.showWarningMessage('Failed to retrieve API key. Falling back to local generator.');
					}
				}

				// 5) Fallback generator (local)
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
					try { fs.unlinkSync(tmpFile); } catch { }
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
