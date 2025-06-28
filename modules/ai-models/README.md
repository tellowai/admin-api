# AI Models Module

This module manages AI models and their associated platform providers.

## Database Tables

### ai_model_provider_platforms
- `amp_platform_id` - Primary key
- `platform_name` - Name of the platform (e.g., "Fal.ai", "Replicate")
- `platform_code` - Short code for the platform (e.g., "fal", "replicate")
- `description` - Platform description
- `created_at`, `updated_at` - Timestamps

### ai_models
- `model_id` - Primary key
- `amp_platform_id` - Foreign key to ai_model_provider_platforms
- `model_name` - Display name of the model
- `description` - Model description
- `platform_model_id` - Platform-specific model identifier
- `input_types` - JSON array of supported input types
- `output_types` - JSON array of supported output types
- `costs` - JSON object containing pricing information
- `generation_time_ms` - Estimated generation time in milliseconds
- `status` - Model status ('active', 'inactive')
- `created_at`, `updated_at`, `archived_at` - Timestamps

## API Endpoints

### GET /api/ai-models
Lists all active AI models with their platform details.

**Authentication**: Requires admin JWT token

**Query Parameters**:
- `input_type` or `input_types` (optional): Filter by input type(s). Single value or comma-separated (e.g., `text`, `image`, `text,image`)
- `output_type` or `output_types` (optional): Filter by output type(s). Single value or comma-separated (e.g., `image`, `video`, `image,video`)

**Examples**:
- `/api/ai-models` - Get all AI models
- `/api/ai-models?input_type=image` - Get models that accept image input
- `/api/ai-models?output_type=video` - Get models that produce video output
- `/api/ai-models?output_types=video` - Same as above (using plural form)
- `/api/ai-models?input_type=text,image&output_type=image` - Get models that accept text or image input and produce image output
- `/api/ai-models?input_types=image&output_types=video` - Get models that accept image input and produce video output

**Response**:
```json
{
  "data": [
    {
      "model_id": "fal-flux-lora",
      "model_name": "Flux LoRA",
      "description": "Flux LoRA model for image generation",
      "platform_model_id": "fal-ai/flux-lora",
      "input_types": ["image"],
      "output_types": ["image"],
      "costs": {
        "input": {
          "image": {
            "per_megapixel": 0.01
          }
        },
        "output": {
          "image": {
            "per_megapixel": 0.02
          }
        }
      },
      "generation_time_ms": 5000,
      "status": "active",
      "platform": {
        "amp_platform_id": 1,
        "platform_name": "Fal.ai",
        "platform_code": "fal",
        "description": "Fal.ai platform for AI model hosting and inference"
      }
    }
  ]
}
```

## Module Structure

```
modules/ai-models/
├── controllers/
│   └── ai-model.controller.js
├── models/
│   └── ai-model.model.js
├── middlewares/
│   └── ai-model.error.handler.js
├── routes/
│   └── ai-model.route.js
└── README.md
```

## Localization

The module supports multiple languages through i18next:
- English (`config/locales/en/ai_model.json`)
- Hindi (`config/locales/hi/ai_model.json`)
- Telugu (`config/locales/te/ai_model.json`)

## Error Handling

The module includes comprehensive error handling for:
- Database connection errors
- Missing tables or fields
- General API errors

All errors are properly localized and logged. 