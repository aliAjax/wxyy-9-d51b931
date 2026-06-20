const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const config = require('./project.config');
const PORT = process.env.PORT || config.port || 3900;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function readDb() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2) + '\n');
}

function stamp(action, note) {
  return {
    at: new Date().toISOString(),
    action,
    note: note || ''
  };
}

function sortNewest(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
}

const AUDIT_COLLECTIONS = ['wigs', 'repairs', 'repairReviews', 'schedules', 'preChecklists', 'lendings', 'consumables', 'staff'];

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getTargetLabel(collection, item) {
  if (!item) return '';
  const labelMap = {
    wigs: () => [item.role, item.show].filter(Boolean).join(' / '),
    repairs: () => item.type,
    repairReviews: () => item.conclusion || '复盘记录',
    schedules: () => [item.show, item.performanceDate].filter(Boolean).join(' / '),
    preChecklists: () => [item.show, item.performanceDate].filter(Boolean).join(' / '),
    lendings: () => [item.actor, item.show].filter(Boolean).join(' / '),
    consumables: () => item.name,
    staff: () => item.name
  };
  return labelMap[collection] ? labelMap[collection]() : item.id;
}

function getSummary(operationType, collection, before, after, actionLabel) {
  const label = config.collections[collection]?.label || collection;
  const targetLabel = getTargetLabel(collection, after || before);

  if (operationType === 'create') {
    return `创建${label}：${targetLabel}`;
  }
  if (operationType === 'delete') {
    return `删除${label}：${targetLabel}`;
  }
  if (operationType === 'action') {
    return `动作「${actionLabel}」：${targetLabel}`;
  }
  const changedFields = [];
  if (before && after) {
    for (const key of Object.keys(after)) {
      if (['updatedAt', 'history'].includes(key)) continue;
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changedFields.push(key);
      }
    }
  }
  const fieldDesc = changedFields.length > 0 ? `（${changedFields.slice(0, 3).join('、')}${changedFields.length > 3 ? '...' : ''}）` : '';
  return `更新${label}${fieldDesc}：${targetLabel}`;
}

function createAuditLog(db, operationType, collection, targetId, before, after, options = {}) {
  const { actionLabel = '', relatedChanges = [] } = options;

  db.auditLogs = db.auditLogs || [];

  const log = {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    operationType,
    collection,
    targetId,
    targetLabel: getTargetLabel(collection, after || before),
    actionLabel,
    before: before ? deepClone(before) : null,
    after: after ? deepClone(after) : null,
    relatedChanges: relatedChanges.map(rc => ({
      collection: rc.collection,
      targetId: rc.targetId,
      targetLabel: getTargetLabel(rc.collection, rc.after || rc.before),
      before: rc.before ? deepClone(rc.before) : null,
      after: rc.after ? deepClone(rc.after) : null
    })),
    summary: getSummary(operationType, collection, before, after, actionLabel),
    createdAt: new Date().toISOString(),
    undone: false,
    undoneAt: null
  };

  db.auditLogs.unshift(log);
  return log;
}

function findLatestOperation(db, collection, targetId, ignoreAuditId) {
  return (db.auditLogs || []).find(log =>
    !log.undone &&
    log.id !== ignoreAuditId &&
    log.collection === collection &&
    log.targetId === targetId
  );
}

function hasDependencies(db, auditLog) {
  const { collection, targetId, operationType, id } = auditLog;

  for (const log of db.auditLogs || []) {
    if (log.undone || log.id === id) continue;

    if (new Date(log.createdAt) <= new Date(auditLog.createdAt)) continue;

    if (log.collection === collection && log.targetId === targetId) {
      return {
        canUndo: false,
        reason: `后续操作「${log.summary}」已修改该数据，无法撤销`
      };
    }

    for (const rc of log.relatedChanges || []) {
      if (rc.collection === collection && rc.targetId === targetId) {
        return {
          canUndo: false,
          reason: `后续操作「${log.summary}」依赖该数据，无法撤销`
        };
      }
    }

    if (operationType === 'create') {
      const checkRefs = (item) => {
        if (!item || typeof item !== 'object') return false;
        for (const key of Object.keys(item)) {
          if (item[key] === targetId) return true;
          if (typeof item[key] === 'object' && checkRefs(item[key])) return true;
        }
        return false;
      };
      if (log.after && checkRefs(log.after)) {
        return {
          canUndo: false,
          reason: `后续操作「${log.summary}」引用了该数据，无法撤销`
        };
      }
      for (const rc of log.relatedChanges || []) {
        if (rc.after && checkRefs(rc.after)) {
          return {
            canUndo: false,
            reason: `后续操作「${log.summary}」引用了该数据，无法撤销`
          };
        }
      }
    }
  }

  return { canUndo: true };
}

function undoAuditLog(db, auditLog) {
  const { operationType, collection, targetId, before, after, relatedChanges = [] } = auditLog;

  const mainChange = { collection, targetId, before, after, _isMain: true, _mainOpType: operationType };
  const allChanges = [mainChange, ...relatedChanges];

  for (const change of allChanges) {
    const { collection: col, targetId: tid, before: bf, after: af, _isMain, _mainOpType } = change;

    if (!AUDIT_COLLECTIONS.includes(col)) continue;
    if (!Array.isArray(db[col])) continue;

    const idx = db[col].findIndex(item => item.id === tid);

    let changeType;
    if (_isMain) {
      changeType = _mainOpType;
    } else {
      if (bf === null || bf === undefined) changeType = 'create';
      else if (af === null || af === undefined) changeType = 'delete';
      else changeType = 'update';
    }

    if (changeType === 'create') {
      if (idx !== -1) {
        db[col].splice(idx, 1);
      }
    } else if (changeType === 'delete') {
      if (idx === -1 && bf) {
        db[col].push(deepClone(bf));
      }
    } else {
      if (idx !== -1 && bf) {
        db[col][idx] = deepClone(bf);
      }
    }
  }

  auditLog.undone = true;
  auditLog.undoneAt = new Date().toISOString();

  return true;
}

app.get('/api/audit-logs', async (req, res) => {
  const db = await readDb();
  const { limit = 50, offset = 0, undone } = req.query;

  let logs = db.auditLogs || [];

  if (undone !== undefined) {
    const undoneFlag = undone === 'true';
    logs = logs.filter(log => log.undone === undoneFlag);
  }

  const total = logs.length;
  const paginatedLogs = logs.slice(Number(offset), Number(offset) + Number(limit));

  const logsWithCanUndo = paginatedLogs.map(log => {
    const depCheck = hasDependencies(db, log);
    return {
      ...log,
      canUndo: !log.undone && depCheck.canUndo,
      cannotUndoReason: depCheck.reason || null
    };
  });

  res.json({
    data: logsWithCanUndo,
    total,
    limit: Number(limit),
    offset: Number(offset)
  });
});

