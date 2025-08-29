# Template Structure Update

## Overview
This update modifies the template system to support a new database structure and payload format for templates with AI-generated clips and workflows. The system now supports clips for both image and video templates, with AE assets available for all template types.

## Database Changes

### New Tables
1. **clip_workflow** - Stores workflow steps for each clip
   ```sql
   CREATE TABLE clip_workflow (
       cw_id INT AUTO_INCREMENT PRIMARY KEY,
       tac_id VARCHAR(36) NOT NULL,
       workflow JSON NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       FOREIGN KEY (tac_id) REFERENCES template_ai_clips(tac_id) ON DELETE CASCADE
   );
   ```

2. **template_ae_assets** - Stores After Effects assets for all templates
   ```sql
   CREATE TABLE template_ae_assets (
       taae_id VARCHAR(36) PRIMARY KEY,
       template_id VARCHAR(36) NOT NULL,
       color_video_bucket VARCHAR(255),
       color_video_key VARCHAR(512),
       mask_video_bucket VARCHAR(255),
       mask_video_key VARCHAR(512),
       bodymovin_json_bucket VARCHAR(255),
       bodymovin_json_key VARCHAR(512),
       custom_text_input_fields TEXT,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       deleted_at TIMESTAMP NULL,
       FOREIGN KEY (template_id) REFERENCES templates(template_id) ON DELETE CASCADE
   );
   ```

### Updated Tables
1. **templates** - Added new fields:
   - `template_clips_assets_type` ENUM('ai', 'non-ai')
   - `thumb_r2_bucket` VARCHAR(255)
   - `thumb_r2_key` VARCHAR(512)

2. **template_ai_clips** - Simplified structure:
   - Removed complex fields like `video_type`, `asset_prompt`, `characters`, etc.
   - Now only stores basic clip information
   - Workflow data is stored in separate `clip_workflow` table

## API Changes

### New Payload Structure
The template creation/update payload now uses a new structure for clips that works for both image and video templates:

```json
{
  "template_name": "video template 1 - with images",
  "template_code": "VTWI51",
  "template_output_type": "video",
  "template_clips_assets_type": "ai",
  "template_gender": "male",
  "description": "",
  "prompt": "",
  "credits": 4,
  "thumb_r2_bucket": "public",
  "thumb_r2_key": "assets/p3n5v29v8c9551ry6q1pf2qq.mp4",
  "clips": [
    {
      "clip_index": 1,
      "workflow": [
        {
          "workflow_id": "user-upload-image",
          "workflow_code": "ask_user_to_upload_image",
          "order_index": 0
        },
        {
          "workflow_id": "remove-background",
          "workflow_code": "remove_background",
          "order_index": 1,
          "data": [
            {
              "type": "ai_model",
              "value": "seededit-v3"
            },
            {
              "type": "prompt",
              "value": "erwrwrwr"
            }
          ]
        }
      ]
    }
  ],
  "color_video_bucket": "public",
  "mask_video_bucket": "public",
  "bodymovin_json_bucket": "public",
  "color_video_key": "assets/t3bjidciin8nfpjilfd56nz6.mp4",
  "mask_video_key": "assets/w9eoeq7l0i1xhvm7xsm65pw9.mp4",
  "bodymovin_json_key": "assets/aqv3980kcg253ckbofjburbw.json"
}
```

### New Bulk Archive Endpoint
Added a new bulk archive endpoint for archiving multiple templates at once:

**POST** `/api/v1/templates/archive/bulk`

**Request Body:**
```json
{
  "template_ids": ["template-id-1", "template-id-2", "template-id-3"]
}
```

**Validation Rules:**
- `template_ids` must be an array
- Minimum 1 template ID required
- Maximum 50 template IDs allowed
- Each template ID must be a valid string

**Response:**
```json
{
  "message": "Templates archived successfully",
  "data": {
    "archived_count": 3,
    "total_requested": 3
  }
}
```

**Features:**
- Bulk database operation for efficiency
- Activity logging for each archived template
- Returns count of successfully archived templates
- Handles cases where some templates may already be archived

### Field Changes
- `cf_r2_bucket` → `thumb_r2_bucket`
- `cf_r2_key` → `thumb_r2_key`
- Added `template_clips_assets_type` with values `ai` or `non-ai`
- Clips now contain `workflow` arrays instead of complex video_type structures
- Clips are required for both image and video templates
- AE assets are available for all template types

