'use strict';

const fs = require('fs/promises');
const path = require('path');

class JsonFileDataStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async read() {
    const raw = await fs.readFile(this.filePath, 'utf8');
    return JSON.parse(raw);
  }

  async write(data) {
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2) + '\n');
  }

  getPath() {
    return this.filePath;
  }
}

function createFileDataStore(filePath) {
  return new JsonFileDataStore(filePath);
}

function createDefaultDataStore(baseDir) {
  const dbPath = path.join(baseDir || __dirname, '..', 'data', 'db.json');
  return createFileDataStore(dbPath);
}

module.exports = {
  JsonFileDataStore,
  createFileDataStore,
  createDefaultDataStore
};