app.post('/api/audit-logs/:id/undo', async (req, res) => {
  const db = await readDb();
  const { id } = req.params;

  const auditLog = (db.auditLogs || []).find(log => log.id === id);
  if (!auditLog) {
    return res.status(404).json({ error: '审计记录不存在' });
  }

  if (auditLog.undone) {
    return res.status(400).json({ error: '该操作已被撤销，无法重复撤销' });
  }

  const depCheck = hasDependencies(db, auditLog);
  if (!depCheck.canUndo) {
    return res.status(409).json({ error: depCheck.reason });
  }

  try {
    undoAuditLog(db, auditLog);
    await writeDb(db);

    res.json({
      success: true,
      message: '撤销成功',
      log: auditLog
    });
  } catch (error) {
    res.status(500).json({ error: `撤销失败：${error.message}` });
  }
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/db', async (req, res) => {
  const db = await readDb();
  for (const key of Object.keys(db)) {
    if (Array.isArray(db[key])) db[key].sort(sortNewest);
  }
  res.json(db);
});

app.post('/api/lendings', async (req, res) => {
  const db = await readDb();
  const now = new Date().toISOString();
  const body = req.body || {};

  const wig = db.wigs?.find((w) => w.id === body.wigId);
  if (!wig) return res.status(404).json({ error: '假发不存在' });

  if (wig.status === '借出中' || wig.status === '归还待检查') {
    return res.status(409).json({ error: '该假发已处于借出或待检查状态，不能重复借出' });
  }

  const activeLending = (db.lendings || []).find(
    (l) => l.wigId === body.wigId && (l.status === '借出中' || l.status === '归还待检查')
  );
  if (activeLending) {
    return res.status(409).json({ error: '该假发存在未完成的借出记录' });
  }

  const wigBefore = deepClone(wig);

  const item = {
    id: `lending-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    wigId: body.wigId,
    actor: body.actor || '',
    show: body.show || '',
    role: body.role || '',
    lendDate: body.lendDate || new Date().toISOString().split('T')[0],
    expectedReturnDate: body.expectedReturnDate || '',
    actualReturnDate: '',
    status: body.status || '借出中',
    checkItems: (config.checkItems || []).map((name) => ({
      name,
      result: '',
      note: ''
    })),
    checkFindings: '',
    checker: '',
    checkedAt: '',
    note: body.note || '',
    createdAt: now,
    updatedAt: now,
    history: [stamp('登记借出', body.note ? body.note : `借给 ${body.actor || '演员'}，用于 ${body.show || '演出'}`)]
  };

  db.lendings = db.lendings || [];
  db.lendings.push(item);

  const relatedChanges = [];
  if (wig) {
    wig.status = '借出中';
    wig.updatedAt = now;
    wig.history = wig.history || [];
    wig.history.unshift(stamp('借出', `借给 ${body.actor || '演员'}，用于 ${body.show || '演出'}`));
    relatedChanges.push({
      collection: 'wigs',
      targetId: wig.id,
      before: wigBefore,
      after: deepClone(wig)
    });
  }

  createAuditLog(db, 'create', 'lendings', item.id, null, item, { relatedChanges });

  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/lendings/:id/check', async (req, res) => {
  const db = await readDb();
  const { id } = req.params;
  const { checkItems, checkFindings, checker, status, reset } = req.body;

  const lending = (db.lendings || []).find((l) => l.id === id);
  if (!lending) return res.status(404).json({ error: '借出记录不存在' });

  const now = new Date().toISOString();
  const prevStatus = lending.status;

  const lendingBefore = deepClone(lending);

  const wig = (db.wigs || []).find((w) => w.id === lending.wigId);
  const wigBefore = wig ? deepClone(wig) : null;

  if (reset) {
    lending.checkItems = (config.checkItems || []).map((name) => ({
      name,
      result: '',
      note: ''
    }));
    lending.checkFindings = '';
    lending.checker = '';
    lending.checkedAt = '';
    lending.status = '归还待检查';
    lending.updatedAt = now;
    lending.history = lending.history || [];
    lending.history.unshift(stamp('重新检查', '清空旧结果，重置为归还待检查状态'));

    if (wig) {
      wig.status = '归还待检查';
      wig.updatedAt = now;
      wig.history = wig.history || [];
      wig.history.unshift(stamp('归还重新检查', '归还检查已重置'));
    }
  } else {
    if (checkItems) lending.checkItems = checkItems;
    if (checkFindings !== undefined) lending.checkFindings = checkFindings;
    if (checker) lending.checker = checker;

    if (status && status !== prevStatus) {
      if ((status === '归还检查通过' || status === '归还检查不通过') && prevStatus !== '归还待检查') {
        return res.status(409).json({ error: '只有归还待检查状态可以执行归还检查' });
      }

      if (status === '归还检查通过') {
        lending.status = status;
        lending.actualReturnDate = new Date().toISOString().split('T')[0];
        lending.checkedAt = now;
        if (wig) {
          const activeRepairs = (db.repairs || []).filter(
            (r) => r.wigId === wig.id && ['待处理', '维修中', '待检查'].includes(r.status)
          );
          wig.status = activeRepairs.length > 0
            ? (wig.status === '紧急维修' ? '紧急维修' : '需要维修')
            : '可演出';
          wig.updatedAt = now;
          wig.history = wig.history || [];
          wig.history.unshift(stamp(
            '归还检查通过',
            activeRepairs.length > 0
              ? `归还检查通过，但仍有 ${activeRepairs.length} 个未完成维修单，保持维修状态`
              : '归还检查通过，恢复为可演出状态'
          ));
        }
        lending.history = lending.history || [];
        lending.history.unshift(stamp('归还检查通过', checkFindings || '检查合格，已归还'));
      } else if (status === '归还检查不通过') {
        lending.status = status;
        lending.actualReturnDate = new Date().toISOString().split('T')[0];
        lending.checkedAt = now;
        if (wig) {
          wig.status = '需要维修';
          wig.updatedAt = now;
          wig.history = wig.history || [];
          wig.history.unshift(stamp('归还检查不通过', `发现问题：${checkFindings || '需维修'}`));
        }
        lending.history = lending.history || [];
        lending.history.unshift(stamp('归还检查不通过', checkFindings || '发现问题需维修'));
      } else if (status === '归还待检查' && prevStatus === '借出中') {
        lending.status = status;
        lending.actualReturnDate = new Date().toISOString().split('T')[0];
        lending.history = lending.history || [];
        lending.history.unshift(stamp('提交归还', '已归还，待检查'));
        if (wig) {
          wig.status = '归还待检查';
          wig.updatedAt = now;
          wig.history = wig.history || [];
          wig.history.unshift(stamp('归还待检查', '演员已归还，待检查验收'));
        }
      }
    } else if (status === '归还待检查' && prevStatus === '归还待检查') {
      lending.history = lending.history || [];
      lending.history.unshift(stamp('保存草稿', checkFindings || '已保存检查草稿'));
    }

    lending.updatedAt = now;
  }

  const relatedChanges = [];
  if (wig && wigBefore) {
    if (JSON.stringify(wigBefore) !== JSON.stringify(wig)) {
      relatedChanges.push({
        collection: 'wigs',
        targetId: wig.id,
        before: wigBefore,
        after: deepClone(wig)
      });
    }
  }

  createAuditLog(db, 'update', 'lendings', lending.id, lendingBefore, deepClone(lending), { relatedChanges });

  await writeDb(db);
  res.json(lending);
});

app.post('/api/repair-reviews', async (req, res) => {
  const db = await readDb();
  const body = req.body || {};

  const repair = db.repairs?.find((r) => r.id === body.repairId);
  if (!repair) return res.status(404).json({ error: '维修单不存在' });

  if (repair.status !== '已完成') {
    return res.status(409).json({ error: '只有已完成的维修单才能创建复盘记录' });
  }

  const existingReview = (db.repairReviews || []).find((r) => r.repairId === body.repairId);
  if (existingReview) {
    return res.status(409).json({ error: '该维修单已有复盘记录，不能重复创建' });
  }

  const wig = db.wigs?.find((w) => w.id === repair.wigId);
  const wigBefore = wig ? deepClone(wig) : null;

  const now = new Date().toISOString();
  const item = {
    id: `repairReview-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    repairId: body.repairId,
    wigId: repair.wigId,
    conclusion: body.conclusion || '',
    reworkReason: body.reworkReason || '',
    timeScore: body.timeScore || '3',
    affectsPerformance: body.affectsPerformance || '否',
    reviewer: body.reviewer || '',
    reviewedAt: now,
    status: '已复盘',
    note: body.note || '',
    createdAt: now,
    updatedAt: now,
    history: [stamp('创建复盘', body.conclusion ? `结论：${body.conclusion}` : '')]
  };

  db.repairReviews = db.repairReviews || [];
  db.repairReviews.push(item);

  const relatedChanges = [];
  if (wig) {
    wig.history = wig.history || [];
    wig.history.unshift(stamp('维修复盘', `维修类型：${repair.type}，复盘人：${body.reviewer || '未填写'}`));
    wig.updatedAt = now;
    if (wigBefore) {
      relatedChanges.push({
        collection: 'wigs',
        targetId: wig.id,
        before: wigBefore,
        after: deepClone(wig)
      });
    }
  }

  createAuditLog(db, 'create', 'repairReviews', item.id, null, item, { relatedChanges });

  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/repair-reviews/:id', async (req, res) => {
  const db = await readDb();
  const { id } = req.params;
  const body = req.body || {};

  const review = db.repairReviews?.find((r) => r.id === id);
  if (!review) return res.status(404).json({ error: '复盘记录不存在' });

  const reviewBefore = deepClone(review);

  const now = new Date().toISOString();
  const oldConclusion = review.conclusion;

  if (body.conclusion !== undefined) review.conclusion = body.conclusion;
  if (body.reworkReason !== undefined) review.reworkReason = body.reworkReason;
  if (body.timeScore !== undefined) review.timeScore = body.timeScore;
  if (body.affectsPerformance !== undefined) review.affectsPerformance = body.affectsPerformance;
  if (body.reviewer !== undefined) review.reviewer = body.reviewer;
  if (body.note !== undefined) review.note = body.note;

  review.updatedAt = now;
  review.history = review.history || [];
  review.history.unshift(stamp('更新复盘', body.conclusion && body.conclusion !== oldConclusion ? `结论更新：${body.conclusion}` : '复盘信息已更新'));

  createAuditLog(db, 'update', 'repairReviews', review.id, reviewBefore, deepClone(review));

  await writeDb(db);
  res.json(review);
});

