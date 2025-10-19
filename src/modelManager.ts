import * as vscode from 'vscode';
import * as https from 'https';

export interface ModelInfo {
    id: string;
    name: string;
    friendly_name?: string;
    publisher?: string;
    summary?: string;
    task?: string;
    tags?: string[];
}

// Curated list of common chat-completion models for defaults
const DEFAULT_MODELS: ModelInfo[] = [
    { id: 'gpt-4o-mini', name: 'gpt-4o-mini', friendly_name: 'OpenAI GPT-4o mini', summary: 'Fast & cost-effective, great for most tasks', publisher: 'Azure OpenAI Service' },
    { id: 'gpt-4o', name: 'gpt-4o', friendly_name: 'OpenAI GPT-4o', summary: 'High quality, most capable model', publisher: 'Azure OpenAI Service' },
    { id: 'Phi-3-mini-128k-instruct', name: 'Phi-3-mini-128k-instruct', friendly_name: 'Phi-3 mini 128k', summary: 'Lightweight, efficient open model', publisher: 'Microsoft' },
    { id: 'Mistral-large', name: 'Mistral-large', friendly_name: 'Mistral Large', summary: 'Powerful open-source model', publisher: 'Mistral AI' },
];/**
 * Fetch available models from GitHub Models API
 * API returns array of models directly (not wrapped in .data)
 */
export async function fetchAvailableModels(apiKey: string): Promise<ModelInfo[]> {
    return new Promise((resolve, reject) => {
        const url = new URL('https://models.inference.ai.azure.com/models');
        const opts: https.RequestOptions = {
            method: 'GET',
            hostname: url.hostname,
            path: url.pathname,
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${apiKey}`,
                'X-GitHub-Api-Version': '2022-11-28'
            }
        };

        const req = https.request(opts, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    // API returns array directly
                    if (Array.isArray(json)) {
                        const models = json
                            .filter((m: any) => m.id && m.name && m.task === 'chat-completion')
                            .map((m: any) => ({
                                id: m.name, // Use 'name' field as the model ID for API calls
                                name: m.name,
                                friendly_name: m.friendly_name || m.name,
                                publisher: m.publisher,
                                summary: m.summary,
                                task: m.task,
                                tags: m.tags
                            }));
                        resolve(models);
                    } else {
                        resolve(DEFAULT_MODELS);
                    }
                } catch (e) {
                    // If parsing fails, return defaults
                    console.error('Autocommiter: failed to parse models response', e);
                    resolve(DEFAULT_MODELS);
                }
            });
        });

        req.on('error', err => {
            // On network error, return defaults
            console.error('Autocommiter: failed to fetch models', err);
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
 * Show model selection quick pick (uses cached models only)
 */
export async function showModelSelectionPicker(
    context: vscode.ExtensionContext,
    apiKey: string,
    allowPersist: boolean = true
): Promise<{ modelId: string; persistent: boolean } | undefined> {
    // Use only cached models; don't fetch automatically
    // User should refresh via 'Autocommiter: Refresh Models' command if needed
    const models = getCachedModels(context);
    const currentModelId = getSelectedModelId(context);

    const items = models.map(m => ({
        label: m.name,
        description: m.friendly_name || m.name,
        detail: `${m.summary || ''}${m.id === currentModelId ? ' (Currently Selected)' : ''}`.trim(),
        modelInfo: m
    })); const pick = await vscode.window.showQuickPick(items, {
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
 * Fetch and cache available models (for manual refresh via command palette)
 */
export async function refreshModelList(context: vscode.ExtensionContext, apiKey: string): Promise<{ success: boolean; message: string; count?: number }> {
    try {
        const freshModels = await fetchAvailableModels(apiKey);
        if (freshModels.length > 0) {
            await updateCachedModels(context, freshModels);
            return {
                success: true,
                message: `Successfully fetched and cached ${freshModels.length} models`,
                count: freshModels.length
            };
        } else {
            return {
                success: false,
                message: 'No chat-completion models found in the API response'
            };
        }
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        return {
            success: false,
            message: `Failed to fetch models: ${errorMsg}`
        };
    }
}

/**
 * Get the model to use for API calls (without automatic fetching)
 * User must manually refresh models via command palette
 */
export async function getModelForApi(
    context: vscode.ExtensionContext,
    apiKey: string,
    forceSelection: boolean = false
): Promise<string | undefined> {
    // Don't auto-fetch; rely on cached models
    // User controls refresh manually via command palette

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
