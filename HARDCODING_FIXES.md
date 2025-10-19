# Hardcoding Removal - Complete Softcoding Implementation

## Problem Identified
The extension had a hardcoded model reference `openai/gpt-4.1` that was causing catastrophic failures whenever users attempted to select different models. The model selection improvements were added but the API call was still using the hardcoded string.

## Root Cause
The `callInferenceApi()` function in `extension.ts` was hardcoded with:
```typescript
model: 'openai/gpt-4.1'
```

This meant that even when users selected different models via the new command palette UX, the API was always called with `gpt-4.1`, leading to errors and failures.

## Solution: Complete Softcoding

### Changes Made

#### 1. **Updated `callInferenceApi()` Function Signature**
**File:** `src/extension.ts` (line ~77)

**Before:**
```typescript
function callInferenceApi(apiKey: string, userPrompt: string): Promise<string> {
    const payload = JSON.stringify({
        // ...
        model: 'openai/gpt-4.1'
    });
}
```

**After:**
```typescript
function callInferenceApi(apiKey: string, userPrompt: string, model: string): Promise<string> {
    const payload = JSON.stringify({
        // ...
        model: model  // Now accepts dynamic model parameter
    });
}
```

#### 2. **Updated API Fallback Flow**
**File:** `src/extension.ts` (lines ~374-404)

**Before:**
```typescript
if (apiKey) {
    // Build prompt...
    try {
        const aiResult = await callInferenceApi(apiKey, userPrompt);  // ❌ No model passed
        // ...
    }
}
```

**After:**
```typescript
if (apiKey) {
    // Get the model to use from settings/cache (uses modelManager)
    const selectedModel = await getModelForApi(context, apiKey);
    if (!selectedModel) {
        console.log('Autocommiter: no model selected, skipping API fallback.');
    } else {
        // Build prompt...
        try {
            const aiResult = await callInferenceApi(apiKey, userPrompt, selectedModel);  // ✅ Passes selected model
            if (aiResult && aiResult.trim().length > 0) {
                message = aiResult.trim();
                vscode.window.showInformationMessage(`Autocommit used ${selectedModel} to generate the commit message.`);
            }
        }
    }
}
```

### How Softcoding Works Now

1. **User triggers commit generation** → Goes through full workflow
2. **Copilot unavailable** → Tries API fallback
3. **Call `getModelForApi()`** → Retrieves user's selected model from:
   - User's persistent selection in settings (`autocommiter.selectedModel`)
   - Cached models from GitHub Models API
   - Default fallback (`gpt-4o-mini`)
4. **Pass model to API** → `callInferenceApi()` receives the user's chosen model
5. **API call succeeds** → Uses the correct model dynamically

### Benefits

✅ **No More Hardcoding** - All model references come from user configuration  
✅ **Dynamic Model Selection** - Users can change models anytime via:
- `Autocommiter: Select Model` command
- VS Code Settings UI  
- `autocommiter.selectedModel` config property

✅ **Respects User Preference** - API calls use whatever model the user selected  
✅ **Graceful Fallbacks** - If model selection fails, falls back to local generator  
✅ **Clear Feedback** - User sees which model was used in success/error messages  

### Testing Checklist

- [x] TypeScript compilation passes (`pnpm run check-types`)
- [x] ESLint passes (`pnpm run lint`)
- [x] No hardcoded model strings remain in source code
- [x] `callInferenceApi()` signature requires model parameter
- [x] Model is retrieved dynamically before API call
- [x] Error messages show the selected model

### Related Files Modified

1. **`src/extension.ts`**
   - Updated `callInferenceApi()` signature
   - Updated API fallback flow to get and pass model dynamically
   - Added feedback showing which model was used

2. **`src/modelManager.ts`** (previously updated)
   - Provides `getModelForApi()` function
   - Handles model selection from cache/settings

3. **`package.json`** (previously updated)
   - Defines `autocommiter.selectedModel` configuration
   - Provides command palette entries for model management

## Migration Note

Existing installations will:
- Automatically use `gpt-4o-mini` as default (if no model was previously selected)
- Fall back to intelligent model selection flow if needed
- Have full ability to override via settings or command palette

No data loss or configuration breakage occurs.
