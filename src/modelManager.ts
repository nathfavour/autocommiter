import * as vscode from 'vscode';
import * as https from 'https';

export interface ModelInfo {
	id: string;
	name: string;
	status: 'available' | 'preview' | 'experimental';
}

const DEFAULT_MODELS: ModelInfo[] = [
	{ id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Cost-effective)', status: 'available' },
	{ id: 'gpt-4o', name: 'GPT-4o (High Quality)', status: 'available' },
	{ id: 'Meta-Llama-3.1-405B-Instruct', name: 'Meta Llama 3.1 405B', status: 'available' },
	{ id: 'Meta-Llama-3.1-70B-Instruct', name: 'Meta Llama 3.1 70B', status: 'available' },
	{ id: 'Mistral-large', name: 'Mistral Large', status: 'available' },
	{ id: 'Mistral-small', name: 'Mistral Small', status: 'available' },
	{ id: 'Cohere-command-r-plus', name: 'Cohere Command R+', status: 'available' },
];

/**
 * Fetch available models from GitHub Models API
 */
export async function fetchAvailableModels(apiKey: string): Promise<ModelInfo[]> {
	return new Promise((resolve, reject) => {
		const url = new URL('https://models.inference.ai.azure.com/models');
		const opts: https.RequestOptions = {
			method: 'GET',
			hostname: url.hostname,
			path: url.pathname,
			headers: {
				'Authorization': `Bearer ${apiKey}`
			}
		};

		const req = https.request(opts, res => {
			let body = '';
			res.on('data', d => body += d);
			res.on('end', () => {
				try {
					const json = JSON.parse(body);
					if (json.data && Array.isArray(json.data)) {
						const models = json.data
							.filter((m: any) => m.id && m.status)
							.map((m: any) => ({
								id: m.id,
								name: m.id,
								status: m.status as 'available' | 'preview' | 'experimental'
							}));
						resolve(models);
					} else {
						resolve(DEFAULT_MODELS);
					}
				} catch (e) {
					// If parsing fails, return defaults
					resolve(DEFAULT_MODELS);
				}
			});
		});

		req.on('error', err => {
			// On network error, return defaults
			resolve(DEFAULT_MODELS);
		});
		req.end();
	});
}

/**
 * Get the cached models from workspace state
 */
export function getCachedModels(context: vscode.ExtensionContext): ModelInfo[] {
	const cached = context.workspaceState.get<ModelInfo[]>('autocommiter.cachedModels');
	return cached || DEFAULT_MODELS;
}

/**
 * Update the cached models in workspace state
 */
export async function updateCachedModels(context: vscode.ExtensionContext, models: ModelInfo[]): Promise<void> {
	await context.workspaceState.update('autocommiter.cachedModels', models);
}

/**
 * Get the currently selected model ID from settings
 */
export function getSelectedModelId(context: vscode.ExtensionContext): string {
	const config = vscode.workspace.getConfiguration('autocommiter');
	const selected = config.get<string>('selectedModel', '');
	if (selected) {
		return selected;
	}
	// Default to GPT-4o Mini
	return 'gpt-4o-mini';
}

/**
 * Set the selected model ID in settings
 */
export async function setSelectedModelId(modelId: string): Promise<void> {
	const config = vscode.workspace.getConfiguration('autocommiter');
	await config.update('selectedModel', modelId, vscode.ConfigurationTarget.Global);
}

/**
 * Show model selection quick pick
 */
export async function showModelSelectionPicker(
	context: vscode.ExtensionContext,
	apiKey: string,
	allowPersist: boolean = true
): Promise<{ modelId: string; persistent: boolean } | undefined> {
	try {
		// Fetch fresh models from API
		const freshModels = await fetchAvailableModels(apiKey);
		if (freshModels.length > 0) {
			await updateCachedModels(context, freshModels);
		}
	} catch (e) {
		// Use cached models if fetch fails
		console.log('Autocommiter: could not fetch fresh models, using cached');
	}

	const models = getCachedModels(context);
	const currentModelId = getSelectedModelId(context);

	const items = models.map(m => ({
		label: m.id,
		description: m.name,
		detail: `Status: ${m.status}${m.id === currentModelId ? ' (Currently Selected)' : ''}`,
		modelInfo: m
	}));

	const pick = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a model for this commit message',
		matchOnDescription: true,
		matchOnDetail: true
	});

	if (!pick) {
		return undefined;
	}

	let persistent = false;
	if (allowPersist) {
		const persistChoice = await vscode.window.showQuickPick(
			[
				{
					label: 'Use for this commit only',
					detail: 'Will use this model for this commit and fall back to settings default next time',
					persist: false
				},
				{
					label: 'Save as default',
					detail: 'Will always use this model unless you change it in settings',
					persist: true
				}
			],
			{ placeHolder: 'How would you like to use this model?' }
		);

		if (!persistChoice) {
			return undefined;
		}
		persistent = persistChoice.persist;
	}

	return {
		modelId: pick.modelInfo.id,
		persistent
	};
}

/**
 * Get the model to use for API calls (with automatic selection flow if needed)
 */
export async function getModelForApi(
	context: vscode.ExtensionContext,
	apiKey: string,
	forceSelection: boolean = false
): Promise<string | undefined> {
	// First, try to update the model list
	try {
		const freshModels = await fetchAvailableModels(apiKey);
		if (freshModels.length > 0) {
			await updateCachedModels(context, freshModels);
		}
	} catch (e) {
		// Use cached models if fetch fails
		console.log('Autocommiter: could not fetch fresh models, using cached');
	}

	const selectedModelId = getSelectedModelId(context);

	// If model is already selected and we're not forcing, use it
	if (selectedModelId && !forceSelection) {
		return selectedModelId;
	}

	// Otherwise, show the picker
	const selection = await showModelSelectionPicker(context, apiKey, true);

	if (!selection) {
		return undefined;
	}

	// If user chose to persist, save it
	if (selection.persistent) {
		await setSelectedModelId(selection.modelId);
	}

	return selection.modelId;
}
