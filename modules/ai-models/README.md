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

### ai_model_tags
- `amt_id` - Primary key
- `tag_name` - Display name of the tag (max 36 characters)
- `tag_code` - Unique code for the tag (max 36 characters, alphanumeric with underscore and dash)
- `tag_description` - Optional description of the tag
- `created_at`, `updated_at` - Timestamps
- `deleted_at` - Soft delete timestamp

## API Endpoints

### AI Models

#### GET /api/ai-models
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

#### POST /api/ai-models
Create a new AI model.

**Authentication**: Requires admin JWT token

**Request Body**:
```json
{
  "model_id": "fal-flux-lora",
  "amp_platform_id": 1,
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
  "status": "active"
}
```

#### GET /api/ai-models/:modelId
Get AI model by ID.

**Authentication**: Requires admin JWT token

#### PATCH /api/ai-models/:modelId
Update AI model by ID.

**Authentication**: Requires admin JWT token

### AI Model Platforms

#### GET /api/ai-model-platforms
List all AI model platforms.

**Authentication**: Requires admin JWT token

#### POST /api/ai-model-platforms
Create new AI model platform.

**Authentication**: Requires admin JWT token

#### PATCH /api/ai-model-platforms/:platformId
Update AI model platform by ID.

**Authentication**: Requires admin JWT token

### AI Model Tags

#### GET /api/ai-model-tags
List all AI model tags.

**Authentication**: Requires admin JWT token

**Response**:
```json
{
  "data": [
    {
      "amt_id": 1,
      "tag_name": "Image Generation",
      "tag_code": "image_gen",
      "tag_description": "Tags for image generation models",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

#### POST /api/ai-model-tags
Create a new AI model tag.

**Authentication**: Requires admin JWT token

**Request Body**:
```json
{
  "tag_name": "Image Generation",
  "tag_code": "image_gen",
  "tag_description": "Tags for image generation models"
}
```

**Response**:
```json
{
  "message": "AI model tag created successfully",
  "data": {
    "amt_id": 1,
    "tag_name": "Image Generation",
    "tag_code": "image_gen",
    "tag_description": "Tags for image generation models",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /api/ai-model-tags/:tagId
Get AI model tag by ID.

**Authentication**: Requires admin JWT token

#### PATCH /api/ai-model-tags/:tagId
Update AI model tag by ID.

**Authentication**: Requires admin JWT token

**Request Body** (all fields optional):
```json
{
  "tag_name": "Updated Tag Name",
  "tag_code": "updated_code",
  "tag_description": "Updated description"
}
```

**Response**:
```json
{
  "message": "AI model tag updated successfully",
  "data": {
    "amt_id": 1,
    "tag_name": "Updated Tag Name",
    "tag_code": "updated_code",
    "tag_description": "Updated description",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T12:00:00.000Z"
  }
}
```

## Module Structure

```
modules/ai-models/
├── controllers/
│   ├── ai-model.controller.js
│   └── ai-model.tag.controller.js
├── models/
│   ├── ai-model.model.js
│   └── ai-model.tag.model.js
├── middlewares/
│   ├── ai-model.error.handler.js
│   └── ai-model.tag.error.handler.js
├── routes/
│   ├── ai-model.route.js
│   └── ai-model.tag.route.js
├── validators/
│   ├── ai-model.validator.js
│   └── ai-model.tag.validator.js
└── README.md
```

## Localization

The module supports multiple languages through i18next:
- English (`config/locales/en/ai_model.json`, `config/locales/en/ai_model_tag.json`)
- Hindi (`config/locales/hi/ai_model.json`, `config/locales/hi/ai_model_tag.json`)
- Telugu (`config/locales/te/ai_model.json`, `config/locales/te/ai_model_tag.json`)

## Error Handling

The module includes comprehensive error handling for:
- Database connection errors
- Missing tables or fields
- General API errors
- Duplicate tag codes
- Validation errors

All errors are properly localized and logged.

## Validation Rules

### AI Model Tags
- `tag_name`: Required, 1-36 characters, trimmed
- `tag_code`: Required, 1-36 characters, alphanumeric with underscore and dash only, trimmed
- `tag_description`: Optional, max 65535 characters, trimmed

### AI Models
- `model_id`: Required, 1-50 characters
- `amp_platform_id`: Required, integer
- `model_name`: Required, 1-100 characters
- `description`: Optional, max 65535 characters
- `platform_model_id`: Required, 1-100 characters
- `input_types`: Optional, array of strings
- `output_types`: Optional, array of strings
- `supported_video_qualities`: Required when output_types contains "video"
- `costs`: Optional, object
- `generation_time_ms`: Optional, integer >= 0
- `status`: Optional, one of: 'active', 'inactive', 'disabled' 