'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  findDuplicateWig,
  processBatchImport,
  deepClone,
  BATCH_IMPORT_REQUIRED_FIELDS
} = require('./server.js');

const FIXED_NOW = '2026-06-21T12:00:00.000Z';

function createEmptyDb() {
  return {
    wigs: [],
    auditLogs: []
  };
}

function createSeedDb() {
  return {
    wigs: [
      {
        id: 'wig-seed-1',
        role: '夜游女王',
        show: '午夜花园',
        color: '银灰混蓝',
        capSize: 'M',
        hairline: '手勾蕾丝前额',
        location: 'A柜-03',
        status: '可演出',
        performanceDate: '2026-07-03',
        note: '原始备注',
        createdAt: '2026-06-15T08:00:00.000Z',
        updatedAt: '2026-06-15T08:00:00.000Z',
        history: [{ at: '2026-06-15T08:00:00.000Z', action: '建档', note: '初始' }]
      }
    ],
    auditLogs: []
  };
}

function makeValidRow(overrides = {}) {
  return {
    role: '女主角',
    show: '茶花女',
    color: '深棕',
    location: 'B柜-01',
    performanceDate: '2026-08-15',
    ...overrides
  };
}

let idCounter = 0;
function deterministicId() {
  idCounter++;
  return `wig-test-${idCounter}`;
}

function importOptions() {
  idCounter = 0;
  return {
    now: FIXED_NOW,
    idGenerator: deterministicId
  };
}

describe('findDuplicateWig', () => {
  test('匹配四字段完全一致时返回档案', () => {
    const db = createSeedDb();
    const match = findDuplicateWig(db, '夜游女王', '午夜花园', '2026-07-03', 'A柜-03');
    assert.ok(match);
    assert.equal(match.id, 'wig-seed-1');
  });

  test('任一字段不匹配时返回 null', () => {
    const db = createSeedDb();
    assert.equal(findDuplicateWig(db, '其他角色', '午夜花园', '2026-07-03', 'A柜-03'), null);
    assert.equal(findDuplicateWig(db, '夜游女王', '其他剧目', '2026-07-03', 'A柜-03'), null);
    assert.equal(findDuplicateWig(db, '夜游女王', '午夜花园', '2026-07-04', 'A柜-03'), null);
    assert.equal(findDuplicateWig(db, '夜游女王', '午夜花园', '2026-07-03', 'B柜-01'), null);
  });

  test('空数据库返回 null', () => {
    const db = createEmptyDb();
    assert.equal(findDuplicateWig(db, '夜游女王', '午夜花园', '2026-07-03', 'A柜-03'), null);
  });
});

describe('批量导入 - 缺失必填字段', () => {
  test('全部必填字段缺失时整行失败', () => {
    const db = createEmptyDb();
    const result = processBatchImport(db, [{}], [], importOptions());

    assert.equal(result.total, 1);
    assert.equal(result.fail, 1);
    assert.equal(result.created, 0);
    assert.equal(result.success, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].row, 1);
    assert.deepEqual(
      result.failures[0].missingFields.sort(),
      BATCH_IMPORT_REQUIRED_FIELDS.sort()
    );
    assert.equal(db.wigs.length, 0);
  });

  test('部分必填字段缺失时报告具体缺失项', () => {
    const db = createEmptyDb();
    const row = makeValidRow({ role: '', show: '  ' });
    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.fail, 1);
    assert.deepEqual(
      result.failures[0].missingFields.sort(),
      ['role', 'show'].sort()
    );
  });

  test('仅空格字符串视为缺失', () => {
    const db = createEmptyDb();
    const row = makeValidRow({
      role: '   ',
      color: '\t\n'
    });
    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.fail, 1);
    assert.ok(result.failures[0].missingFields.includes('role'));
    assert.ok(result.failures[0].missingFields.includes('color'));
  });

  test('缺失字段的行不写入数据库', () => {
    const db = createEmptyDb();
    const badRow = { role: 'A', show: '' };
    const goodRow = makeValidRow({ role: '合法角色' });
    const result = processBatchImport(db, [badRow, goodRow], ['new', 'new'], importOptions());

    assert.equal(result.fail, 1);
    assert.equal(result.created, 1);
    assert.equal(db.wigs.length, 1);
    assert.equal(db.wigs[0].role, '合法角色');
  });
});