app.post('/api/:collection', async (req, res) => {
  const db = await readDb();
  const { collection } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const now = new Date().toISOString();
  const item = {
    id: `${collection}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    ...req.body,
    createdAt: now,
    updatedAt: now,
    history: [stamp('创建', req.body.note || req.body.memo || '')]
  };
  db[collection].push(item);

  if (AUDIT_COLLECTIONS.includes(collection)) {
    createAuditLog(db, 'create', collection, item.id, null, item);
  }

  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });

  if ((collection === 'wigs' || collection === 'lendings') && req.body.status !== undefined && req.body.status !== item.status) {
    return res.status(409).json({ error: '不能直接修改状态字段，请使用专用动作接口' });
  }

  const itemBefore = AUDIT_COLLECTIONS.includes(collection) ? deepClone(item) : null;

  const historyAction = req.body.historyAction;
  delete req.body.historyAction;
  Object.assign(item, req.body, { updatedAt: new Date().toISOString() });
  item.history = item.history || [];
  if (historyAction || req.body.note || req.body.memo || req.body.status) {
    item.history.unshift(stamp(historyAction || req.body.status || '更新', req.body.note || req.body.memo || ''));
  }

  if (AUDIT_COLLECTIONS.includes(collection) && itemBefore) {
    createAuditLog(db, 'update', collection, id, itemBefore, deepClone(item));
  }

  await writeDb(db);
  res.json(item);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });

  const itemBefore = AUDIT_COLLECTIONS.includes(collection)
    ? deepClone(db[collection].find((entry) => entry.id === id))
    : null;

  const relatedChanges = [];
  if (collection === 'lendings') {
    const lending = db.lendings.find((l) => l.id === id);
    if (lending && (lending.status === '借出中' || lending.status === '归还待检查')) {
      const wig = db.wigs?.find((w) => w.id === lending.wigId);
      if (wig) {
        const wigBefore = deepClone(wig);
        wig.status = '可演出';
        wig.updatedAt = new Date().toISOString();
        wig.history = wig.history || [];
        wig.history.unshift(stamp('借出记录删除', '删除借出记录，恢复为可演出状态'));
        relatedChanges.push({
          collection: 'wigs',
          targetId: wig.id,
          before: wigBefore,
          after: deepClone(wig)
        });
      }
    }
  }

  const before = db[collection].length;
  db[collection] = db[collection].filter((entry) => entry.id !== id);
  if (db[collection].length === before) return res.status(404).json({ error: 'not found' });

  if (AUDIT_COLLECTIONS.includes(collection) && itemBefore) {
    createAuditLog(db, 'delete', collection, id, itemBefore, null, { relatedChanges });
  }

  await writeDb(db);
  res.status(204).end();
});

app.patch('/api/repairs/:id/reassign', async (req, res) => {
  const db = await readDb();
  const { id } = req.params;
  const { newHandler, note } = req.body;

  if (!newHandler) return res.status(400).json({ error: '请选择新的处理人' });

  const repair = db.repairs?.find((entry) => entry.id === id);
  if (!repair) return res.status(404).json({ error: '维修单不存在' });

  const repairBefore = deepClone(repair);

  const oldHandler = repair.handler;
  if (newHandler === oldHandler) {
    return res.status(400).json({ error: '请选择其他处理人' });
  }

  const oldHandlerName = oldHandler
    ? (db.staff?.find((s) => s.id === oldHandler)?.name || oldHandler)
    : '未指派';
  const newHandlerName = db.staff?.find((s) => s.id === newHandler)?.name || newHandler;

  repair.handler = newHandler;
  repair.updatedAt = new Date().toISOString();
  repair.history = repair.history || [];
  repair.history.unshift(stamp(
    '重新指派',
    note ? `从 ${oldHandlerName} 转交给 ${newHandlerName}，备注：${note}` : `从 ${oldHandlerName} 转交给 ${newHandlerName}`
  ));

  createAuditLog(db, 'update', 'repairs', repair.id, repairBefore, deepClone(repair));

  await writeDb(db);
  res.json(repair);
});

app.get('/api/dispatch-board', async (req, res) => {
  const db = await readDb();
  const staff = db.staff || [];
  const repairs = db.repairs || [];
  const activeStatuses = ['待处理', '维修中', '待检查'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const board = {};

  for (const person of staff) {
    const personRepairs = repairs.filter((r) => r.handler === person.id);
    const activeRepairs = personRepairs.filter((r) => activeStatuses.includes(r.status));
    const overdue = activeRepairs.filter((r) => {
      if (!r.dueDate) return false;
      const due = new Date(r.dueDate);
      due.setHours(0, 0, 0, 0);
      return due < today;
    });

    board[person.id] = {
      id: person.id,
      name: person.name,
      specialty: person.specialty,
      contact: person.contact,
      activeCount: activeRepairs.length,
      overdueCount: overdue.length,
      repairs: personRepairs
        .filter((r) => activeStatuses.includes(r.status))
        .sort((a, b) => {
          const aOverdue = a.dueDate && new Date(a.dueDate) < today;
          const bOverdue = b.dueDate && new Date(b.dueDate) < today;
          if (aOverdue && !bOverdue) return -1;
          if (!aOverdue && bOverdue) return 1;
          return new Date(a.dueDate || 0) - new Date(b.dueDate || 0);
        })
    };
  }

  const unassigned = repairs.filter((r) => !r.handler && activeStatuses.includes(r.status));
  if (unassigned.length) {
    board['unassigned'] = {
      id: 'unassigned',
      name: '待分配',
      specialty: '',
      contact: '',
      activeCount: unassigned.length,
      overdueCount: unassigned.filter((r) => r.dueDate && new Date(r.dueDate) < today).length,
      repairs: unassigned.sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0))
    };
  }

  res.json(board);
});

app.post('/api/action/:actionId/:id', async (req, res) => {
  const db = await readDb();
  const action = config.actions.find((entry) => entry.id === req.params.actionId);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  const item = db[action.collection]?.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const result = runAction(db, action, item);
  if (result.error) return res.status(409).json({ error: result.error });

  if (AUDIT_COLLECTIONS.includes(action.collection) && result.auditData) {
    createAuditLog(db, 'action', action.collection, item.id,
      result.auditData.itemBefore, result.auditData.itemAfter, {
        actionLabel: action.label,
        relatedChanges: result.auditData.relatedChanges
      });
  }

  await writeDb(db);
  res.json(result.item);
});

function getValue(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function setValue(target, pathName, value) {
  const keys = pathName.split('.');
  let cursor = target;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
}

function findRelated(db, relation, item) {
  return db[relation.collection]?.find((entry) => entry.id === item[relation.localKey]);
}

function runAction(db, action, item) {
  const related = action.relation ? findRelated(db, action.relation, item) : null;
  const context = { item, related };
  const levelRank = { '低': 1, '中': 2, '高': 3 };

  const itemBefore = AUDIT_COLLECTIONS.includes(action.collection) ? deepClone(item) : null;
  const relatedBefore = related && action.relation && AUDIT_COLLECTIONS.includes(action.relation.collection)
    ? deepClone(related)
    : null;

  for (const guard of action.guards || []) {
    const left = getValue(context, guard.left);
    const right = guard.rightPath ? getValue(context, guard.rightPath) : guard.right;
    if (guard.op === 'missing' && left) continue;
    if (guard.op === 'missing' && !left) return { error: guard.message };
    if (guard.op === 'eq' && left !== right) return { error: guard.message };
    if (guard.op === 'neq' && left === right) return { error: guard.message };
    if (guard.op === 'gte' && Number(left) < Number(right)) return { error: guard.message };
    if (guard.op === 'levelGte' && (levelRank[left] || 0) < (levelRank[right] || 0)) return { error: guard.message };
    if (guard.op === 'notIn' && guard.values.includes(left)) return { error: guard.message };
  }
  for (const patch of action.patches || []) {
    const target = patch.target === 'related' ? related : item;
    if (!target) continue;
    const next = patch.valuePath ? getValue(context, patch.valuePath) : patch.value;
    setValue(target, patch.field, next);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(stamp(action.label, action.note || '状态流转'));
  }
  for (const delta of action.deltas || []) {
    const target = delta.target === 'related' ? related : item;
    if (!target) continue;
    const sourceAmount = delta.amountPath ? Number(getValue(context, delta.amountPath)) : 1;
    const multiplier = delta.amount === undefined ? 1 : Number(delta.amount);
    const amount = sourceAmount * multiplier;
    const current = Number(getValue({ target }, `target.${delta.field}`) || 0);
    setValue(target, delta.field, current + amount);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(stamp(action.label, action.note || '数量调整'));
  }

  const auditData = {};
  if (itemBefore) {
    auditData.itemBefore = itemBefore;
    auditData.itemAfter = deepClone(item);
  }
  if (relatedBefore && action.relation) {
    const relatedAfter = deepClone(related);
    if (JSON.stringify(relatedBefore) !== JSON.stringify(relatedAfter)) {
      auditData.relatedChanges = [{
        collection: action.relation.collection,
        targetId: related.id,
        before: relatedBefore,
        after: relatedAfter
      }];
    }
  }

  return { item, auditData: Object.keys(auditData).length > 0 ? auditData : null };
}

app.post('/api/pre-checklists/generate', async (req, res) => {
  const db = await readDb();
  const { performanceDate } = req.body;
  if (!performanceDate) return res.status(400).json({ error: '请提供演出日期' });

  const schedules = (db.schedules || []).filter((s) => s.performanceDate === performanceDate);
  if (!schedules.length) return res.status(404).json({ error: '该日期暂无演出排期' });

  const existingChecklists = (db.preChecklists || []).filter((c) => c.performanceDate === performanceDate);
  const existingWigIds = new Set(existingChecklists.map((c) => c.wigId));

  const checkItems = (config.checkItems || []).map((name) => ({
    name,
    result: '',
    note: ''
  }));

  const now = new Date().toISOString();
  let createdCount = 0;

  for (const schedule of schedules) {
    if (existingWigIds.has(schedule.wigId)) continue;

    const wig = (db.wigs || []).find((w) => w.id === schedule.wigId);
    const wigBefore = wig ? deepClone(wig) : null;

    const checklist = {
      id: `preChecklist-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      performanceDate: schedule.performanceDate,
      show: schedule.show,
      role: schedule.role,
      wigId: schedule.wigId,
      status: '待检查',
      checkItems: JSON.parse(JSON.stringify(checkItems)),
      findings: '',
      suggestions: '',
      checker: '',
      checkedAt: '',
      createdAt: now,
      updatedAt: now,
      history: [stamp('生成检查清单', `剧目：${schedule.show}，角色：${schedule.role}`)]
    };

    db.preChecklists = db.preChecklists || [];
    db.preChecklists.push(checklist);
    createdCount++;

    const relatedChanges = [];
    if (wig) {
      wig.history = wig.history || [];
      wig.history.unshift(stamp('演出前检查生成', `${schedule.performanceDate} 演出检查任务已生成`));
      wig.updatedAt = now;
      if (wigBefore) {
        relatedChanges.push({
          collection: 'wigs',
          targetId: wig.id,
          before: wigBefore,
          after: deepClone(wig)
        });
      }
    }

    createAuditLog(db, 'create', 'preChecklists', checklist.id, null, checklist, { relatedChanges });
  }

  await writeDb(db);
  res.json({ created: createdCount, total: schedules.length });
});

