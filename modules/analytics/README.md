# Analytics Module

This module provides analytics functionality for querying data from ClickHouse tables. It follows the same architectural patterns as other modules in the application.

## Features

- Character analytics (creations and trainings)
- Template analytics (views, tries, and downloads)
- Date range filtering with optional time filtering
- Multiple filter options
- Summary endpoints for quick insights
- Returns day-wise aggregated counts for the specified date range
- Time filtering support (hours:minutes:seconds) with sensible defaults

## API Endpoints

### Character Analytics

#### Get Character Creations
```
GET /analytics/characters/creations
```

**Query Parameters:**
- `start_date` (required): Start date in ISO 8601 format (YYYY-MM-DD)
- `end_date` (required): End date in ISO 8601 format (YYYY-MM-DD)
- `start_time` (optional): Start time in HH:MM:SS format (default: 00:00:00)
- `end_time` (optional): End time in HH:MM:SS format (default: 23:59:59)
- `gender` (optional): Filter by gender (male, female, couple, unknown)
- `character_id` (optional): Filter by specific character ID
- `user_id` (optional): Filter by specific user ID

#### Get Character Trainings
```
GET /analytics/characters/trainings
```

**Query Parameters:** Same as character creations

#### Get Character Analytics Summary
```
GET /analytics/characters/summary
```

**Query Parameters:** Same as character creations (returns count summaries only)

### Template Analytics

#### Get Template Views
```
GET /analytics/templates/views
```

**Query Parameters:**
- `start_date` (required): Start date in ISO 8601 format (YYYY-MM-DD)
- `end_date` (required): End date in ISO 8601 format (YYYY-MM-DD)
- `start_time` (optional): Start time in HH:MM:SS format (default: 00:00:00)
- `end_time` (optional): End time in HH:MM:SS format (default: 23:59:59)
- `output_type` (optional): Filter by output type (image, video, audio, pdf, website, unknown)
- `aspect_ratio` (optional): Filter by aspect ratio (9:16, 16:9, 3:4, 4:3, 1:1, unknown)
- `orientation` (optional): Filter by orientation (horizontal, vertical, unknown)
- `generation_type` (optional): Filter by generation type (ai, non-ai, unknown)
- `template_id` (optional): Filter by specific template ID
- `user_id` (optional): Filter by specific user ID

#### Get Template Tries
```
GET /analytics/templates/tries
```

**Query Parameters:** Same as template views

#### Get Template Downloads
```
GET /analytics/templates/downloads
```

**Query Parameters:** Same as template views

#### Get Template Analytics Summary
```
GET /analytics/templates/summary
```

**Query Parameters:** Same as template views (returns count summaries for views and tries)

#### Get Template Downloads Summary
```
GET /analytics/templates/downloads-summary
```

**Query Parameters:** Same as template views (returns count summaries for views, tries, and downloads)

## Response Format

All endpoints return data in the following format:

```json
{
  "data": [
    {
      "date": "2024-01-01",
      "count": 25
    },
    {
      "date": "2024-01-02", 
      "count": 30
    }
  ]
}
```

Summary endpoints return:

```json
{
  "data": {
    "character_creations": {
      "total_count": 500
    },
    "character_trainings": {
      "total_count": 300
    },
    "date_range": {
      "start_date": "2024-01-01",
      "end_date": "2024-01-31"
    }
  }
}
```

Template downloads summary returns:

```json
{
  "data": {
    "template_views": {
      "total_count": 1200
    },
    "template_tries": {
      "total_count": 800
    },
    "template_downloads": {
      "total_count": 400
    },
    "date_range": {
      "start_date": "2024-01-01",
      "end_date": "2024-01-31"
    }
  }
}
```

## Data Format

Each analytics endpoint returns day-wise aggregated data where:
- `date`: The date in YYYY-MM-DD format
- `count`: The number of records for that specific date

The data is ordered chronologically from the start date to the end date.

## Time Filtering

The analytics module supports optional time filtering with the following behavior:

- **Default Start Time**: `00:00:00` (midnight) - when `start_time` is not provided
- **Default End Time**: `23:59:59` (end of day) - when `end_time` is not provided
- **Time Format**: HH:MM:SS (24-hour format)
- **Examples**:
  - `start_time=09:30:00` - Start from 9:30 AM
  - `end_time=17:00:00` - End at 5:00 PM
  - `start_time=00:00:00&end_time=12:00:00` - Morning hours only

### Time Filtering Examples

```bash
# Get data for the entire day (default behavior)
GET /analytics/templates/views?start_date=2025-01-01&end_date=2025-01-01

# Get data for business hours only (9 AM to 5 PM)
GET /analytics/templates/views?start_date=2025-01-01&end_date=2025-01-01&start_time=09:00:00&end_time=17:00:00

# Get data for evening hours (6 PM to 11 PM)
GET /analytics/templates/views?start_date=2025-01-01&end_date=2025-01-01&start_time=18:00:00&end_time=23:00:00
```

## Authentication

All endpoints require JWT authentication via the `Authorization` header.

## Error Handling

The module includes comprehensive error handling with localized error messages in English, Hindi, and Telugu.

## Database

This module queries data from ClickHouse tables:
- `character_creations`
- `character_trainings`
- `template_views`
- `template_tries`
- `template_downloads`

## Module Structure

```
modules/analytics/
├── controllers/
│   └── analytics.controller.js
├── models/
│   └── analytics.model.js
├── routes/
│   └── analytics.route.js
├── validators/
│   ├── analytics.validator.js
│   └── schema/
│       └── analytics.schema.js
├── middlewares/
│   └── analytics.error.handler.js
├── constants/
│   └── analytics.constants.js
└── README.md
```