describe('批量导入 - 可选字段默认值', () => {
  test('未提供可选字段时填入默认值', () => {
    const db = createEmptyDb();
    const row = makeValidRow();
    delete row.capSize;
    delete row.hairline;
    delete row.status;
    delete row.note;

    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.created, 1);
    const item = db.wigs[0];
    assert.equal(item.capSize, 'M');
    assert.equal(item.hairline, '普通前网');
    assert.equal(item.status, '可演出');
    assert.equal(item.note, '');
  });

  test('显式提供可选字段时覆盖默认值', () => {
    const db = createEmptyDb();
    const row = makeValidRow({
      capSize: 'L',
      hairline: '手勾蕾丝前额',
      status: '需要维修',
      note: '自定义备注'
    });

    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.created, 1);
    const item = db.wigs[0];
    assert.equal(item.capSize, 'L');
    assert.equal(item.hairline, '手勾蕾丝前额');
    assert.equal(item.status, '需要维修');
    assert.equal(item.note, '自定义备注');
  });

  test('undefined 或 null 的可选字段回退到默认值', () => {
    const db = createEmptyDb();
    const row = makeValidRow({
      capSize: undefined,
      hairline: null,
      status: undefined
    });

    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.created, 1);
    const item = db.wigs[0];
    assert.equal(item.capSize, 'M');
    assert.equal(item.hairline, '普通前网');
    assert.equal(item.status, '可演出');
  });

  test('含空格字符串的可选字段被 trim 为空字符串（不回退默认值）', () => {
    const db = createEmptyDb();
    const row = makeValidRow({
      capSize: '  ',
      hairline: '   ',
      note: '\t\n'
    });

    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.created, 1);
    const item = db.wigs[0];
    assert.equal(item.capSize, '');
    assert.equal(item.hairline, '');
    assert.equal(item.note, '');
  });

  test('空字符串可选字段作为 falsy 回退到默认值', () => {
    const db = createEmptyDb();
    const row = makeValidRow({
      capSize: '',
      hairline: '',
      status: ''
    });

    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.created, 1);
    const item = db.wigs[0];
    assert.equal(item.capSize, 'M');
    assert.equal(item.hairline, '普通前网');
    assert.equal(item.status, '可演出');
  });

  test('新建记录包含正确的时间戳和历史', () => {
    const db = createEmptyDb();
    const row = makeValidRow({ note: '测试备注' });

    const result = processBatchImport(db, [row], [], importOptions());

    assert.equal(result.created, 1);
    const item = db.wigs[0];
    assert.equal(item.createdAt, FIXED_NOW);
    assert.equal(item.updatedAt, FIXED_NOW);
    assert.equal(Array.isArray(item.history), true);
    assert.equal(item.history.length, 1);
    assert.equal(item.history[0].action, '批量导入创建');
    assert.equal(item.history[0].note, '测试备注');
  });
});

describe('批量导入 - 重复档案校验', () => {
  test('默认模式（new）遇到重复仍创建新档案', () => {
    const db = createSeedDb();
    const duplicateRow = {
      role: '夜游女王',
      show: '午夜花园',
      color: '银灰混蓝',
      location: 'A柜-03',
      performanceDate: '2026-07-03'
    };

    const result = processBatchImport(db, [duplicateRow], [], importOptions());

    assert.equal(result.created, 1);
    assert.equal(db.wigs.length, 2);
    const created = result.createdItems[0];
    assert.notEqual(created.id, 'wig-seed-1');
  });

  test('skip 模式遇到重复时跳过并记录', () => {
    const db = createSeedDb();
    const duplicateRow = {
      role: '夜游女王',
      show: '午夜花园',
      color: '银灰混蓝',
      location: 'A柜-03',
      performanceDate: '2026-07-03'
    };

    const result = processBatchImport(db, [duplicateRow], ['skip'], importOptions());

    assert.equal(result.skipped, 1);
    assert.equal(result.created, 0);
    assert.equal(db.wigs.length, 1);
    assert.equal(db.wigs[0].id, 'wig-seed-1');
    assert.equal(result.skippedItems.length, 1);
    assert.equal(result.skippedItems[0].existingId, 'wig-seed-1');
    assert.equal(result.skippedItems[0].row, 1);
  });

  test('overwrite 模式更新已有档案的备注和状态', () => {
    const db = createSeedDb();
    const duplicateRow = {
      role: '夜游女王',
      show: '午夜花园',
      color: '银灰混蓝',
      location: 'A柜-03',
      performanceDate: '2026-07-03',
      status: '需要维修',
      note: '更新后的备注'
    };

    const beforeClone = deepClone(db.wigs[0]);
    const result = processBatchImport(db, [duplicateRow], ['overwrite'], importOptions());

    assert.equal(result.updated, 1);
    assert.equal(result.created, 0);
    assert.equal(db.wigs.length, 1);
    const wig = db.wigs[0];
    assert.equal(wig.status, '需要维修');
    assert.equal(wig.note, '更新后的备注');
    assert.equal(wig.updatedAt, FIXED_NOW);
    assert.equal(wig.createdAt, beforeClone.createdAt);
    assert.ok(wig.history.length > beforeClone.history.length);
    assert.equal(wig.history[0].action, '批量导入更新');
    assert.ok(result.updatedItems[0].changes.length >= 2);
  });

  test('overwrite 模式未提供可选字段时保留原值', () => {
    const db = createSeedDb();
    const original = db.wigs[0];
    const duplicateRow = {
      role: '夜游女王',
      show: '午夜花园',
      color: '银灰混蓝',
      location: 'A柜-03',
      performanceDate: '2026-07-03'
    };

    const result = processBatchImport(db, [duplicateRow], ['overwrite'], importOptions());

    assert.equal(result.updated, 1);
    const wig = db.wigs[0];
    assert.equal(wig.status, original.status);
    assert.equal(wig.note, original.note);
    assert.equal(result.updatedItems[0].changes.length, 0);
  });

  test('非重复档案在 overwrite 模式下仍会新建', () => {
    const db = createSeedDb();
    const row = makeValidRow();

    const result = processBatchImport(db, [row], ['overwrite'], importOptions());

    assert.equal(result.created, 1);
    assert.equal(result.updated, 0);
    assert.equal(db.wigs.length, 2);
  });
});