app.patch('/api/pre-checklists/:id/check', async (req, res) => {
  const db = await readDb();
  const { id } = req.params;
  const { checkItems, findings, suggestions, checker, status, reset } = req.body;

  const checklist = (db.preChecklists || []).find((c) => c.id === id);
  if (!checklist) return res.status(404).json({ error: '检查任务不存在' });

  const now = new Date().toISOString();
  const prevStatus = checklist.status;

  const checklistBefore = deepClone(checklist);
  const wig = (db.wigs || []).find((w) => w.id === checklist.wigId);
  const wigBefore = wig ? deepClone(wig) : null;

  if (reset) {
    checklist.checkItems = (config.checkItems || []).map((name) => ({
      name,
      result: '',
      note: ''
    }));
    checklist.findings = '';
    checklist.suggestions = '';
    checklist.checker = '';
    checklist.checkedAt = '';
    checklist.status = '待检查';
    checklist.updatedAt = now;
    checklist.history = checklist.history || [];
    checklist.history.unshift(stamp('重新检查', '清空旧结果，重置为待检查状态'));

    const wig = (db.wigs || []).find((w) => w.id === checklist.wigId);
    if (wig) {
      wig.updatedAt = now;
      wig.history = wig.history || [];
      wig.history.unshift(stamp('重新检查', '演出前检查已重置'));
    }
  } else {
    if (checkItems) checklist.checkItems = checkItems;
    if (findings !== undefined) checklist.findings = findings;
    if (suggestions !== undefined) checklist.suggestions = suggestions;
    if (checker) checklist.checker = checker;

    if (status && status !== prevStatus) {
      checklist.status = status;
    }

    if (status === '检查通过' || status === '检查不通过') {
      checklist.checkedAt = now;
    }

    checklist.updatedAt = now;
    checklist.history = checklist.history || [];

    const wig = (db.wigs || []).find((w) => w.id === checklist.wigId);

    if (status === '检查通过' && prevStatus !== '检查通过') {
      checklist.history.unshift(stamp('检查通过', findings || '检查合格，可上场演出'));
      if (wig) {
        wig.status = '可演出';
        wig.updatedAt = now;
        wig.history = wig.history || [];
        wig.history.unshift(stamp('演出前检查通过', '标记为可演出'));
      }
    } else if (status === '检查不通过' && prevStatus !== '检查不通过') {
      checklist.history.unshift(stamp('检查不通过', findings || '发现问题需维修'));
      if (wig) {
        wig.status = '需要维修';
        wig.updatedAt = now;
        wig.history = wig.history || [];
        wig.history.unshift(stamp('演出前检查不通过', `发现问题：${findings || '需维修'}`));
      }
    } else if (status === '待检查' && prevStatus === '待检查') {
      checklist.history.unshift(stamp('保存草稿', findings || '已保存检查草稿'));
    }
  }

  const relatedChanges = [];
  if (wig && wigBefore) {
    if (JSON.stringify(wigBefore) !== JSON.stringify(wig)) {
      relatedChanges.push({
        collection: 'wigs',
        targetId: wig.id,
        before: wigBefore,
        after: deepClone(wig)
      });
    }
  }

  createAuditLog(db, 'update', 'preChecklists', checklist.id, checklistBefore, deepClone(checklist), { relatedChanges });

  await writeDb(db);
  res.json(checklist);
});

