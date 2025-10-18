# Bug Analysis: "No-op" Commit Messages on Code Changes

## Problem
Users are getting commit messages like:
- "chore: record workspace snapshot (no-op, no code changes)"
- "chore: no-op commit to record workspace state (no code changes)"
- "chore: no-op commit — no code changes"

**EVEN WHEN there are clear code changes in multiple files.**

## Root Causes Identified

### 1. **Aggressive JSON Compression Loses All Context**

In `extension.ts` line 391:
```typescript
const compressedJson = changesSummarizer.compressToJson(fileChanges, 400);
```

The `compressToJson()` function in `changesSummarizer.ts` has a critical flaw:
- It tries to fit file changes into 400 characters
- When it gets too long, it progressively shortens each change: `"10+/5-"` → `"10+/5"` → `"10+/"` → `"1"`
- **If still too long, it drops files from the end**
- **In worst case, it returns `{ files: [] }` - COMPLETELY EMPTY**

When the API receives this:
```
Files:
file1.ts
file2.ts
file3.ts

SummaryJSON:{"files":[]}
```

The API sees empty file summary and thinks "no code changes provided" → generates "no-op" message.

### 2. **compressToJson Returns Empty Array as Last Resort**

Line 87 in `changesSummarizer.ts`:
```typescript
// As a last resort, return an empty files array
return JSON.stringify({ files: [] });
```

This is the smoking gun! When compression fails, it silently returns empty instead of providing ANY information.

### 3. **Prompt Doesn't Handle Missing Context**

Line 392 in `extension.ts`:
```typescript
const userPrompt = `reply only with a very concise but informative commit message, and nothing else:\n\nFiles:\n${fileNames}\n\nSummaryJSON:${compressedJson}`;
```

If `compressedJson` is empty, the prompt becomes:
```
reply only with a very concise but informative commit message, and nothing else:

Files:
file1.ts
file2.ts

SummaryJSON:{"files":[]}
```

The LLM sees "files: []" (empty) and interprets it as "no actual changes provided" → generates "no-op" message.

### 4. **File Names Might Also Be Compressed Away**

Line 391 in `extension.ts`:
```typescript
const fileNames = fileChanges.map(f => f.file).slice(0, 50).join('\n');
```

The `.slice(0, 50)` limits to 50 files. With many files:
```
Files:
file1.ts
file2.ts
... (50 files later, rest cut off)
```

Plus if `compressedJson` is empty, the model has minimal context.

## Why This Happens

**Scenario: Large number of file changes**

1. User stages changes to 100+ files
2. `buildFileChanges()` analyzes all 100+ files
3. Each file has change info: `"15+/8-"`, `"42+/3-"`, etc.
4. `compressToJson({ files: [...100 items...] }, 400)` is called
5. Tries to fit in 400 chars:
   - Loop through tiered shortening: full → 12-char → 6-char → 3-char → 1-char
   - Loop through file count: all → 99 → 98 → ... → 1 → 0
6. Eventually gives up and returns `{ files: [] }`
7. API receives empty summary with only file list
8. Generates "no-op" message

## Solution Approach

### Fix 1: Never Return Completely Empty JSON
Instead of returning `{ files: [] }`, return at least one file with abbreviated info:
```typescript
// As a last resort, return first N files with minimal info
const minimal = fileChanges.slice(0, 3).map(fc => ({
  f: fc.file.split('/').pop(), // just filename
  c: 'mod'                       // just "mod"
}));
return JSON.stringify({ files: minimal });
```

### Fix 2: Improve Prompt to Handle Edge Cases
Add context about what files were modified:
```typescript
const changeCount = fileChanges.length;
const prompt = `${userPrompt}\n\nTotal modified files: ${changeCount}`;
```

### Fix 3: Better Compression Strategy
Instead of dropping files, prioritize:
1. Don't drop all files - keep at least 1-3
2. Show file count: `"Modified 47 files"` instead of just showing first 50
3. Group changes: `"ts: 10+5- | json: 3+1- | md: 2+0-"`

### Fix 4: Add Debugging/Logging
Log when compression becomes problematic:
```typescript
if (compressedJson.includes('"files":[]')) {
  console.warn('Autocommiter: File summary was completely empty, may cause generic commit messages');
}
```

## Implementation Plan

1. **Update `compressToJson()`** to never return completely empty files array
2. **Update the prompt** to include file count and better context
3. **Add guard checks** before sending to API
4. **Add console logging** to diagnose when this happens

## Expected Behavior After Fix

Even with 100+ files:
- Instead of: `{"files":[]}`
- Should provide: `{"files":[{"f":"file1.ts","c":"15+/8-"},{"f":"file2.ts","c":"42+"},...]}`
- Prompt includes: "Total modified files: 47"
- Result: **Proper commit message reflecting actual changes**
