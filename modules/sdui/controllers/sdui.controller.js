'use strict';

const SduiService = require('../services/sdui.service');

exports.listScreens = async function(req, res) {
  try {
    const { page, limit, status, search } = req.query;
    const result = await SduiService.listScreens({ page, limit, status, search });
    return res.status(200).send(result);
  } catch (err) {
    console.error('SDUI listScreens Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.getScreen = async function(req, res) {
  try {
    const screen = await SduiService.getScreenById(req.params.id);
    if (!screen) return res.status(404).send({ message: 'Screen not found' });
    return res.status(200).send(screen);
  } catch (err) {
    console.error('SDUI getScreen Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.createScreen = async function(req, res) {
  try {
    const { screen_key, name, description, body_json, version } = req.body;
    if (!screen_key || !name || !body_json) {
      return res.status(400).send({ message: 'screen_key, name, and body_json are required' });
    }
    const screen = await SduiService.createScreen({
      screen_key,
      name,
      description,
      body_json,
      version,
      created_by: req.user?.userId,
      updated_by: req.user?.userId
    });
    return res.status(201).send({ data: screen });
  } catch (err) {
    if (err.message === 'Screen key already exists') return res.status(409).send({ message: err.message });
    console.error('SDUI createScreen Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.updateScreen = async function(req, res) {
  try {
    const { name, description, body_json, version, status } = req.body;
    const screen = await SduiService.updateScreen(req.params.id, {
      name,
      description,
      body_json,
      version,
      status,
      updated_by: req.user?.userId
    });
    return res.status(200).send({ data: screen });
  } catch (err) {
    if (err.message === 'Screen not found') return res.status(404).send({ message: err.message });
    console.error('SDUI updateScreen Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.archiveScreen = async function(req, res) {
  try {
    await SduiService.archiveScreen(req.params.id);
    return res.status(200).send({ message: 'Screen archived successfully' });
  } catch (err) {
    if (err.message === 'Screen not found') return res.status(404).send({ message: err.message });
    console.error('SDUI archiveScreen Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.publishScreen = async function(req, res) {
  try {
    await SduiService.publishScreen(req.params.id, req.user?.userId);
    return res.status(200).send({ message: 'Screen published successfully' });
  } catch (err) {
    if (err.message === 'Screen not found') return res.status(404).send({ message: err.message });
    console.error('SDUI publishScreen Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.listVersions = async function(req, res) {
  try {
    const versions = await SduiService.listVersions(req.params.id);
    return res.status(200).send({ data: versions });
  } catch (err) {
    if (err.message === 'Screen not found') return res.status(404).send({ message: err.message });
    console.error('SDUI listVersions Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.rollbackToVersion = async function(req, res) {
  try {
    const screen = await SduiService.rollbackToVersion(
      req.params.id,
      req.params.versionId,
      req.user?.userId
    );
    return res.status(200).send({ data: screen, message: 'Rolled back successfully' });
  } catch (err) {
    if (err.message === 'Version not found or does not belong to this screen') return res.status(404).send({ message: err.message });
    console.error('SDUI rollbackToVersion Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.duplicateScreen = async function(req, res) {
  try {
    const { screen_key } = req.body;
    if (!screen_key) return res.status(400).send({ message: 'screen_key is required' });
    const screen = await SduiService.duplicateScreen(req.params.id, screen_key, req.user?.userId);
    return res.status(201).send({ data: screen });
  } catch (err) {
    if (err.message === 'Screen not found') return res.status(404).send({ message: err.message });
    if (err.message === 'Screen key already exists') return res.status(409).send({ message: err.message });
    console.error('SDUI duplicateScreen Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.listRegistry = async function(req, res) {
  try {
    const { category } = req.query;
    const result = await SduiService.listRegistry(category);
    return res.status(200).send(result);
  } catch (err) {
    console.error('SDUI listRegistry Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.getRegistryEntry = async function(req, res) {
  try {
    const entry = await SduiService.getRegistryById(req.params.id);
    if (!entry) return res.status(404).send({ message: 'Registry entry not found' });
    return res.status(200).send(entry);
  } catch (err) {
    console.error('SDUI getRegistryEntry Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.createRegistryEntry = async function(req, res) {
  try {
    const { node_type, category, display_name, description, props_schema, default_props, supports_children, supported_triggers } = req.body;
    if (!node_type || !category || !display_name) {
      return res.status(400).send({ message: 'node_type, category, and display_name are required' });
    }
    const entry = await SduiService.createRegistryEntry({
      node_type,
      category,
      display_name,
      description,
      props_schema,
      default_props,
      supports_children,
      supported_triggers
    });
    return res.status(201).send({ data: entry });
  } catch (err) {
    if (err.message === 'Node type already exists') return res.status(409).send({ message: err.message });
    console.error('SDUI createRegistryEntry Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.updateRegistryEntry = async function(req, res) {
  try {
    const entry = await SduiService.updateRegistryEntry(req.params.id, req.body);
    return res.status(200).send({ data: entry });
  } catch (err) {
    if (err.message === 'Registry entry not found') return res.status(404).send({ message: err.message });
    console.error('SDUI updateRegistryEntry Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.deprecateRegistryEntry = async function(req, res) {
  try {
    await SduiService.deprecateRegistryEntry(req.params.id);
    return res.status(200).send({ message: 'Registry entry deprecated' });
  } catch (err) {
    if (err.message === 'Registry entry not found') return res.status(404).send({ message: err.message });
    console.error('SDUI deprecateRegistryEntry Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.listComponents = async function(req, res) {
  try {
    const { search } = req.query;
    const result = await SduiService.listComponents(search);
    return res.status(200).send(result);
  } catch (err) {
    console.error('SDUI listComponents Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.getComponent = async function(req, res) {
  try {
    const component = await SduiService.getComponentById(req.params.id);
    if (!component) return res.status(404).send({ message: 'Component not found' });
    return res.status(200).send(component);
  } catch (err) {
    console.error('SDUI getComponent Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.createComponent = async function(req, res) {
  try {
    const { component_key, name, description, version, node_json } = req.body;
    if (!component_key || !name || !node_json) return res.status(400).send({ message: 'component_key, name, and node_json are required' });
    const component = await SduiService.createComponent({
      component_key,
      name,
      description,
      version,
      node_json,
      created_by: req.user?.userId
    });
    return res.status(201).send({ data: component });
  } catch (err) {
    if (err.message === 'Component key already exists') return res.status(409).send({ message: err.message });
    console.error('SDUI createComponent Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.updateComponent = async function(req, res) {
  try {
    const { name, description, version, node_json } = req.body;
    const component = await SduiService.updateComponent(req.params.id, { name, description, version, node_json });
    return res.status(200).send({ data: component });
  } catch (err) {
    if (err.message === 'Component not found') return res.status(404).send({ message: err.message });
    console.error('SDUI updateComponent Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.deleteComponent = async function(req, res) {
  try {
    await SduiService.deleteComponent(req.params.id);
    return res.status(200).send({ message: 'Component deleted' });
  } catch (err) {
    if (err.message === 'Component not found') return res.status(404).send({ message: err.message });
    console.error('SDUI deleteComponent Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};
