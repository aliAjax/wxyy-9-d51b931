'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const { createApp } = require('../src/app');
const { createFileDataStore } = require('../src/data-store');

const FIXTURE_DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

async function createTestEnvironment() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wxyy-test-'));
  const testDbPath = path.join(tmpDir, 'db.json');
  
  const fixtureContent = await fs.readFile(FIXTURE_DB_PATH, 'utf8');
  await fs.writeFile(testDbPath, fixtureContent);
  
  const dataStore = createFileDataStore(testDbPath);
  const app = createApp(dataStore, {
    publicDir: path.join(__dirname, '..', 'public')
  });
  
  const server = http.createServer(app);
  
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      
      resolve({
        tmpDir,
        testDbPath,
        dataStore,
        app,
        server,
        baseUrl,
        port,
        
        async cleanup() {
          await new Promise(r => server.close(r));
          await fs.rm(tmpDir, { recursive: true, force: true });
        },
        
        async request(method, pathname, body) {
          return new Promise((resolve, reject) => {
            const url = new URL(pathname, baseUrl);
            const options = {
              hostname: '127.0.0.1',
              port,
              path: url.pathname + url.search,
              method,
              headers: {}
            };
            
            if (body !== undefined) {
              const bodyStr = JSON.stringify(body);
              options.headers['Content-Type'] = 'application/json';
              options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
            }
            
            const req = http.request(options, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                let json = null;
                try {
                  json = JSON.parse(data);
                } catch (e) {
                  // not JSON
                }
                resolve({
                  status: res.statusCode,
                  headers: res.headers,
                  body: data,
                  json
                });
              });
            });
            
            req.on('error', reject);
            
            if (body !== undefined) {
              req.write(JSON.stringify(body));
            }
            req.end();
          });
        },
        
        get(p) { return this.request('GET', p); },
        post(p, b) { return this.request('POST', p, b); },
        patch(p, b) { return this.request('PATCH', p, b); },
        del(p) { return this.request('DELETE', p); }
      });
    });
  });
}

test('API 集成测试 - 配置接口', async (t) => {
  const env = await createTestEnvironment();
  try {
    await t.test('GET /api/config 返回配置', async () => {
      const res = await env.get('/api/config');
      assert.equal(res.status, 200);
      assert.ok(res.json);
      assert.equal(typeof res.json.title, 'string');
      assert.equal(typeof res.json.collections, 'object');
      assert.ok(res.json.collections.wigs);
    });
    
    await t.test('GET /api/db 返回完整数据库', async () => {
      const res = await env.get('/api/db');
      assert.equal(res.status, 200);
      assert.ok(res.json);
      assert.ok(Array.isArray(res.json.wigs));
      assert.ok(Array.isArray(res.json.repairs));
      assert.ok(Array.isArray(res.json.lendings));
    });
  } finally {
    await env.cleanup();
  }
});

test('API 集成测试 - 通用 CRUD', async (t) => {
  const env = await createTestEnvironment();
  try {
    let createdId;
    
    await t.test('POST /api/wigs 创建新假发', async () => {
      const res = await env.post('/api/wigs', {
        role: '测试角色',
        show: '测试剧目',
        color: '黑色',
        location: 'A1',
        performanceDate: '2025-01-01'
      });
      assert.equal(res.status, 201);
      assert.ok(res.json);
      assert.ok(res.json.id);
      assert.equal(res.json.role, '测试角色');
      createdId = res.json.id;
    });
    
    await t.test('GET /api/db 可以找到创建的假发', async () => {
      const res = await env.get('/api/db');
      assert.equal(res.status, 200);
      const found = res.json.wigs.find(w => w.id === createdId);
      assert.ok(found, '创建的假发应该在数据库中');
      assert.equal(found.role, '测试角色');
    });
    
    await t.test('PATCH /api/wigs/:id 更新假发（仅可编辑字段）', async () => {
      const res = await env.patch(`/api/wigs/${createdId}`, {
        location: 'B2',
        note: '测试备注'
      });
      assert.equal(res.status, 200);
      assert.ok(res.json);
      assert.equal(res.json.location, 'B2');
      assert.equal(res.json.note, '测试备注');
    });
    
    await t.test('DELETE /api/wigs/:id 删除假发返回 204', async () => {
      const res = await env.del(`/api/wigs/${createdId}`);
      assert.equal(res.status, 204);
      
      const dbRes = await env.get('/api/db');
      const found = dbRes.json.wigs.find(w => w.id === createdId);
      assert.equal(found, undefined);
    });
  } finally {
    await env.cleanup();
  }
});

