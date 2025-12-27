# Integrating GitHub Models with JavaScript

This guide details how to integrate GitHub's hosted models into any JavaScript or TypeScript application using standard Node.js modules, as implemented in this project.

## 1. Authentication
All requests require a GitHub Personal Access Token (PAT) with appropriate permissions.
- **Header**: `Authorization: Bearer <YOUR_GITHUB_TOKEN>`

## 2. Fetching Available Models
To get a list of available chat-completion models, use the models endpoint.

- **Endpoint**: `https://models.inference.ai.azure.com/models`
- **Method**: `GET`
- **Headers**:
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`

### Implementation Example (Node.js `https`)
```javascript
const https = require('https');

async function fetchModels(apiKey) {
    const options = {
        hostname: 'models.inference.ai.azure.com',
        path: '/models',
        method: 'GET',
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${apiKey}`,
            'X-GitHub-Api-Version': '2022-11-28'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const models = JSON.parse(data);
                // Filter for chat-completion models
                resolve(models.filter(m => m.task === 'chat-completion'));
            });
        });
        req.on('error', reject);
        req.end();
    });
}
```

## 3. Generating Chat Completions
To generate responses (e.g., commit messages), send a POST request to the completions endpoint.

- **Endpoint**: `https://models.inference.ai.azure.com/chat/completions`
- **Method**: `POST`
- **Payload Structure**:
  ```json
  {
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Your prompt here" }
    ],
    "model": "gpt-4o-mini",
    "temperature": 1,
    "max_tokens": 4096
  }
  ```

### Implementation Example (Node.js `https`)
```javascript
async function callInference(apiKey, model, prompt) {
    const payload = JSON.stringify({
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: prompt }
        ],
        model: model
    });

    const options = {
        hostname: 'models.inference.ai.azure.com',
        path: '/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': `Bearer ${apiKey}`
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const json = JSON.parse(data);
                if (json.choices && json.choices[0]) {
                    resolve(json.choices[0].message.content);
                } else {
                    reject(new Error('Unexpected response format'));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
```

## 4. Key Considerations
- **Model IDs**: When calling the completions API, use the `name` field returned from the models list (e.g., `gpt-4o-mini`).
- **Error Handling**: Always check for `json.error` in the response body, as the API may return a 200 OK with an error object for certain failures.
- **Streaming**: While not shown here, the API supports Server-Sent Events (SSE) if `"stream": true` is added to the payload.
