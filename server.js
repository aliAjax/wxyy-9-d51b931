'use strict';

const path = require('path');
const {
  createApp,
  findDuplicateWig,
  processBatchImport,
  deepClone,
  stamp,
  BATCH_IMPORT_REQUIRED_FIELDS,
  AUDIT_COLLECTIONS,
  WARNING_STATUS,
  WARNING_STATUS_LABEL,
  sortNewest,
  isLendingOverdue,
  resolveCheckItems,
  createAuditLog,
  undoAuditLog,
  hasDependencies,
  runAction
} = require('./src/app');

const { createDefaultDataStore, createFileDataStore, JsonFileDataStore } = require('./src/data-store');
const config = require('./project.config');

const PORT = process.env.PORT || config.port || 3900;

const dataStore = createDefaultDataStore(__dirname);
const app = createApp(dataStore, {
  publicDir: path.join(__dirname, 'public')
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${config.title} running at http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  createApp,
  dataStore,
  createFileDataStore,
  JsonFileDataStore,
  createDefaultDataStore,
  findDuplicateWig,
  processBatchImport,
  deepClone,
  stamp,
  BATCH_IMPORT_REQUIRED_FIELDS,
  AUDIT_COLLECTIONS,
  WARNING_STATUS,
  WARNING_STATUS_LABEL,
  sortNewest,
  isLendingOverdue,
  resolveCheckItems,
  createAuditLog,
  undoAuditLog,
  hasDependencies,
  runAction,
  config
};