test('API 集成测试 - 借出管理', async (t) => {
  const env = await createTestEnvironment();
  try {
    let wigId;
    let lendingId;
    
    await t.test('先创建一个假发用于借出测试', async () => {
      const res = await env.post('/api/wigs', {
        role: '借出测试角色',
        show: '借出测试剧目',
        color: '棕色',
        location: 'B2',
        performanceDate: '2025-02-01'
      });
      assert.equal(res.status, 201);
      wigId = res.json.id;
    });
    
    await t.test('POST /api/lendings 创建借出记录', async () => {
      const res = await env.post('/api/lendings', {
        wigId,
        actor: '张三',
        expectedReturnDate: '2025-12-31',
        purpose: '演出使用'
      });
      assert.equal(res.status, 201);
      assert.ok(res.json);
      assert.ok(res.json.id);
      assert.equal(res.json.wigId, wigId);
      assert.equal(res.json.status, '借出中');
      lendingId = res.json.id;
    });
    
    await t.test('GET /api/db 可以找到借出记录', async () => {
      const res = await env.get('/api/db');
      const found = res.json.lendings.find(l => l.id === lendingId);
      assert.ok(found);
      assert.equal(found.actor, '张三');
    });
    
    await t.test('PATCH /api/lendings/:id/check 归还检查', async () => {
      const res = await env.patch(`/api/lendings/${lendingId}/check`, {
        actualReturnDate: '2025-12-30',
        condition: '良好',
        returnNote: '按时归还'
      });
      assert.equal(res.status, 200);
      assert.ok(res.json);
    });
  } finally {
    await env.cleanup();
  }
});

test('API 集成测试 - 批量导入', async (t) => {
  const env = await createTestEnvironment();
  try {
    await t.test('POST /api/wigs/batch-import 批量导入假发', async () => {
      const res = await env.post('/api/wigs/batch-import', {
        rows: [
          { role: '批量测试1', show: '测试剧', color: '黑', location: 'C1', performanceDate: '2025-03-01' },
          { role: '批量测试2', show: '测试剧', color: '棕', location: 'C2', performanceDate: '2025-03-02' }
        ],
        duplicateMode: 'new'
      });
      assert.equal(res.status, 200);
      assert.ok(res.json);
      assert.equal(res.json.total, 2);
      assert.equal(res.json.created, 2);
    });
    
    await t.test('导入后数据库中有新记录', async () => {
      const res = await env.get('/api/db');
      const count = res.json.wigs.filter(w => w.role && w.role.startsWith('批量测试')).length;
      assert.equal(count, 2);
    });
  } finally {
    await env.cleanup();
  }
});

test('API 集成测试 - 数据隔离（每个测试环境独立）', async (t) => {
  const env1 = await createTestEnvironment();
  const env2 = await createTestEnvironment();
  
  try {
    await t.test('两个环境的数据互不影响', async () => {
      const createRes = await env1.post('/api/wigs', {
        role: '环境1专属',
        show: '测试',
        color: '红',
        location: 'C1',
        performanceDate: '2025-03-01'
      });
      assert.equal(createRes.status, 201);
      
      const db1 = await env1.get('/api/db');
      const db2 = await env2.get('/api/db');
      
      const env1HasSpecial = db1.json.wigs.some(w => w.role === '环境1专属');
      const env2HasSpecial = db2.json.wigs.some(w => w.role === '环境1专属');
      
      assert.equal(env1HasSpecial, true, '环境1应该有专属数据');
      assert.equal(env2HasSpecial, false, '环境2不应该有环境1的数据');
    });
  } finally {
    await env1.cleanup();
    await env2.cleanup();
  }
});