app.get('/api/staff-stats', async (req, res) => {
  const db = await readDb();
  const repairs = db.repairs || [];
  const staff = db.staff || [];
  const stats = {};
  const activeStatuses = ['待处理', '维修中', '待检查'];
  const allRepairTypes = new Set();
  for (const r of repairs) {
    if (r.type) allRepairTypes.add(r.type);
  }
  for (const person of staff) {
    stats[person.id] = {
      id: person.id,
      name: person.name,
      specialty: person.specialty,
      contact: person.contact,
      pending: 0,
      repairing: 0,
      checking: 0,
      completed: 0,
      total: 0,
      activeCount: 0,
      workload: '空闲',
      workloadLevel: 0,
      repairTypes: []
    };
  }
  for (const r of repairs) {
    const handlerId = r.handler;
    if (!handlerId) continue;
    if (!stats[handlerId]) {
      stats[handlerId] = {
        id: handlerId,
        name: handlerId,
        specialty: '',
        contact: '',
        pending: 0,
        repairing: 0,
        checking: 0,
        completed: 0,
        total: 0,
        activeCount: 0,
        workload: '空闲',
        workloadLevel: 0,
        repairTypes: []
      };
    }
    if (r.status === '待处理') stats[handlerId].pending++;
    else if (r.status === '维修中') stats[handlerId].repairing++;
    else if (r.status === '待检查') stats[handlerId].checking++;
    else if (r.status === '已完成') stats[handlerId].completed++;
    stats[handlerId].total++;
    if (activeStatuses.includes(r.status)) {
      stats[handlerId].activeCount++;
    }
    if (r.type && !stats[handlerId].repairTypes.includes(r.type)) {
      stats[handlerId].repairTypes.push(r.type);
    }
  }
  for (const id of Object.keys(stats)) {
    const s = stats[id];
    if (s.activeCount === 0) {
      s.workload = '空闲';
      s.workloadLevel = 0;
    } else if (s.activeCount <= 2) {
      s.workload = '轻松';
      s.workloadLevel = 1;
    } else if (s.activeCount <= 4) {
      s.workload = '适中';
      s.workloadLevel = 2;
    } else if (s.activeCount <= 6) {
      s.workload = '繁忙';
      s.workloadLevel = 3;
    } else {
      s.workload = '过载';
      s.workloadLevel = 4;
    }
  }
  res.json(stats);
});

