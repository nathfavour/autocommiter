/**
 * Gitmoji support for Autocommiter
 * Provides intelligent fuzzy matching of commits to gitmojis
 * and optional gitmoji prefixing for commit messages
 */

import * as vscode from 'vscode';

export interface Gitmoji {
	emoji: string;
	code: string;
	description: string;
	keywords: string[];
}

// Curated list of common gitmojis with keywords for intelligent matching
const GITMOJIS: Gitmoji[] = [
	{ emoji: '🎨', code: ':art:', description: 'Improve structure/format', keywords: ['format', 'structure', 'style', 'lint'] },
	{ emoji: '⚡', code: ':zap:', description: 'Improve performance', keywords: ['performance', 'speed', 'optimize', 'fast'] },
	{ emoji: '🔥', code: ':fire:', description: 'Remove code/files', keywords: ['remove', 'delete', 'clean', 'unused'] },
	{ emoji: '🐛', code: ':bug:', description: 'Fix bug', keywords: ['fix', 'bug', 'issue', 'error', 'crash'] },
	{ emoji: '✨', code: ':sparkles:', description: 'New feature', keywords: ['feature', 'new', 'add', 'implement'] },
	{ emoji: '📝', code: ':memo:', description: 'Add documentation', keywords: ['docs', 'documentation', 'comment', 'readme'] },
	{ emoji: '🚀', code: ':rocket:', description: 'Deploy stuff', keywords: ['deploy', 'release', 'publish', 'launch'] },
	{ emoji: '💅', code: ':nail_care:', description: 'Polish code', keywords: ['polish', 'refine', 'improve'] },
	{ emoji: '✅', code: ':white_check_mark:', description: 'Add tests', keywords: ['test', 'tests', 'testing'] },
	{ emoji: '🔐', code: ':lock:', description: 'Security fix', keywords: ['security', 'auth', 'encrypt'] },
	{ emoji: '⬆️', code: ':arrow_up:', description: 'Upgrade dependencies', keywords: ['upgrade', 'update', 'dependency', 'dependencies'] },
	{ emoji: '⬇️', code: ':arrow_down:', description: 'Downgrade dependencies', keywords: ['downgrade'] },
	{ emoji: '📦', code: ':package:', description: 'Update packages', keywords: ['package', 'npm', 'yarn', 'bundler'] },
	{ emoji: '🔧', code: ':wrench:', description: 'Configuration', keywords: ['config', 'configuration', 'settings'] },
	{ emoji: '🌐', code: ':globe_with_meridians:', description: 'i18n/localization', keywords: ['i18n', 'translation', 'locale', 'language'] },
	{ emoji: '♿', code: ':wheelchair:', description: 'Accessibility', keywords: ['accessibility', 'a11y', 'aria'] },
	{ emoji: '🚨', code: ':rotating_light:', description: 'Fix warnings', keywords: ['warning', 'lint', 'warning'] },
	{ emoji: '🔍', code: ':mag:', description: 'SEO', keywords: ['seo'] },
	{ emoji: '🍎', code: ':apple:', description: 'macOS fix', keywords: ['macos', 'mac', 'apple'] },
	{ emoji: '🐧', code: ':penguin:', description: 'Linux fix', keywords: ['linux', 'ubuntu'] },
	{ emoji: '🪟', code: ':window:', description: 'Windows fix', keywords: ['windows'] },
];

/**
 * Simple fuzzy search score (0-100)
 * Checks for keyword matches and string similarity
 */
function calculateFuzzyScore(commitMessage: string, gitmoji: Gitmoji): number {
	const msg = commitMessage.toLowerCase();
	let score = 0;

	// Keyword matching (primary scoring)
	for (const keyword of gitmoji.keywords) {
		if (msg.includes(keyword)) {
			score += 40; // High score for keyword match
		}
		// Partial matches (e.g., "bug" matches "buggy")
		if (msg.includes(keyword.substring(0, 3))) {
			score += 10;
		}
	}

	// Description matching (secondary scoring)
	const descWords = gitmoji.description.toLowerCase().split(' ');
	for (const word of descWords) {
		if (msg.includes(word) && word.length > 2) {
			score += 15;
		}
	}

	// Cap score at 100
	return Math.min(score, 100);
}

/**
 * Find the best matching gitmoji for a commit message
 * Returns the gitmoji with highest score, or undefined if no good match
 */
export function findBestGitmoji(commitMessage: string): Gitmoji | undefined {
	if (!commitMessage || commitMessage.trim().length === 0) {
		return undefined;
	}

	let bestGitmoji: Gitmoji | undefined;
	let bestScore = 30; // Minimum threshold for a "good" match

	for (const gitmoji of GITMOJIS) {
		const score = calculateFuzzyScore(commitMessage, gitmoji);
		if (score > bestScore) {
			bestScore = score;
			bestGitmoji = gitmoji;
		}
	}

	return bestGitmoji;
}

/**
 * Get a random gitmoji (used when no good match is found)
 */
export function getRandomGitmoji(): Gitmoji {
	return GITMOJIS[Math.floor(Math.random() * GITMOJIS.length)];
}

/**
 * Prepend gitmoji to commit message
 * Format: "emoji message"
 */
export function prependGitmoji(commitMessage: string, gitmoji: Gitmoji): string {
	return `${gitmoji.emoji} ${commitMessage}`;
}

/**
 * Get a gitmoji-prefixed commit message
 * Uses fuzzy search to find best match, falls back to random if no match
 */
export function getGitmojifiedMessage(commitMessage: string): string {
	const bestMatch = findBestGitmoji(commitMessage);
	const gitmoji = bestMatch || getRandomGitmoji();
	return prependGitmoji(commitMessage, gitmoji);
}

/**
 * Check if gitmoji is enabled in settings
 */
export function isGitmojEnabled(config: vscode.WorkspaceConfiguration): boolean {
	return config.get<boolean>('enableGitmoji', false);
}