describe('批量导入 - 只导入合法行（混合场景）', () => {
  test('混合失败、跳过、新建、更新时各自独立处理', () => {
    const db = createSeedDb();

    const rows = [
      makeValidRow({ role: '新角色A' }),
      { role: '', show: '缺失字段剧' },
      {
        role: '夜游女王',
        show: '午夜花园',
        color: '银灰混蓝',
        location: 'A柜-03',
        performanceDate: '2026-07-03'
      },
      makeValidRow({ role: '新角色B', show: '另一场' }),
      {
        role: '夜游女王',
        show: '午夜花园',
        color: '银灰混蓝',
        location: 'A柜-03',
        performanceDate: '2026-07-03',
        status: '维修中',
        note: '覆盖更新'
      },
      makeValidRow({ color: '' })
    ];

    const duplicateModes = ['new', 'new', 'skip', 'new', 'overwrite', 'new'];

    const result = processBatchImport(db, rows, duplicateModes, importOptions());

    assert.equal(result.total, 6);
    assert.equal(result.created, 2);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.fail, 2);
    assert.equal(result.success, 3);
    assert.equal(db.wigs.length, 3);

    const roles = db.wigs.map(w => w.role).sort();
    assert.deepEqual(roles, ['夜游女王', '新角色A', '新角色B']);

    const updatedWig = db.wigs.find(w => w.id === 'wig-seed-1');
    assert.equal(updatedWig.status, '维修中');
    assert.equal(updatedWig.note, '覆盖更新');

    assert.equal(result.failures.length, 2);
    assert.equal(result.failures[0].row, 2);
    assert.equal(result.failures[1].row, 6);

    assert.equal(result.skippedItems.length, 1);
    assert.equal(result.skippedItems[0].row, 3);
  });

  test('行号按输入顺序从 1 开始计数', () => {
    const db = createEmptyDb();
    const rows = [
      { role: '' },
      makeValidRow({ role: 'R1' }),
      { show: '' }
    ];

    const result = processBatchImport(db, rows, ['new', 'new', 'new'], importOptions());

    assert.equal(result.failures[0].row, 1);
    assert.equal(result.failures[1].row, 3);
    assert.equal(result.createdItems[0].role, 'R1');
  });

  test('空输入数组返回零计数', () => {
    const db = createEmptyDb();
    const result = processBatchImport(db, [], [], importOptions());

    assert.equal(result.total, 0);
    assert.equal(result.created, 0);
    assert.equal(result.fail, 0);
    assert.equal(result.success, 0);
    assert.equal(db.wigs.length, 0);
  });

  test('hasWrite 标记反映是否有数据库变更', () => {
    const db1 = createEmptyDb();
    const r1 = processBatchImport(db1, [{ role: '' }], [], importOptions());
    assert.equal(r1.hasWrite, false);

    const db2 = createEmptyDb();
    const r2 = processBatchImport(db2, [makeValidRow()], [], importOptions());
    assert.equal(r2.hasWrite, true);

    const db3 = createSeedDb();
    const duplicateRow = {
      role: '夜游女王',
      show: '午夜花园',
      color: '银灰混蓝',
      location: 'A柜-03',
      performanceDate: '2026-07-03'
    };
    const r3 = processBatchImport(db3, [duplicateRow], ['skip'], importOptions());
    assert.equal(r3.hasWrite, false);
  });

  test('生成审计日志', () => {
    const db = createEmptyDb();
    const row = makeValidRow({ note: '带备注' });

    processBatchImport(db, [row], [], importOptions());

    assert.ok(db.auditLogs.length >= 1);
    const log = db.auditLogs.find(l => l.collection === 'wigs');
    assert.ok(log);
    assert.equal(log.operationType, 'create');
    assert.equal(log.actionLabel, '批量导入创建');
    assert.ok(log.after);
    assert.equal(log.after.note, '带备注');
  });
});