app.post('/api/wigs/batch-import', async (req, res) => {
  const db = await readDb();
  const rows = req.body?.rows || [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: '请提供有效的导入数据' });
  }

  const requiredFields = ['role', 'show', 'color', 'location', 'performanceDate'];
  const now = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;
  const failures = [];
  const createdItems = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const missingFields = requiredFields.filter((f) => !row[f] || String(row[f]).trim() === '');

    if (missingFields.length > 0) {
      failCount++;
      failures.push({
        row: i + 1,
        data: row,
        missingFields
      });
      continue;
    }

    const item = {
      id: `wigs-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      role: String(row.role).trim(),
      show: String(row.show).trim(),
      color: String(row.color).trim(),
      capSize: row.capSize ? String(row.capSize).trim() : 'M',
      hairline: row.hairline ? String(row.hairline).trim() : '普通前网',
      location: String(row.location).trim(),
      performanceDate: String(row.performanceDate).trim(),
      status: row.status ? String(row.status).trim() : '可演出',
      note: row.note ? String(row.note).trim() : '',
      createdAt: now,
      updatedAt: now,
      history: [stamp('批量导入创建', row.note ? String(row.note).trim() : 'CSV 批量导入')]
    };

    db.wigs.push(item);
    createdItems.push(item);
    successCount++;

    createAuditLog(db, 'create', 'wigs', item.id, null, item);
  }

  if (successCount > 0) {
    await writeDb(db);
  }

  res.json({
    success: successCount,
    fail: failCount,
    total: rows.length,
    failures,
    createdItems
  });
});

app.get('/api/availability-warnings', async (req, res) => {
  const db = await readDb();
  const schedules = db.schedules || [];
  const wigs = db.wigs || [];
  const repairs = db.repairs || [];
  const lendings = db.lendings || [];
  const preChecklists = db.preChecklists || [];
  const staff = db.staff || [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const warnings = [];
  const warningId = (prefix, scheduleId, wigId) =>
    `${prefix}-${scheduleId || 'none'}-${wigId || 'none'}`;

  const wigScheduleMap = new Map();
  for (const s of schedules) {
    if (!wigScheduleMap.has(s.wigId)) wigScheduleMap.set(s.wigId, []);
    wigScheduleMap.get(s.wigId).push(s);
  }

  for (const schedule of schedules) {
    const perfDate = new Date(schedule.performanceDate);
    perfDate.setHours(0, 0, 0, 0);
    const daysUntil = Math.ceil((perfDate - today) / (1000 * 60 * 60 * 24));

    const wig = wigs.find((w) => w.id === schedule.wigId);
    const wigLabel = wig ? `${wig.role} / ${wig.show}` : '未关联假发';

    const baseWarning = {
      scheduleId: schedule.id,
      wigId: schedule.wigId,
      wigLabel,
      performanceDate: schedule.performanceDate,
      show: schedule.show,
      role: schedule.role,
      daysUntilPerformance: daysUntil,
      scheduleStatus: schedule.status || '已排期'
    };

    if (wig && (wig.status === '需要维修' || wig.status === '紧急维修')) {
      const activeRepairs = repairs.filter(
        (r) => r.wigId === wig.id && ['待处理', '维修中', '待检查'].includes(r.status)
      );
      warnings.push({
        ...baseWarning,
        id: warningId('unavailable', schedule.id, wig.id),
        riskType: 'wigUnavailable',
        riskLevel: 'high',
        title: '假发不可用',
        description: `假发状态为「${wig.status}」，${activeRepairs.length > 0 ? `存在 ${activeRepairs.length} 个未完成维修单` : '请尽快创建维修单'}`,
        relatedItems: { wig, repairs: activeRepairs },
        actions: [
          { id: 'create-repair', label: '创建紧急维修单', type: 'action' },
          { id: 'go-repairs', label: '查看维修单', type: 'link', target: 'repairs' }
        ]
      });
    }

    const relatedRepairs = repairs.filter(
      (r) => r.wigId === schedule.wigId && ['待处理', '维修中', '待检查'].includes(r.status)
    );
    for (const repair of relatedRepairs) {
      if (repair.dueDate) {
        const due = new Date(repair.dueDate);
        due.setHours(0, 0, 0, 0);
        if (due > perfDate) {
          const lateDays = Math.ceil((due - perfDate) / (1000 * 60 * 60 * 24));
          warnings.push({
            ...baseWarning,
            id: warningId('repairLate', schedule.id, repair.id),
            riskType: 'repairLate',
            riskLevel: 'high',
            title: '维修截止晚于演出',
            description: `维修单「${repair.type}」截止日 ${repair.dueDate} 晚于演出日 ${lateDays} 天，处理人：${staff.find((s) => s.id === repair.handler)?.name || repair.handler || '未指派'}`,
            relatedItems: { repair },
            actions: [
              { id: 'reassign-repair', label: '重新指派', type: 'action', repairId: repair.id },
              { id: 'go-dispatch', label: '查看派工板', type: 'link', target: 'dispatchBoard' }
            ]
          });
        }
      }
    }

    const activeLending = lendings.find(
      (l) => l.wigId === schedule.wigId && ['借出中', '归还待检查'].includes(l.status)
    );
    if (activeLending) {
      let overdue = false;
      let overdueDesc = '';
      if (activeLending.expectedReturnDate) {
        const expectedReturn = new Date(activeLending.expectedReturnDate);
        expectedReturn.setHours(0, 0, 0, 0);
        if (expectedReturn > perfDate) {
          overdue = true;
          overdueDesc = `预计归还日 ${activeLending.expectedReturnDate} 晚于演出日`;
        } else if (activeLending.status === '借出中') {
          overdueDesc = `借出给 ${activeLending.actor}，状态「${activeLending.status}」，预计归还 ${activeLending.expectedReturnDate}`;
        }
      } else {
        overdueDesc = `借出给 ${activeLending.actor}，状态「${activeLending.status}」，无预计归还日期`;
      }

      warnings.push({
        ...baseWarning,
        id: warningId('lending', schedule.id, activeLending.id),
        riskType: 'lendingOverdue',
        riskLevel: overdue ? 'high' : 'medium',
        title: activeLending.status === '归还待检查' ? '归还待检查' : '借出未归还',
        description: overdueDesc,
        relatedItems: { lending: activeLending },
        actions: [
          activeLending.status === '借出中'
            ? { id: 'mark-return', label: '标记归还待检查', type: 'action', lendingId: activeLending.id }
            : { id: 'go-lending', label: '去检查归还', type: 'link', target: 'lendings' }
        ]
      });
    }

    const wigSchedules = wigScheduleMap.get(schedule.wigId) || [];
    const sameDateSchedules = wigSchedules.filter(
      (s) => s.id !== schedule.id && s.performanceDate === schedule.performanceDate
    );
    if (sameDateSchedules.length > 0) {
      warnings.push({
        ...baseWarning,
        id: warningId('conflict', schedule.id, schedule.wigId),
        riskType: 'scheduleConflict',
        riskLevel: 'medium',
        title: '同一场次占用冲突',
        description: `同一假发在 ${schedule.performanceDate} 被 ${sameDateSchedules.length + 1} 个场次使用：${sameDateSchedules.map((s) => s.role).join('、')}、${schedule.role}`,
        relatedItems: { conflictingSchedules: sameDateSchedules },
        actions: [
          { id: 'go-schedules', label: '调整排期', type: 'link', target: 'schedules' }
        ]
      });
    }

    const lastFailedReturnLending = lendings
      .filter((l) => l.wigId === schedule.wigId && l.status === '归还检查不通过')
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    if (lastFailedReturnLending) {
      const hasFollowUpRepair = repairs.some(
        (r) => r.wigId === schedule.wigId && ['待处理', '维修中', '待检查'].includes(r.status)
      );
      warnings.push({
        ...baseWarning,
        id: warningId('returnFail', schedule.id, lastFailedReturnLending.id),
        riskType: 'returnCheckFail',
        riskLevel: hasFollowUpRepair ? 'medium' : 'high',
        title: '归还检查不通过',
        description: `最近一次归还检查不通过，发现问题：${lastFailedReturnLending.checkFindings || '未记录'}${hasFollowUpRepair ? '，已创建维修单' : '，尚未创建维修单'}`,
        relatedItems: { lending: lastFailedReturnLending },
        actions: hasFollowUpRepair
          ? [{ id: 'go-repairs', label: '查看维修进度', type: 'link', target: 'repairs' }]
          : [{ id: 'create-repair', label: '创建维修单', type: 'action' }]
      });
    }

    const relatedPreCheck = preChecklists
      .filter(
        (c) => c.wigId === schedule.wigId && c.performanceDate === schedule.performanceDate
      )
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];

    if (relatedPreCheck) {
      if (relatedPreCheck.status === '待检查' && daysUntil <= 7) {
        warnings.push({
          ...baseWarning,
          id: warningId('preCheckPending', schedule.id, relatedPreCheck.id),
          riskType: 'preCheckPending',
          riskLevel: daysUntil <= 2 ? 'high' : 'medium',
          title: '演出前检查未完成',
          description: `距离演出还有 ${daysUntil} 天，检查任务状态为「待检查」`,
          relatedItems: { preChecklist: relatedPreCheck },
          actions: [
            { id: 'mark-precheck', label: '标记待检查', type: 'action', preChecklistId: relatedPreCheck.id },
            { id: 'go-precheck', label: '去执行检查', type: 'link', target: 'preChecklists' }
          ]
        });
      } else if (relatedPreCheck.status === '检查不通过') {
        const hasRepair = repairs.some(
          (r) => r.wigId === schedule.wigId && ['待处理', '维修中', '待检查'].includes(r.status)
        );
        warnings.push({
          ...baseWarning,
          id: warningId('preCheckFail', schedule.id, relatedPreCheck.id),
          riskType: 'preCheckPending',
          riskLevel: 'high',
          title: '演出前检查不通过',
          description: `检查发现：${relatedPreCheck.findings || '未记录'}${hasRepair ? '，已创建维修单跟进' : '，尚未跟进'}`,
          relatedItems: { preChecklist: relatedPreCheck },
          actions: hasRepair
            ? [{ id: 'go-repairs', label: '查看维修进度', type: 'link', target: 'repairs' }]
            : [{ id: 'create-repair', label: '创建维修单', type: 'action' }]
        });
      }
    } else if (daysUntil <= 7) {
      warnings.push({
        ...baseWarning,
        id: warningId('noPreCheck', schedule.id, schedule.wigId),
        riskType: 'preCheckPending',
        riskLevel: daysUntil <= 2 ? 'high' : 'medium',
        title: '未生成演出前检查',
        description: `距离演出还有 ${daysUntil} 天，尚未生成演出前检查任务`,
        relatedItems: {},
        actions: [
          { id: 'generate-precheck', label: '生成检查任务', type: 'action' },
          { id: 'go-precheck', label: '去检查模块', type: 'link', target: 'preChecklists' }
        ]
      });
    }
  }

  warnings.sort((a, b) => {
    const dateDiff = new Date(a.performanceDate) - new Date(b.performanceDate);
    if (dateDiff !== 0) return dateDiff;
    const levelRank = { high: 0, medium: 1, low: 2 };
    const rankDiff = levelRank[a.riskLevel] - levelRank[b.riskLevel];
    if (rankDiff !== 0) return rankDiff;
    return a.riskType.localeCompare(b.riskType);
  });

  const stats = {
    total: warnings.length,
    high: warnings.filter((w) => w.riskLevel === 'high').length,
    medium: warnings.filter((w) => w.riskLevel === 'medium').length,
    byType: {
      wigUnavailable: warnings.filter((w) => w.riskType === 'wigUnavailable').length,
      repairLate: warnings.filter((w) => w.riskType === 'repairLate').length,
      lendingOverdue: warnings.filter((w) => w.riskType === 'lendingOverdue').length,
      scheduleConflict: warnings.filter((w) => w.riskType === 'scheduleConflict').length,
      returnCheckFail: warnings.filter((w) => w.riskType === 'returnCheckFail').length,
      preCheckPending: warnings.filter((w) => w.riskType === 'preCheckPending').length
    },
    upcomingPerformances: schedules.filter((s) => {
      const d = new Date(s.performanceDate);
      d.setHours(0, 0, 0, 0);
      const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
      return diff >= 0 && diff <= 14;
    }).length
  };

  res.json({ warnings, stats });
});

app.post('/api/availability-warnings/action', async (req, res) => {
  const db = await readDb();
  const { actionType, wigId, lendingId, preChecklistId, performanceDate, show, role } = req.body || {};
  const now = new Date().toISOString();

  try {
    if (actionType === 'create-repair' && wigId) {
      const wig = db.wigs?.find((w) => w.id === wigId);
      if (!wig) return res.status(404).json({ error: '假发不存在' });

      const wigBefore = deepClone(wig);

      const item = {
        id: `repairs-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        wigId,
        type: '勾织',
        handler: '',
        status: '待处理',
        dueDate: performanceDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        details: `演出可用性预警自动创建：${show ? `剧目「${show}」` : ''}${role ? `角色「${role}」` : ''}${wig.note ? `，备注：${wig.note}` : ''}`,
        result: '',
        createdAt: now,
        updatedAt: now,
        history: [stamp('创建', '演出可用性预警自动创建紧急维修单')]
      };

      db.repairs = db.repairs || [];
      db.repairs.push(item);

      const lendingBlocked = ['借出中', '归还待检查'].includes(wig.status);
      if (!lendingBlocked && wig.status !== '需要维修' && wig.status !== '紧急维修') {
        wig.status = '需要维修';
        wig.updatedAt = now;
        wig.history = wig.history || [];
        wig.history.unshift(stamp('需要维修', '预警自动标记为需要维修'));
      }

      const relatedChanges = [];
      if (JSON.stringify(wigBefore) !== JSON.stringify(wig)) {
        relatedChanges.push({
          collection: 'wigs',
          targetId: wig.id,
          before: wigBefore,
          after: deepClone(wig)
        });
      }

      createAuditLog(db, 'create', 'repairs', item.id, null, item, {
        actionLabel: '预警创建维修单',
        relatedChanges
      });

      const message = lendingBlocked
        ? '已创建维修单（假发处于借出/归还检查流程，状态将在归还后更新）'
        : '已创建维修单';

      await writeDb(db);
      return res.json({ success: true, item, message });
    }

    if (actionType === 'mark-return' && lendingId) {
      const lending = db.lendings?.find((l) => l.id === lendingId);
      if (!lending) return res.status(404).json({ error: '借出记录不存在' });
      if (lending.status !== '借出中') return res.status(409).json({ error: '只有借出中状态可以标记归还' });

      const lendingBefore = deepClone(lending);
      const wig = db.wigs?.find((w) => w.id === lending.wigId);
      const wigBefore = wig ? deepClone(wig) : null;

      lending.status = '归还待检查';
      lending.actualReturnDate = new Date().toISOString().split('T')[0];
      lending.updatedAt = now;
      lending.history = lending.history || [];
      lending.history.unshift(stamp('提交归还', '预警中心快捷标记归还待检查'));

      if (wig) {
        wig.status = '归还待检查';
        wig.updatedAt = now;
        wig.history = wig.history || [];
        wig.history.unshift(stamp('归还待检查', '预警中心快捷标记'));
      }

      const relatedChanges = [];
      if (wig && wigBefore && JSON.stringify(wigBefore) !== JSON.stringify(wig)) {
        relatedChanges.push({
          collection: 'wigs',
          targetId: wig.id,
          before: wigBefore,
          after: deepClone(wig)
        });
      }

      createAuditLog(db, 'update', 'lendings', lending.id, lendingBefore, deepClone(lending), {
        actionLabel: '预警标记归还',
        relatedChanges
      });

      await writeDb(db);
      return res.json({ success: true, message: '已标记为归还待检查' });
    }

    if (actionType === 'mark-precheck' && preChecklistId) {
      const checklist = db.preChecklists?.find((c) => c.id === preChecklistId);
      if (!checklist) return res.status(404).json({ error: '检查任务不存在' });

      const checklistBefore = deepClone(checklist);

      checklist.status = '待检查';
      checklist.updatedAt = now;
      checklist.history = checklist.history || [];
      checklist.history.unshift(stamp('重置待检查', '预警中心快捷操作'));

      createAuditLog(db, 'update', 'preChecklists', checklist.id, checklistBefore, deepClone(checklist), {
        actionLabel: '预警标记待检查'
      });

      await writeDb(db);
      return res.json({ success: true, message: '已标记为待检查' });
    }

    if (actionType === 'generate-precheck' && wigId && performanceDate) {
      const existing = (db.preChecklists || []).find(
        (c) => c.wigId === wigId && c.performanceDate === performanceDate
      );
      if (existing) return res.status(409).json({ error: '该演出日检查任务已存在' });

      const checkItems = (config.checkItems || []).map((name) => ({
        name,
        result: '',
        note: ''
      }));

      const wig = db.wigs?.find((w) => w.id === wigId);
      const wigBefore = wig ? deepClone(wig) : null;

      const item = {
        id: `preChecklist-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        performanceDate,
        show: show || '',
        role: role || '',
        wigId,
        status: '待检查',
        checkItems: JSON.parse(JSON.stringify(checkItems)),
        findings: '',
        suggestions: '',
        checker: '',
        checkedAt: '',
        createdAt: now,
        updatedAt: now,
        history: [stamp('生成检查清单', '演出可用性预警自动生成')]
      };

      db.preChecklists = db.preChecklists || [];
      db.preChecklists.push(item);

      if (wig) {
        wig.history = wig.history || [];
        wig.history.unshift(stamp('演出前检查生成', '预警自动生成'));
        wig.updatedAt = now;
      }

      const relatedChanges = [];
      if (wig && wigBefore && JSON.stringify(wigBefore) !== JSON.stringify(wig)) {
        relatedChanges.push({
          collection: 'wigs',
          targetId: wig.id,
          before: wigBefore,
          after: deepClone(wig)
        });
      }

      createAuditLog(db, 'create', 'preChecklists', item.id, null, item, {
        actionLabel: '预警生成检查任务',
        relatedChanges
      });

      await writeDb(db);
      return res.json({ success: true, item, message: '已生成检查任务' });
    }

    res.status(400).json({ error: '无效的操作类型' });
  } catch (error) {
    res.status(500).json({ error: error.message || '操作失败' });
  }
});

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
