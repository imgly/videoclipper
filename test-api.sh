#!/bin/bash

response=$(curl -X POST http://localhost:3003/api/gemini-refine \
  -H "Content-Type: application/json" \
  -d '{
    "model": "models/gemini-2.5-pro-preview-03-25",
    "words": [
      {"text": "Hello", "start": 0, "end": 0.5, "speaker_id": null},
      {"text": "world", "start": 0.5, "end": 1.0, "speaker_id": null}
    ]
  }' \
  -w "\n---\nHTTP Status: %{http_code}" \
  -s 2>/dev/null)

echo "$response"
