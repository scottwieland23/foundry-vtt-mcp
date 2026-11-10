'use strict';
const {definitions, validate} = require('./module-schemas.cjs');

function createModuleTools(client) {
  return {
    async handle(name, raw) {
      const args = validate(name, raw);
      const status = await client.query('ai-portrait-bridge.status', {});
      if (!status?.moduleTools) throw Error('Refresh the GM tab to load the module adapters.');
      return client.query('ai-portrait-bridge.module.' + name, args);
    }
  };
}

module.exports = {definitions, createModuleTools};
