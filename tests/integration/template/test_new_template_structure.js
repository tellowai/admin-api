'use strict';

const request = require('supertest');
const app = require('../../../server');
const { expect } = require('chai');

describe('Template API - New Structure', () => {
  let authToken;
  let createdVideoTemplateId;
  let createdImageTemplateId;

  before(async () => {
    // Setup authentication token
    // This would need to be implemented based on your auth system
    authToken = 'test-token';
  });

  describe('POST /api/v1/templates', () => {
    it('should create a video template with new structure', async () => {
      const templateData = {
        template_name: "Test Video Template",
        template_code: "TVT001",
        template_output_type: "video",
        template_clips_assets_type: "ai",
        template_gender: "male",
        description: "Test video template with new structure",
        prompt: "",
        credits: 4,
        thumb_r2_bucket: "public",
        thumb_r2_key: "assets/test-thumb.mp4",
        clips: [
          {
            clip_index: 1,
            workflow: [
              {
                workflow_id: "user-upload-image",
                workflow_code: "ask_user_to_upload_image",
                order_index: 0
              },
              {
                workflow_id: "remove-background",
                workflow_code: "remove_background",
                order_index: 1,
                data: [
                  {
                    type: "ai_model",
                    value: "seededit-v3"
                  },
                  {
                    type: "prompt",
                    value: "test prompt"
                  }
                ]
              }
            ]
          }
        ],
        color_video_bucket: "public",
        mask_video_bucket: "public",
        bodymovin_json_bucket: "public",
        color_video_key: "assets/test-color.mp4",
        mask_video_key: "assets/test-mask.mp4",
        bodymovin_json_key: "assets/test-json.json"
      };

      const response = await request(app)
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .send(templateData)
        .expect(201);

      expect(response.body).to.have.property('message');
      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('template_id');
      
      createdVideoTemplateId = response.body.data.template_id;
    });

    it('should create an image template with new structure', async () => {
      const templateData = {
        template_name: "Test Image Template",
        template_code: "TIT001",
        template_output_type: "image",
        template_clips_assets_type: "non-ai",
        template_gender: "female",
        description: "Test image template with new structure",
        prompt: "A beautiful portrait",
        credits: 2,
        thumb_r2_bucket: "public",
        thumb_r2_key: "assets/test-image-thumb.jpg",
        clips: [
          {
            clip_index: 1,
            workflow: [
              {
                workflow_id: "user-upload-image",
                workflow_code: "ask_user_to_upload_image",
                order_index: 0
              },
              {
                workflow_id: "apply-filter",
                workflow_code: "apply_beauty_filter",
                order_index: 1,
                data: [
                  {
                    type: "filter_type",
                    value: "beauty"
                  }
                ]
              }
            ]
          }
        ],
        color_video_bucket: "public",
        color_video_key: "assets/test-image-color.jpg"
      };

      const response = await request(app)
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .send(templateData)
        .expect(201);

      expect(response.body).to.have.property('message');
      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('template_id');
      
      createdImageTemplateId = response.body.data.template_id;
    });

    it('should validate required fields for templates', async () => {
      const invalidTemplateData = {
        template_name: "Invalid Template",
        template_code: "IT001",
        template_output_type: "video",
        // Missing template_clips_assets_type
        description: "Invalid template"
      };

      const response = await request(app)
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidTemplateData)
        .expect(400);

      expect(response.body).to.have.property('message');
      expect(response.body).to.have.property('data');
    });

    it('should validate template_clips_assets_type values', async () => {
      const invalidTemplateData = {
        template_name: "Invalid Template",
        template_code: "IT002",
        template_output_type: "video",
        template_clips_assets_type: "invalid", // Invalid value
        description: "Invalid template",
        clips: [
          {
            clip_index: 1,
            workflow: [
              {
                workflow_id: "test",
                workflow_code: "test",
                order_index: 0
              }
            ]
          }
        ]
      };

      const response = await request(app)
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidTemplateData)
        .expect(400);

      expect(response.body).to.have.property('message');
      expect(response.body).to.have.property('data');
    });
  });

  describe('GET /api/v1/templates', () => {
    it('should list templates with new structure', async () => {
      const response = await request(app)
        .get('/api/v1/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.be.an('array');
      
      // Check if the created templates are in the list
      const videoTemplate = response.body.data.find(t => t.template_id === createdVideoTemplateId);
      const imageTemplate = response.body.data.find(t => t.template_id === createdImageTemplateId);
      
      expect(videoTemplate).to.exist;
      expect(videoTemplate).to.have.property('template_clips_assets_type', 'ai');
      expect(videoTemplate).to.have.property('thumb_r2_bucket');
      expect(videoTemplate).to.have.property('thumb_r2_key');
      expect(videoTemplate).to.have.property('clips');
      expect(videoTemplate.clips).to.be.an('array');
      
      expect(imageTemplate).to.exist;
      expect(imageTemplate).to.have.property('template_clips_assets_type', 'non-ai');
      expect(imageTemplate).to.have.property('thumb_r2_bucket');
      expect(imageTemplate).to.have.property('thumb_r2_key');
      expect(imageTemplate).to.have.property('clips');
      expect(imageTemplate.clips).to.be.an('array');
    });
  });

  describe('PATCH /api/v1/templates/:templateId', () => {
    it('should update video template with new structure', async () => {
      const updateData = {
        template_name: "Updated Test Video Template",
        clips: [
          {
            clip_index: 1,
            workflow: [
              {
                workflow_id: "user-upload-image",
                workflow_code: "ask_user_to_upload_image",
                order_index: 0
              },
              {
                workflow_id: "remove-background",
                workflow_code: "remove_background",
                order_index: 1,
                data: [
                  {
                    type: "ai_model",
                    value: "imagen4-preview"
                  },
                  {
                    type: "prompt",
                    value: "updated prompt"
                  }
                ]
              }
            ]
          }
        ]
      };

      const response = await request(app)
        .patch(`/api/v1/templates/${createdVideoTemplateId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).to.have.property('message');
    });

    it('should update image template with new structure', async () => {
      const updateData = {
        template_name: "Updated Test Image Template",
        template_clips_assets_type: "ai",
        clips: [
          {
            clip_index: 1,
            workflow: [
              {
                workflow_id: "user-upload-image",
                workflow_code: "ask_user_to_upload_image",
                order_index: 0
              },
              {
                workflow_id: "ai-enhance",
                workflow_code: "enhance_with_ai",
                order_index: 1,
                data: [
                  {
                    type: "ai_model",
                    value: "enhance-model"
                  }
                ]
              }
            ]
          }
        ]
      };

      const response = await request(app)
        .patch(`/api/v1/templates/${createdImageTemplateId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body).to.have.property('message');
    });
  });

  describe('POST /api/v1/templates/:templateId/archive', () => {
    it('should archive video template', async () => {
      const response = await request(app)
        .post(`/api/v1/templates/${createdVideoTemplateId}/archive`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).to.have.property('message');
    });

    it('should archive image template', async () => {
      const response = await request(app)
        .post(`/api/v1/templates/${createdImageTemplateId}/archive`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).to.have.property('message');
    });
  });
}); 