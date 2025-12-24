#!/bin/bash

# ai.sh - A reference implementation for interacting with GitHub Models API via CLI
# This script demonstrates how to send a prompt to GitHub's hosted models.

# Usage:
#   export GITHUB_TOKEN="your_token_here"
#   ./ai.sh "Write a commit message for adding a login feature" [model_name]

# Default model if none provided
MODEL="${2:-gpt-4o-mini}"
PROMPT="$1"

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN environment variable is not set."
    echo "Get one from https://github.com/settings/tokens"
    exit 1
fi

if [ -z "$PROMPT" ]; then
    echo "Usage: ./ai.sh \"your prompt\" [model]"
    exit 1
fi

# API Endpoint
ENDPOINT="https://models.inference.ai.azure.com/chat/completions"

# Construct the JSON payload
# We use a system message to set the persona and a user message for the prompt.
PAYLOAD=$(cat <<EOF
{
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant that provides concise and accurate responses."
    },
    {
      "role": "user",
      "content": "$PROMPT"
    }
  ],
  "model": "$MODEL",
  "temperature": 1,
  "max_tokens": 4096,
  "top_p": 1
}
EOF
)

# Make the API call using curl
# -s: Silent mode
# -X POST: Use POST method
# -H: Headers for Content-Type and Authorization
# -d: The JSON payload
RESPONSE=$(curl -s -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -d "$PAYLOAD")

# Check for errors in the response
if echo "$RESPONSE" | grep -q "\"error\""; then
    echo "API Error:"
    echo "$RESPONSE" | grep -o '"message":"[^"]*"' | cut -d'"' -f4
    exit 1
fi

# Extract the content from the response
# If jq is installed, use it for clean parsing. Otherwise, use a simple sed/grep fallback.
if command -v jq >/dev/null 2>&1; then
    echo "$RESPONSE" | jq -r '.choices[0].message.content'
else
    # Fallback parsing (less robust than jq)
    echo "$RESPONSE" | grep -o '"content":"[^"]*"' | head -n 1 | cut -d'"' -f4 | sed 's/\\n/\n/g'
fi
