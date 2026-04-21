'use strict';

const assert = require('assert');
const { projectModeledToLegacy } = require('../../../modules/templates/utils/projectModeledToLegacy');

describe('projectModeledToLegacy', () => {
  it('groups text user_input + linked into one legacy row with linked_layer_names', () => {
    const asked = [
      {
        id: 'uf1',
        kind: 'text',
        label: 'Guest name',
        display_order: 0,
        input_type: 'short_text'
      }
    ];
    const bindings = [
      {
        id: 'b1',
        slot_kind: 'text',
        slot_layer_name: 'Title Text',
        binding_kind: 'user_input',
        user_input_field_id: 'uf1',
        display_order: 0
      },
      {
        id: 'b2',
        slot_kind: 'text',
        slot_layer_name: 'Subtitle Text',
        binding_kind: 'linked',
        linked_to_slot_layer_name: 'Title Text',
        user_input_field_id: 'uf1',
        display_order: 1
      }
    ];
    const out = projectModeledToLegacy({
      asked_user_input_fields: asked,
      slot_bindings: bindings,
      clip_workflows: []
    });
    assert.strictEqual(out.custom_text_input_fields.length, 1);
    const row = out.custom_text_input_fields[0];
    assert.strictEqual(row.layer_name, 'Title Text');
    assert.deepStrictEqual(row.linked_layer_names, ['Subtitle Text']);
    assert.strictEqual(row.user_input_field_name, 'Guest name');
    assert.strictEqual(row.input_field_type, 'short_text');
  });

  it('emits nothing for unmapped text bindings', () => {
    const asked = [{ id: 'uf1', kind: 'text', label: 'X', display_order: 0 }];
    const bindings = [
      {
        id: 'b1',
        slot_kind: 'text',
        slot_layer_name: 'Unused',
        binding_kind: 'unmapped',
        display_order: 0
      }
    ];
    const out = projectModeledToLegacy({
      asked_user_input_fields: asked,
      slot_bindings: bindings,
      clip_workflows: []
    });
    assert.deepStrictEqual(out.custom_text_input_fields, []);
  });

  it('emits skip_user_input text row for ai_workflow USER_INPUT_TEXT', () => {
    const clip_workflows = [
      {
        clip_index: 0,
        nodes: [
          {
            type: 'USER_INPUT_TEXT',
            data: {
              label: 'Prompt line',
              inputs: { variable_key: 'story_text' }
            }
          }
        ]
      }
    ];
    const bindings = [
      {
        id: 'b1',
        slot_kind: 'text',
        slot_layer_name: 'AI Caption',
        binding_kind: 'ai_workflow',
        display_order: 0,
        ai_workflow: {
          clip_index: 0,
          variable_key: 'story_text',
          node_type: 'USER_INPUT_TEXT'
        }
      }
    ];
    const out = projectModeledToLegacy({
      asked_user_input_fields: [],
      slot_bindings: bindings,
      clip_workflows
    });
    assert.strictEqual(out.custom_text_input_fields.length, 1);
    const row = out.custom_text_input_fields[0];
    assert.strictEqual(row.skip_user_input, true);
    assert.strictEqual(row.variable_name, 'story_text');
    assert.strictEqual(row.layer_name, 'AI Caption');
  });

  it('image ai_workflow preserves image_id from existing row by layer_name', () => {
    const existing = [{ image_id: 'keep-me', layer_name: 'Photo slot', field_code: 'fc1' }];
    const bindings = [
      {
        id: 'b1',
        slot_kind: 'image',
        slot_layer_name: 'Photo slot',
        binding_kind: 'ai_workflow',
        display_order: 0,
        ai_workflow: {
          clip_index: 1,
          variable_key: 'user_photo',
          node_type: 'USER_INPUT_IMAGE'
        }
      }
    ];
    const clip_workflows = [
      { clip_index: 0, nodes: [] },
      {
        clip_index: 1,
        nodes: [
          {
            type: 'USER_INPUT_IMAGE',
            data: { label: 'User photo', inputs: { variable_key: 'user_photo' } }
          }
        ]
      }
    ];
    const out = projectModeledToLegacy({
      asked_user_input_fields: [],
      slot_bindings: bindings,
      clip_workflows,
      existing_image_input_fields_json: existing
    });
    assert.strictEqual(out.image_input_fields_json.length, 1);
    const row = out.image_input_fields_json[0];
    assert.strictEqual(row.image_id, 'keep-me');
    assert.strictEqual(row.variable_key, 'user_photo');
    assert.strictEqual(row.field_code, 'fc1');
    assert.strictEqual(row.clip_index, 1);
  });

  it('video ai_workflow emits clip_index and step_index', () => {
    const bindings = [
      {
        id: 'b1',
        slot_kind: 'video',
        slot_layer_name: 'Clip layer',
        binding_kind: 'ai_workflow',
        display_order: 0,
        ai_workflow: {
          clip_index: 2,
          step_index: 3,
          variable_key: 'vid_var',
          node_type: 'USER_INPUT_VIDEO'
        }
      }
    ];
    const clip_workflows = [
      { clip_index: 0, nodes: [] },
      { clip_index: 1, nodes: [] },
      {
        clip_index: 2,
        nodes: [
          {
            type: 'USER_INPUT_VIDEO',
            data: { label: 'Clip', inputs: { variable_key: 'vid_var' } }
          }
        ]
      }
    ];
    const out = projectModeledToLegacy({
      asked_user_input_fields: [],
      slot_bindings: bindings,
      clip_workflows
    });
    assert.strictEqual(out.video_uploads_json.length, 1);
    const row = out.video_uploads_json[0];
    assert.strictEqual(row.clip_index, 2);
    assert.strictEqual(row.step_index, 3);
    assert.strictEqual(row.variable_key, 'vid_var');
    assert.strictEqual(row.layer_name, 'Clip layer');
  });
});
