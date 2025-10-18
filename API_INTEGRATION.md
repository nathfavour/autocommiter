# API Integration Guide - GitHub Models

## Real API Response Structure

The GitHub Models API at `https://models.inference.ai.azure.com/models` returns an **array of model objects directly** (not wrapped in a data property).

### Example Response Entry

```json
{
  "id": "azureml://registries/azure-openai/models/gpt-4o-mini/versions/1",
  "name": "gpt-4o-mini",
  "friendly_name": "OpenAI GPT-4o mini",
  "model_version": 1,
  "publisher": "Azure OpenAI Service",
  "model_family": "OpenAI",
  "model_registry": "azure-openai",
  "license": "custom",
  "task": "chat-completion",
  "description": "...",
  "summary": "An affordable, efficient AI solution for diverse text and image tasks.",
  "tags": ["multipurpose", "multilingual", "multimodal"]
}
```

### Key Fields Used by Autocommiter

- **`name`** (string): Model identifier used in API calls (e.g., `gpt-4o-mini`, `gpt-4o`)
- **`friendly_name`** (string): Human-readable name for UI display
- **`publisher`** (string): Organization that provides the model
- **`summary`** (string): Short description shown in model picker
- **`task`** (string): Model capability type (we filter for `chat-completion`)
- **`tags`** (string[]): Model characteristics (e.g., `["multipurpose", "multilingual"]`)

## API Request Headers

The extension now includes proper GitHub API headers:

```typescript
headers: {
  'Accept': 'application/vnd.github+json',
  'Authorization': `Bearer ${apiKey}`,
  'X-GitHub-Api-Version': '2022-11-28'
}
```

These headers ensure:
- Correct API version negotiation
- Proper authentication
- GitHub API compatibility

## Model Listing Flow

### 1. Fetching Models

```typescript
// Uses GET https://models.inference.ai.azure.com/models
const response = await fetch(endpoint, {
  method: 'GET',
  headers: {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${apiKey}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }
});
```

**Response**: Direct array of model objects

### 2. Filtering

The extension filters for chat-completion models only:

```typescript
json
  .filter((m: any) => m.id && m.name && m.task === 'chat-completion')
  .map(...)
```

This ensures only suitable models appear in selection (excludes embeddings, etc.)

### 3. Transformation

Raw API response is transformed to `ModelInfo`:

```typescript
{
  id: m.name,                    // 'gpt-4o-mini'
  name: m.name,                  // 'gpt-4o-mini'
  friendly_name: m.friendly_name, // 'OpenAI GPT-4o mini'
  publisher: m.publisher,         // 'Azure OpenAI Service'
  summary: m.summary,             // 'An affordable, efficient...'
  task: m.task,                   // 'chat-completion'
  tags: m.tags                    // ['multipurpose', 'multilingual']
}
```

**Note**: `id` field stores the `name` value because `name` is what gets passed to chat/completions API

## Model Selection UI

The quick pick displays models beautifully:

```
Label:       gpt-4o-mini
Description: OpenAI GPT-4o mini
Detail:      An affordable, efficient AI solution for diverse text and image tasks (Currently Selected)
```

## Chat Completions API Call

When generating commit messages, the extension calls:

```
POST https://models.inference.ai.azure.com/chat/completions
```

With:
- **Model**: The selected `name` field (e.g., `gpt-4o-mini`)
- **Headers**: Same GitHub API headers
- **Body**:
  ```json
  {
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "...commit context..."}
    ],
    "model": "gpt-4o-mini"
  }
  ```

**Expected Response**:

```json
{
  "choices": [
    {
      "message": {
        "content": "feat: add model selection UI for better ergonomics"
      }
    }
  ]
}
```

## Default Models (Fallback)

When API fetch fails, these models are used:

1. **gpt-4o-mini** - Fast & cost-effective (default)
2. **gpt-4o** - High quality, most capable
3. **Phi-3-mini-128k-instruct** - Lightweight, efficient
4. **Mistral-large** - Powerful open-source

These are pre-configured in the extension for reliability.

## Error Handling

The extension gracefully handles:

1. **Network errors** → Use cached/default models
2. **Parse errors** → Log error, use defaults
3. **Model filter returns empty** → Use defaults
4. **API timeout** → Return defaults silently

Users never see errors; they always get a working experience.

## Data Flow Diagram

```
User clicks Autocommit
        ↓
API Key exists? → No → Prompt for API key
        ↓ Yes
Fetch models from /models endpoint
        ↓
Parse JSON array, filter for chat-completion
        ↓
Transform to ModelInfo objects
        ↓
Cache in workspace state
        ↓
Show quick pick with friendly_name + summary
        ↓
User selects model
        ↓
Call /chat/completions with selected model.name
        ↓
Extract message.content from response
        ↓
Use as commit message
```

## Why These Changes?

### Previous Implementation Issues:
- Assumed wrong API response format (.data wrapper)
- Used wrong headers (missing Accept, X-GitHub-Api-Version)
- Wrong field for model status (no .status in real API)
- Created artificial model names that don't match real API

### Fixed In This Update:
- ✅ Correctly parses direct array response
- ✅ Includes proper GitHub API headers
- ✅ Filters by actual `task` field (chat-completion)
- ✅ Uses real model names from API (`name` field)
- ✅ Beautiful UI with friendly_name and summary
- ✅ Proper error handling with sensible defaults

## Testing the API Manually

```bash
# List all available models
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://models.inference.ai.azure.com/models | jq '.'

# List only chat-completion models
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://models.inference.ai.azure.com/models | jq '.[] | select(.task == "chat-completion")'

# Call chat completions with a model
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "model": "gpt-4o-mini"
  }' \
  https://models.inference.ai.azure.com/chat/completions
```
