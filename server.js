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

  if (wig) {
    wig.status = '借出中';
    wig.updatedAt = now;
    wig.history = wig.history || [];
    wig.history.unshift(stamp('借出', `借给 ${body.actor || '演员'}，用于 ${body.show || '演出'}`));
  }

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

  const wig = (db.wigs || []).find((w) => w.id === lending.wigId);

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
          wig.status = '可演出';
          wig.updatedAt = now;
          wig.history = wig.history || [];
          wig.history.unshift(stamp('归还检查通过', '归还检查通过，恢复为可演出状态'));
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

  if (wig) {
    wig.history = wig.history || [];
    wig.history.unshift(stamp('维修复盘', `维修类型：${repair.type}，复盘人：${body.reviewer || '未填写'}`));
    wig.updatedAt = now;
  }

  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/repair-reviews/:id', async (req, res) => {
  const db = await readDb();
  const { id } = req.params;
  const body = req.body || {};

  const review = db.repairReviews?.find((r) => r.id === id);
  if (!review) return res.status(404).json({ error: '复盘记录不存在' });

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

  const historyAction = req.body.historyAction;
  delete req.body.historyAction;
  Object.assign(item, req.body, { updatedAt: new Date().toISOString() });
  item.history = item.history || [];
  if (historyAction || req.body.note || req.body.memo || req.body.status) {
    item.history.unshift(stamp(historyAction || req.body.status || '更新', req.body.note || req.body.memo || ''));
  }
  await writeDb(db);
  res.json(item);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });

  if (collection === 'lendings') {
    const lending = db.lendings.find((l) => l.id === id);
    if (lending && (lending.status === '借出中' || lending.status === '归还待检查')) {
      const wig = db.wigs?.find((w) => w.id === lending.wigId);
      if (wig) {
        wig.status = '可演出';
        wig.updatedAt = new Date().toISOString();
        wig.history = wig.history || [];
        wig.history.unshift(stamp('借出记录删除', '删除借出记录，恢复为可演出状态'));
      }
    }
  }

  const before = db[collection].length;
  db[collection] = db[collection].filter((entry) => entry.id !== id);
  if (db[collection].length === before) return res.status(404).json({ error: 'not found' });
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
  return { item };
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

    if (wig) {
      wig.history = wig.history || [];
      wig.history.unshift(stamp('演出前检查生成', `${schedule.performanceDate} 演出检查任务已生成`));
      wig.updatedAt = now;
    }
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

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