## Code Changes

### Files Modified
1. **modules/templates/validators/schema/template.schema.js**
   - Updated validation schemas for new payload structure
   - Added workflow step validation
   - Updated field names and requirements
   - Removed conditional video type checks
   - Changed `template_clips_assets_type` values to `ai`/`non-ai`
   - Added `bulkArchiveTemplatesSchema` for bulk archive validation

2. **modules/templates/validators/template.validator.js**
   - Added `validateBulkArchiveTemplatesData` function for bulk archive validation

3. **modules/templates/models/template.model.js**
   - Updated database queries to use new field names
   - Added functions to handle clip workflows
   - Updated transaction handling for new structure
   - Added workflow creation and retrieval functions
   - Removed conditional video type logic
   - Added `bulkArchiveTemplates` function for bulk archiving

4. **modules/templates/controllers/template.controller.js**
   - Updated field references (cf_r2 → thumb_r2)
   - Modified faces_needed generation logic for new workflow structure
   - Updated API documentation
   - Removed conditional video type checks
   - Clips and AE assets now work for all template types
   - Added `bulkArchiveTemplates` function for bulk archive operations

5. **modules/templates/routes/template.route.js**
   - Added new route `/templates/archive/bulk` for bulk archive functionality

6. **config/locales/en/template.json**
   - Added new locale messages for bulk archive operations

### New Functions
- `createClipWorkflowInTransaction()` - Creates workflow entries for clips
- `getClipWorkflow()` - Retrieves workflow for a specific clip
- `deleteTemplateAiClipsInTransaction()` - Updated to also delete workflows
- `bulkArchiveTemplates()` - Archives multiple templates in a single operation
- `validateBulkArchiveTemplatesData()` - Validates bulk archive request payload
- `listArchivedTemplates()` - Lists archived templates with pagination support
- `bulkUnarchiveTemplates()` - Unarchives multiple templates in a single operation
- `validateBulkUnarchiveTemplatesData()` - Validates bulk unarchive request payload

## Migration Steps

1. **Run Database Schema Updates**
   ```sql
   -- Execute the SQL commands in database_schema_updates.sql
   ```

2. **Update Existing Data** (if needed)
   ```sql
   -- Rename existing cf_r2 fields to thumb_r2 fields
   ALTER TABLE templates 
   CHANGE COLUMN cf_r2_bucket thumb_r2_bucket VARCHAR(255),
   CHANGE COLUMN cf_r2_key thumb_r2_key VARCHAR(512);
   ```

3. **Deploy Code Changes**
   - Deploy the updated template module files
   - Test with the new payload structure

## Testing

A test file has been created at `tests/integration/template/test_new_template_structure.js` to verify:
- Template creation for both image and video types
- Validation of required fields including `template_clips_assets_type`
- Template listing with new fields
- Template updates with workflow changes
- Template archiving
- Bulk template archiving with validation
- Bulk template unarchiving with validation
- Archived templates listing with pagination
- Validation of `ai`/`non-ai` values

## Key Changes Summary

1. **Universal Clip Support**: Both image and video templates now support clips with workflows
2. **AE Assets for All**: After Effects assets are available for all template types, not just video
3. **Simplified Asset Types**: Changed from `ai`/`static` to `ai`/`non-ai` for clarity
4. **No Conditional Logic**: Removed all conditional checks based on template output type
5. **Workflow-Based**: All processing is now workflow-based rather than type-based
6. **Bulk Operations**: Added efficient bulk archive and unarchive functionality for multiple templates
7. **Archived Templates**: Added comprehensive listing of archived templates with pagination

## Backward Compatibility

The changes maintain backward compatibility for:
- Basic template operations (create, read, update, delete)
- Authentication and authorization
- Existing field structures (except for renamed fields)

However, all templates now require:
- `template_clips_assets_type` field
- `clips` array with workflows
- Updated field names (`thumb_r2_*` instead of `cf_r2_*`)

## Notes

- The `template_ae_assets` table is optional and used for templates with After Effects assets
- Workflows are stored as JSON in the `clip_workflow` table for flexibility
- The new structure is more modular and easier to extend with new workflow types
- All database operations use transactions to ensure data consistency
- Both image and video templates can now have complex processing workflows
- Bulk archive and unarchive operations are optimized for performance with large numbers of templates
- Archived templates can be listed with full pagination support and asset URLs