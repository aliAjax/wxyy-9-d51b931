const state = {
  config: null,
  db: {},
  staffStats: {},
  dispatchBoard: {},
  activeTab: ''
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '请求失败');
  }
  if (res.status === 204) return null;
  return res.json();
}

function valueByPath(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function displayField(item, field) {
  const value = item[field.name] ?? '';
  if (field.type === 'select' && field.options) return value || field.options[0];
  return value;
}

function collectionLabel(collection) {
  return state.config.collections[collection]?.label || collection;
}

function relationLabel(relation, id) {
  const item = state.db[relation.collection]?.find((entry) => entry.id === id);
  if (!item) return '未关联';
  return relation.labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
}

function optionList(items, labelFields) {
  return items.map((item) => {
    const label = labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
    return `<option value="${item.id}">${escapeHtml(label)}</option>`;
  }).join('');
}

function staffOptionList(currentHandler = '') {
  const staff = state.db.staff || [];
  const options = staff
    .filter((person) => person.id !== currentHandler)
    .map((person) => {
      const label = [person.name, person.specialty].filter(Boolean).join(' / ');
      return `<option value="${person.id}">${escapeHtml(label)}</option>`;
    })
    .join('');
  return `<option value="">选择新的处理人</option>${options}`;
}

function formField(field) {
  const required = field.required ? 'required' : '';
  const value = field.default ? `value="${escapeHtml(field.default)}"` : '';
  if (field.type === 'textarea') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<textarea name="${field.name}" ${required}></textarea></label>`;
  }
  if (field.type === 'select') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${field.options.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'relation') {
    const items = state.db[field.collection] || [];
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${optionList(items, field.labelFields)}</select></label>`;
  }
  return `<label class="${field.wide ? 'wide' : ''}">${field.label}<input type="${field.type || 'text'}" name="${field.name}" ${value} ${required}></label>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(value || '-')}</span>`;
}

function toneFor(value) {
  return state.config.tones?.[value] || '';
}

function historyHtml(item) {
  const history = item.history || [];
  if (!history.length) return '';
  return `<div class="history">${history.slice(0, 5).map((entry) => `
    <div class="history-item"><span>${fmtDate(entry.at)}</span><span>${escapeHtml(entry.action)}${entry.note ? '：' + escapeHtml(entry.note) : ''}</span></div>
  `).join('')}</div>`;
}

function values(form, view) {
  const payload = Object.fromEntries(new FormData(form).entries());
  for (const field of view.fields) {
    if (field.type === 'number') payload[field.name] = Number(payload[field.name] || 0);
  }
  return { ...view.defaults, ...payload };
}

function renderTabs() {
  $('#tabs').innerHTML = state.config.views.map((view, index) => `
    <button class="tab${index === 0 ? ' active' : ''}" data-tab="${view.id}">${escapeHtml(view.label)}</button>
  `).join('');
  state.activeTab = state.config.views[0].id;
}

function setTab(tabId) {
  state.activeTab = tabId;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === tabId));
}

function renderStats() {
  return `<div class="stats">${state.config.stats.map((stat) => {
    const items = state.db[stat.collection] || [];
    let value;
    if (stat.dynamic === 'lowStock') {
      value = items.filter((item) => isLowStock(item)).length;
    } else if (stat.filter) {
      value = items.filter((item) => item[stat.filter.field] === stat.filter.value).length;
    } else {
      value = items.length;
    }
    return `<div class="stat"><span>${escapeHtml(stat.label)}</span><strong>${value}</strong></div>`;
  }).join('')}</div>`;
}

function getWigStatus(wigId) {
  const wig = state.db.wigs?.find((entry) => entry.id === wigId);
  if (!wig) return { status: '未关联', tone: '' };
  return { status: wig.status, tone: toneFor(wig.status) };
}

function getStockStatus(item) {
  const stock = Number(item.stock || 0);
  const safeStock = Number(item.safeStock || 0);
  if (stock <= 0) return { status: '库存告警', tone: 'bad', level: 0 };
  if (stock < safeStock * 0.5) return { status: '库存告警', tone: 'bad', level: 1 };
  if (stock < safeStock) return { status: '库存不足', tone: 'warn', level: 2 };
  return { status: '库存充足', tone: 'ok', level: 3 };
}

function isLowStock(item) {
  return getStockStatus(item).level < 2;
}

function isBelowSafeStock(item) {
  return getStockStatus(item).level < 3;
}

function workloadTone(level) {
  const tones = ['ok', 'ok', 'warn', 'warn', 'bad'];
  return tones[Math.min(Math.max(level, 0), tones.length - 1)] || 'ok';
}

function renderCard(item, collection, view) {
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  let statusValue = item[view.statusField];
  let statusTone = '';
  const staffStat = state.staffStats[item.id];
  if (view.id === 'staff' && staffStat) {
    statusValue = staffStat.workload;
    statusTone = workloadTone(staffStat.workloadLevel);
  } else {
    statusTone = toneFor(statusValue);
  }
  const stockInfo = view.stockField ? getStockStatus(item) : null;
  let cardClass = 'card';
  if (stockInfo && stockInfo.level === 0) cardClass = 'card stock-empty';
  else if (stockInfo && stockInfo.level === 1) cardClass = 'card low-stock';
  else if (stockInfo && stockInfo.level === 2) cardClass = 'card below-safe';
  if (view.cardClass) cardClass += ' ' + view.cardClass;
  if (view.id === 'staff' && staffStat) {
    cardClass += ` workload-${staffStat.workloadLevel}`;
  }
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    let value;
    let tone = '';
    if (field.type === 'dynamic' && field.name === 'wigStatus') {
      const wigInfo = getWigStatus(item.wigId);
      value = wigInfo.status;
      tone = wigInfo.tone;
    } else if (field.type === 'dynamic' && field.name === 'stockStatus') {
      const info = getStockStatus(item);
      value = info.status;
      tone = info.tone;
    } else if (field.type === 'staffStat') {
      const personStats = state.staffStats[item.id] || {};
      value = personStats[field.statKey] || 0;
      tone = value > 0 ? 'warn' : 'ok';
    } else if (field.type === 'staffWorkload') {
      const personStats = state.staffStats[item.id] || {};
      value = personStats.workload || '空闲';
      tone = workloadTone(personStats.workloadLevel || 0);
    } else if (field.type === 'stock') {
      value = item[field.name];
      tone = stockInfo?.tone || '';
    } else if (field.type === 'relation') {
      value = relationLabel(field, item[field.name]);
    } else {
      value = item[field.name];
    }
    if (tone) {
      const displayValue = value === 0 ? '0' : (value || '-');
      return `<div>${escapeHtml(field.label)}<br>${pill(displayValue, tone)}</div>`;
    }
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');
  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');
  const actions = state.config.actions
    .filter((action) => action.collection === collection)
    .map((action) => `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`)
    .join('');
  let wigStatusBadge = '';
  if (view.showWigStatus && item.wigId) {
    const wigInfo = getWigStatus(item.wigId);
    wigStatusBadge = `<div class="wig-status"><span class="wig-status-label">假发状态：</span>${pill(wigInfo.status, wigInfo.tone)}</div>`;
  }
  return `<article class="${cardClass}">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, statusTone) : (stockInfo ? pill(stockInfo.status, stockInfo.tone) : '')}</div>
    ${relation}
    ${wigStatusBadge}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail${view.detailClass ? ' ' + view.detailClass : ''}">${details}</div>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${historyHtml(item)}
  </article>`;
}

function renderList(view) {
  const collection = view.collection;
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db[collection] || [])];
  if (query) {
    items = items.filter((item) => view.searchFields.some((field) => {
      const value = String(item[field] || '');
      if (value.includes(query)) return true;
      const detailField = (view.detailFields || []).find((df) => df.name === field && df.type === 'relation');
      if (detailField) {
        const label = relationLabel(detailField, item[field]);
        return label.includes(query);
      }
      return false;
    }));
  }
  if (status) {
    if (view.id === 'staff') {
      items = items.filter((item) => {
        const stat = state.staffStats[item.id];
        return stat && stat.workload === status;
      });
    } else {
      items = items.filter((item) => item[view.statusField] === status);
    }
  }
  if (view.stockField) {
    items.sort((a, b) => getStockStatus(a).level - getStockStatus(b).level);
  }
  if (view.id === 'staff') {
    items.sort((a, b) => {
      const statA = state.staffStats[a.id];
      const statB = state.staffStats[b.id];
      const levelA = statA ? statA.workloadLevel : -1;
      const levelB = statB ? statB.workloadLevel : -1;
      return levelB - levelA;
    });
  }
  return items.length ? items.map((item) => renderCard(item, collection, view)).join('') : `<div class="empty">暂无${escapeHtml(collectionLabel(collection))}</div>`;
}

function renderDashboardView(view) {
  const source = view.focus;
  let items = [...(state.db[source.collection] || [])];
  if (source.field) items = items.filter((item) => source.values.includes(item[source.field]));
  items = items.slice(0, source.limit || 8);
  const cardView = state.config.views.find((entry) => entry.collection === source.collection) || source;
  return `<section class="view active" id="${view.id}">
    ${renderStats()}
    <div class="panel"><h2>${escapeHtml(view.focusTitle)}</h2><div class="list">${items.length ? items.map((item) => renderCard(item, source.collection, cardView)).join('') : '<div class="empty">暂无重点事项</div>'}</div></div>
  </section>`;
}

function renderCheckItems(checkItems) {
  if (!checkItems || !checkItems.length) return '';
  const passCount = checkItems.filter((item) => item.result === '通过').length;
  const failCount = checkItems.filter((item) => item.result === '不通过').length;
  const total = checkItems.length;
  return `
    <div class="check-items-summary">
      <span class="check-summary-text">检查项：${passCount}/${total} 通过</span>
      ${failCount > 0 ? `<span class="pill bad">${failCount} 项不通过</span>` : ''}
    </div>
    <div class="check-items-list">
      ${checkItems.map((item, idx) => `
        <div class="check-item">
          <span class="check-item-name">${escapeHtml(item.name)}</span>
          <span class="pill ${item.result === '通过' ? 'ok' : item.result === '不通过' ? 'bad' : ''}">${escapeHtml(item.result || '未检查')}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPreChecklistCard(item, view) {
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  let statusValue = item[view.statusField];
  let statusTone = toneFor(statusValue);
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    let value;
    let tone = '';
    if (field.type === 'dynamic' && field.name === 'wigStatus') {
      const wigInfo = getWigStatus(item.wigId);
      value = wigInfo.status;
      tone = wigInfo.tone;
    } else if (field.type === 'relation') {
      value = relationLabel(field, item[field.name]);
    } else {
      value = item[field.name];
    }
    if (tone) {
      const displayValue = value || '-';
      return `<div>${escapeHtml(field.label)}<br>${pill(displayValue, tone)}</div>`;
    }
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');

  const checkItemsHtml = renderCheckItems(item.checkItems);

  const actions = '';

  let wigStatusBadge = '';
  if (view.showWigStatus && item.wigId) {
    const wigInfo = getWigStatus(item.wigId);
    wigStatusBadge = `<div class="wig-status"><span class="wig-status-label">假发状态：</span>${pill(wigInfo.status, wigInfo.tone)}</div>`;
  }

  const findingsHtml = item.findings ? `<div class="findings"><strong>发现问题：</strong>${escapeHtml(item.findings)}</div>` : '';
  const suggestionsHtml = item.suggestions ? `<div class="suggestions"><strong>处理建议：</strong>${escapeHtml(item.suggestions)}</div>` : '';

  return `<article class="card check-card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, statusTone) : ''}</div>
    ${relation}
    ${wigStatusBadge}
    ${checkItemsHtml}
    ${findingsHtml}
    ${suggestionsHtml}
    ${details ? `<div class="detail">${details}</div>` : ''}
    <div class="inline-actions">
      <button class="ghost" data-check-edit="${item.id}">${item.status === '待检查' ? '开始检查' : '查看/编辑'}</button>
    </div>
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${historyHtml(item)}
    <div class="check-form-panel" id="check-form-${item.id}" style="display:none;">
      <h4>检查记录</h4>
      <div class="check-form-items">
        ${(item.checkItems || state.config.checkItems || []).map((ci, idx) => `
          <div class="check-form-item">
            <label class="check-item-label">${escapeHtml(ci.name || ci)}</label>
            <select data-check-idx="${idx}" data-check-field="result">
              <option value="">未检查</option>
              <option value="通过" ${ci.result === '通过' ? 'selected' : ''}>通过</option>
              <option value="不通过" ${ci.result === '不通过' ? 'selected' : ''}>不通过</option>
            </select>
            <input type="text" data-check-idx="${idx}" data-check-field="note" placeholder="备注" value="${escapeHtml(ci.note || '')}">
          </div>
        `).join('')}
      </div>
      <label>发现问题<textarea name="findings" data-check-text="findings">${escapeHtml(item.findings || '')}</textarea></label>
      <label>处理建议<textarea name="suggestions" data-check-text="suggestions">${escapeHtml(item.suggestions || '')}</textarea></label>
      <label>检查人<input type="text" name="checker" data-check-text="checker" value="${escapeHtml(item.checker || '')}"></label>
      <div class="actions">
        <button class="secondary" data-check-cancel="${item.id}">取消</button>
        ${item.status !== '待检查' ? `<button class="ghost" data-check-reset="${item.id}">重置为待检查</button>` : `<button class="ghost" data-check-submit="待检查" data-check-id="${item.id}">保存草稿</button>`}
        <button class="ghost" data-check-submit="检查通过" data-check-id="${item.id}">标记通过</button>
        <button class="danger" data-check-submit="检查不通过" data-check-id="${item.id}">标记不通过</button>
      </div>
    </div>
  </article>`;
}

function renderPreChecklistList(view) {
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db[view.collection] || [])];

  items.sort((a, b) => {
    const dateA = new Date(a.performanceDate || 0);
    const dateB = new Date(b.performanceDate || 0);
    return dateA - dateB;
  });

  if (query) {
    items = items.filter((item) => view.searchFields.some((field) => {
      const value = String(item[field] || '');
      return value.includes(query);
    }));
  }
  if (status) {
    items = items.filter((item) => item[view.statusField] === status);
  }
  return items.length ? items.map((item) => renderPreChecklistCard(item, view)).join('') : `<div class="empty">暂无${escapeHtml(collectionLabel(view.collection))}</div>`;
}

function renderPreChecklistView(view) {
  const statusOptions = view.statusOptions || [];
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <div class="panel">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="generate-section">
          <label>按演出日期生成
            <input type="date" id="generate-date-${view.id}">
          </label>
          <div class="actions">
            <button id="generate-btn-${view.id}">从排期生成检查任务</button>
          </div>
        </div>
        <hr style="margin: 16px 0; border: 0; border-top: 1px solid var(--line);">
        <form class="single-create-form" data-create="${view.collection}" data-view="${view.id}">
          <h3>手动创建检查任务</h3>
          <div class="form-grid">${view.fields.map(formField).join('')}</div>
          <div class="actions"><button>${escapeHtml(view.submitLabel || '保存')}</button></div>
        </form>
      </div>
      <div class="panel">
        <h2>${escapeHtml(view.listTitle)}</h2>
        <div class="toolbar">
          <input id="search-${view.id}" placeholder="${escapeHtml(view.searchPlaceholder || '搜索')}">
          <select id="status-${view.id}">
            <option value="">全部状态</option>
            ${statusOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="list" id="list-${view.id}">${renderPreChecklistList(view)}</div>
      </div>
    </div>
  </section>`;
}

function renderCrudView(view) {
  const statusOptions = view.statusOptions || [];
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <form class="panel" data-create="${view.collection}" data-view="${view.id}">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="form-grid">${view.fields.map(formField).join('')}</div>
        <div class="actions"><button>${escapeHtml(view.submitLabel || '保存')}</button></div>
      </form>
      <div class="panel">
        <h2>${escapeHtml(view.listTitle)}</h2>
        <div class="toolbar">
          <input id="search-${view.id}" placeholder="${escapeHtml(view.searchPlaceholder || '搜索')}">
          <select id="status-${view.id}">
            <option value="">全部状态</option>
            ${statusOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="list" id="list-${view.id}">${renderList(view)}</div>
      </div>
    </div>
  </section>`;
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function daysUntilDue(dueDate) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  return diff;
}

function renderDispatchCard(item, view, handlerId) {
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  const statusValue = item[view.statusField];
  const statusTone = toneFor(statusValue);
  const overdue = isOverdue(item.dueDate);
  const daysDiff = daysUntilDue(item.dueDate);
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';

  let dueLabel = item.dueDate || '无截止日期';
  let dueTone = '';
  if (item.dueDate) {
    if (overdue) {
      dueLabel = `已超期 ${Math.abs(daysDiff)} 天`;
      dueTone = 'bad';
    } else if (daysDiff === 0) {
      dueLabel = '今天截止';
      dueTone = 'warn';
    } else if (daysDiff <= 2) {
      dueLabel = `还剩 ${daysDiff} 天`;
      dueTone = 'warn';
    } else {
      dueLabel = `还剩 ${daysDiff} 天`;
    }
  }

  const details = (view.detailFields || []).map((field) => {
    let value;
    let tone = '';
    if (field.name === 'dueDate') {
      value = dueLabel;
      tone = dueTone;
    } else if (field.type === 'relation') {
      value = relationLabel(field, item[field.name]);
    } else {
      value = item[field.name];
    }
    if (tone) {
      const displayValue = value || '-';
      return `<div>${escapeHtml(field.label)}<br>${pill(displayValue, tone)}</div>`;
    }
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');

  const actions = state.config.actions
    .filter((action) => action.collection === view.collection)
    .map((action) => `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`)
    .join('');

  let wigStatusBadge = '';
  if (view.showWigStatus && item.wigId) {
    const wigInfo = getWigStatus(item.wigId);
    wigStatusBadge = `<div class="wig-status"><span class="wig-status-label">假发状态：</span>${pill(wigInfo.status, wigInfo.tone)}</div>`;
  }

  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');

  let cardClass = 'card dispatch-card';
  if (overdue) cardClass += ' overdue';

  return `<article class="${cardClass}" data-repair-id="${item.id}" data-current-handler="${handlerId || ''}">
    <div class="card-head">
      <h3>${escapeHtml(title)}</h3>
      ${statusValue ? pill(statusValue, statusTone) : ''}
    </div>
    ${relation}
    ${wigStatusBadge}
    ${summary ? `<p class="dispatch-summary">${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    <div class="dispatch-actions">
      <button class="ghost" data-reassign="${item.id}">重新指派</button>
    </div>
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${historyHtml(item)}
  </article>`;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function normalizeFieldName(header) {
  const map = {
    '角色': 'role',
    '剧目': 'show',
    '发色': 'color',
    '发网尺寸': 'capSize',
    '发网': 'capSize',
    '发际线类型': 'hairline',
    '发际线': 'hairline',
    '存放位置': 'location',
    '位置': 'location',
    '演出日期': 'performanceDate',
    '日期': 'performanceDate',
    '可用状态': 'status',
    '状态': 'status',
    '备注': 'note'
  };
  return map[header.trim()] || header.trim();
}

function normalizeRows(rows, headers) {
  return rows.map((row) => {
    const normalized = {};
    headers.forEach((header) => {
      const field = normalizeFieldName(header);
      normalized[field] = row[header] || '';
    });
    return normalized;
  });
}

function validateRows(rows, requiredFields) {
  return rows.map((row, idx) => {
    const missingFields = requiredFields.filter((f) => !row[f] || String(row[f]).trim() === '');
    return {
      rowIndex: idx + 1,
      data: row,
      missingFields,
      isValid: missingFields.length === 0
    };
  });
}

function renderWigImportView(view) {
  const fieldLabels = view.fieldLabels || {};
  const requiredFields = view.requiredFields || [];
  const importState = window.__wigImportState || {
    csvText: '',
    parsedRows: [],
    validatedRows: [],
    importResult: null
  };

  const hasParsedData = importState.validatedRows && importState.validatedRows.length > 0;
  const validCount = importState.validatedRows?.filter((r) => r.isValid).length || 0;
  const invalidCount = importState.validatedRows?.filter((r) => !r.isValid).length || 0;

  let previewTable = '';
  if (hasParsedData) {
    const displayFields = ['role', 'show', 'color', 'capSize', 'hairline', 'location', 'performanceDate', 'status', 'note'];
    previewTable = `
      <div class="import-preview-header">
        <h3>识别结果预览</h3>
        <div class="import-preview-stats">
          <span class="pill">共 ${importState.validatedRows.length} 行</span>
          <span class="pill ok">${validCount} 行有效</span>
          <span class="pill ${invalidCount > 0 ? 'bad' : ''}">${invalidCount} 行缺失</span>
        </div>
      </div>
      <div class="import-table-wrapper">
        <table class="import-preview-table">
          <thead>
            <tr>
              <th class="import-col-num">行号</th>
              ${displayFields.map((f) => `<th class="${requiredFields.includes(f) ? 'required-field' : ''}">${escapeHtml(fieldLabels[f] || f)}${requiredFields.includes(f) ? ' *' : ''}</th>`).join('')}
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            ${importState.validatedRows.map((row) => `
              <tr class="${row.isValid ? 'import-row-valid' : 'import-row-invalid'}">
                <td class="import-col-num">${row.rowIndex}</td>
                ${displayFields.map((f) => {
                  const isMissing = row.missingFields.includes(f);
                  return `<td class="${isMissing ? 'import-cell-missing' : ''}">${escapeHtml(row.data[f] || '-')}</td>`;
                }).join('')}
                <td>
                  ${row.isValid
                    ? '<span class="pill ok">有效</span>'
                    : `<span class="pill bad">缺少：${row.missingFields.map((f) => escapeHtml(fieldLabels[f] || f)).join('、')}</span>`
                  }
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="import-actions">
        <button class="secondary" id="import-clear-btn">清空重新粘贴</button>
        <button class="danger" id="import-confirm-btn" ${validCount === 0 ? 'disabled' : ''}>
          确认导入（${validCount} 条有效数据）
        </button>
      </div>
    `;
  }

  let importResultHtml = '';
  if (importState.importResult) {
    const r = importState.importResult;
    const totalRows = importState.validatedRows?.length || 0;
    importResultHtml = `
      <div class="import-result-panel">
        <div class="import-preview-header">
          <h3>导入结果</h3>
          <div class="import-preview-stats">
            <span class="pill">共 ${r.total} 条</span>
            <span class="pill ok">成功 ${r.success} 条</span>
            <span class="pill ${r.fail > 0 ? 'bad' : ''}">失败 ${r.fail} 条</span>
          </div>
        </div>
        ${r.failures && r.failures.length > 0 ? `
          <div class="import-failures">
            <h4>失败行详情</h4>
            <div class="import-table-wrapper">
              <table class="import-preview-table import-failures-table">
                <thead>
                  <tr>
                    <th class="import-col-num">行号</th>
                    <th>缺少字段</th>
                  </tr>
                </thead>
                <tbody>
                  ${r.failures.map((f) => `
                    <tr class="import-row-invalid">
                      <td class="import-col-num">${f.row}</td>
                      <td>${f.missingFields.map((field) => escapeHtml(fieldLabels[field] || field)).join('、')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  return `<section class="view" id="${view.id}">
    <div class="panel">
      <h2>${escapeHtml(view.formTitle)}</h2>
      <div class="import-hint">
        <p><strong>使用说明：</strong>请在下方文本框粘贴 CSV 格式数据，第一行为表头，支持以下字段（带 <span class="import-required-mark">*</span> 为必填）：</p>
        <div class="import-fields-list">
          ${requiredFields.map((f) => `<span class="import-field-chip required">${escapeHtml(fieldLabels[f] || f)} *</span>`).join('')}
          ${['capSize', 'hairline', 'status', 'note'].map((f) => `<span class="import-field-chip">${escapeHtml(fieldLabels[f] || f)}</span>`).join('')}
        </div>
        <p class="import-hint-example"><strong>示例 CSV：</strong></p>
        <pre class="import-example">角色,剧目,发色,发网尺寸,发际线类型,存放位置,演出日期,可用状态,备注
花仙子,绿野仙踪,金色长卷,M,手勾蕾丝前额,C柜-02,2026-07-15,可演出,新制作
女巫,绿野仙踪,黑色大卷,L,普通前网,C柜-03,2026-07-15,可演出,</pre>
      </div>
      <label class="wide">粘贴 CSV 数据
        <textarea id="csv-input" placeholder="在此粘贴 CSV 文本，第一行为表头...">${escapeHtml(importState.csvText)}</textarea>
      </label>
      <div class="actions">
        <button id="csv-parse-btn">解析预览</button>
      </div>
    </div>
    ${previewTable ? `<div class="panel">${previewTable}</div>` : ''}
    ${importResultHtml ? `<div class="panel">${importResultHtml}</div>` : ''}
  </section>`;
}

function renderDispatchBoardView(view) {
  const board = state.dispatchBoard || {};
  const columns = Object.values(board).filter((col) => col.repairs && col.repairs.length > 0);
  const allStaff = state.db.staff || [];
  const unassigned = board['unassigned'];

  const staffColumns = allStaff.map((person) => {
    const col = board[person.id] || { id: person.id, name: person.name, activeCount: 0, overdueCount: 0, repairs: [] };
    return col;
  });

  if (unassigned) {
    staffColumns.unshift(unassigned);
  }

  return `<section class="view" id="${view.id}">
    <div class="dispatch-board-header">
      <h2>维修派工板</h2>
      <div class="dispatch-board-stats">
        <span class="dispatch-stat">
          <strong>${staffColumns.reduce((sum, c) => sum + (c.repairs?.length || 0), 0)}</strong>
          <span>在办任务</span>
        </span>
        <span class="dispatch-stat">
          <strong>${staffColumns.reduce((sum, c) => sum + (c.overdueCount || 0), 0)}</strong>
          <span>超期任务</span>
        </span>
        <span class="dispatch-stat">
          <strong>${allStaff.length}</strong>
          <span>处理人员</span>
        </span>
      </div>
    </div>
    <div class="dispatch-board">
      ${staffColumns.map((col) => `
        <div class="dispatch-column" data-handler="${col.id}">
          <div class="dispatch-column-header">
            <div class="dispatch-column-title">
              <h3>${escapeHtml(col.name)}</h3>
              ${col.specialty ? `<span class="dispatch-specialty">${escapeHtml(col.specialty)}</span>` : ''}
            </div>
            <div class="dispatch-column-counts">
              <span class="pill">${col.repairs?.length || 0} 项</span>
              ${col.overdueCount > 0 ? `<span class="pill bad">${col.overdueCount} 超期</span>` : ''}
            </div>
          </div>
          <div class="dispatch-column-body" data-column-handler="${col.id}">
            ${col.repairs && col.repairs.length
              ? col.repairs.map((item) => renderDispatchCard(item, view, col.id)).join('')
              : '<div class="dispatch-empty">暂无任务</div>'
            }
          </div>
        </div>
      `).join('')}
    </div>
    <div id="reassign-modal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>重新指派维修单</h3>
          <button class="modal-close" data-modal-close>&times;</button>
        </div>
        <div class="modal-body">
          <div id="reassign-repair-info"></div>
          <label>选择处理人
            <select id="reassign-handler">
              <option value="">选择新的处理人</option>
            </select>
          </label>
          <label>转派备注
            <textarea id="reassign-note" placeholder="可选：说明转派原因"></textarea>
          </label>
        </div>
        <div class="modal-footer">
          <button class="secondary" data-modal-close>取消</button>
          <button id="reassign-confirm">确认指派</button>
        </div>
      </div>
    </div>
  </section>`;
}

function render() {
  $('#title').textContent = state.config.title;
  document.title = state.config.title;
  $('#lede').textContent = state.config.lede;
  $('#main').innerHTML = state.config.views.map((view) => {
    if (view.type === 'dashboard') return renderDashboardView(view);
    if (view.type === 'preChecklist') return renderPreChecklistView(view);
    if (view.type === 'dispatchBoard') return renderDispatchBoardView(view);
    if (view.type === 'wigImport') return renderWigImportView(view);
    return renderCrudView(view);
  }).join('');
  setTab(state.activeTab || state.config.views[0].id);
}

async function load() {
  const [db, staffStats, dispatchBoard] = await Promise.all([
    api('/api/db'),
    api('/api/staff-stats'),
    api('/api/dispatch-board')
  ]);
  state.db = db;
  state.staffStats = staffStats;
  state.dispatchBoard = dispatchBoard;
  render();
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  const action = event.target.closest('[data-action]');
  const checkEdit = event.target.closest('[data-check-edit]');
  const checkCancel = event.target.closest('[data-check-cancel]');
  const checkSubmit = event.target.closest('[data-check-submit]');
  const checkReset = event.target.closest('[data-check-reset]');
  const generateBtn = event.target.closest('[id^="generate-btn-"]');
  const csvParseBtn = event.target.closest('#csv-parse-btn');
  const importClearBtn = event.target.closest('#import-clear-btn');
  const importConfirmBtn = event.target.closest('#import-confirm-btn');

  if (tab) setTab(tab.dataset.tab);
  if (action) {
    try {
      await api(`/api/action/${action.dataset.action}/${action.dataset.id}`, { method: 'POST' });
      await load();
      toast('已更新');
    } catch (error) {
      toast(error.message);
    }
  }
  if (checkEdit) {
    const id = checkEdit.dataset.checkEdit;
    const panel = document.getElementById(`check-form-${id}`);
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }
  if (checkCancel) {
    const id = checkCancel.dataset.checkCancel;
    const panel = document.getElementById(`check-form-${id}`);
    if (panel) panel.style.display = 'none';
  }
  if (checkSubmit) {
    event.preventDefault();
    event.stopPropagation();
    const id = checkSubmit.dataset.checkId;
    const status = checkSubmit.dataset.checkSubmit;
    const card = checkSubmit.closest('.check-card');
    if (!card) return;

    const checkItems = [];
    const itemEls = card.querySelectorAll('[data-check-idx]');
    const itemMap = new Map();
    itemEls.forEach((el) => {
      const idx = el.dataset.checkIdx;
      const field = el.dataset.checkField;
      if (!itemMap.has(idx)) itemMap.set(idx, {});
      itemMap.get(idx)[field] = el.value;
    });
    itemMap.forEach((val, idx) => {
      const labelEl = card.querySelector(`[data-check-idx="${idx}"][data-check-field="result"]`);
      const nameEl = labelEl?.closest('.check-form-item')?.querySelector('.check-item-label');
      checkItems.push({
        name: nameEl?.textContent || `检查项${Number(idx) + 1}`,
        result: val.result || '',
        note: val.note || ''
      });
    });

    const findings = card.querySelector('[data-check-text="findings"]')?.value || '';
    const suggestions = card.querySelector('[data-check-text="suggestions"]')?.value || '';
    const checker = card.querySelector('[data-check-text="checker"]')?.value || '';

    try {
      await api(`/api/pre-checklists/${id}/check`, {
        method: 'PATCH',
        body: JSON.stringify({ checkItems, findings, suggestions, checker, status })
      });
      await load();
      toast(status === '待检查' ? '已保存草稿' : `已${status}`);
    } catch (error) {
      toast(error.message);
    }
  }
  if (checkReset) {
    event.preventDefault();
    event.stopPropagation();
    const id = checkReset.dataset.checkReset;
    try {
      await api(`/api/pre-checklists/${id}/check`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: '待检查',
          reset: true
        })
      });
      await load();
      toast('已重置为待检查');
    } catch (error) {
      toast(error.message);
    }
  }
  if (generateBtn) {
    const viewId = generateBtn.id.replace('generate-btn-', '');
    const dateInput = document.getElementById(`generate-date-${viewId}`);
    const performanceDate = dateInput?.value;
    if (!performanceDate) {
      toast('请选择演出日期');
      return;
    }
    try {
      const result = await api('/api/pre-checklists/generate', {
        method: 'POST',
        body: JSON.stringify({ performanceDate })
      });
      await load();
      toast(`已生成 ${result.created} 个检查任务（共 ${result.total} 条排期）`);
    } catch (error) {
      toast(error.message);
    }
  }

  const reassignBtn = event.target.closest('[data-reassign]');
  if (reassignBtn) {
    event.preventDefault();
    event.stopPropagation();
    const repairId = reassignBtn.dataset.reassign;
    const repair = state.db.repairs?.find((r) => r.id === repairId);
    if (!repair) {
      toast('维修单不存在');
      return;
    }

    const repairInfo = $('#reassign-repair-info');
    if (repairInfo) {
      const wigInfo = repair.wigId
        ? relationLabel({ collection: 'wigs', labelFields: ['role', 'show'] }, repair.wigId)
        : '未关联假发';
      repairInfo.innerHTML = `
        <div class="reassign-info">
          <p><strong>类型：</strong>${escapeHtml(repair.type || '-')}</p>
          <p><strong>关联假发：</strong>${escapeHtml(wigInfo)}</p>
          <p><strong>当前状态：</strong>${escapeHtml(repair.status || '-')}</p>
          <p><strong>截止日期：</strong>${escapeHtml(repair.dueDate || '-')}</p>
        </div>
      `;
    }

    const handlerSelect = $('#reassign-handler');
    if (handlerSelect) {
      handlerSelect.innerHTML = staffOptionList(repair.handler || '');
      handlerSelect.value = '';
    }

    const noteInput = $('#reassign-note');
    if (noteInput) noteInput.value = '';

    const modal = $('#reassign-modal');
    if (modal) {
      modal.dataset.repairId = repairId;
      modal.classList.add('show');
    }
  }

  const modalClose = event.target.closest('[data-modal-close]');
  if (modalClose) {
    const modal = modalClose.closest('.modal');
    if (modal) modal.classList.remove('show');
  }

  const reassignConfirm = event.target.closest('#reassign-confirm');
  if (reassignConfirm) {
    event.preventDefault();
    event.stopPropagation();
    const modal = $('#reassign-modal');
    const repairId = modal?.dataset.repairId;
    const newHandler = $('#reassign-handler')?.value;
    const note = $('#reassign-note')?.value || '';

    if (!repairId || !newHandler) {
      toast('请选择新的处理人');
      return;
    }

    const repair = state.db.repairs?.find((r) => r.id === repairId);
    if (repair && newHandler === repair.handler) {
      toast('请选择其他处理人');
      return;
    }

    try {
      await api(`/api/repairs/${repairId}/reassign`, {
        method: 'PATCH',
        body: JSON.stringify({ newHandler, note })
      });
      if (modal) modal.classList.remove('show');
      await load();
      toast('已重新指派');
    } catch (error) {
      toast(error.message);
    }
  }

  if (csvParseBtn) {
    event.preventDefault();
    event.stopPropagation();
    const csvText = $('#csv-input')?.value || '';
    if (!csvText.trim()) {
      toast('请粘贴 CSV 数据');
      return;
    }
    const { headers, rows } = parseCSV(csvText);
    if (rows.length === 0) {
      toast('未识别到有效数据行');
      return;
    }
    const normalizedRows = normalizeRows(rows, headers);
    const view = state.config.views.find((v) => v.type === 'wigImport');
    const validated = validateRows(normalizedRows, view?.requiredFields || []);
    window.__wigImportState = {
      csvText,
      parsedRows: rows,
      validatedRows: validated,
      importResult: null
    };
    render();
    setTab('wigImport');
    const validCount = validated.filter((r) => r.isValid).length;
    toast(`已解析 ${validated.length} 行，${validCount} 行有效`);
  }

  if (importClearBtn) {
    event.preventDefault();
    event.stopPropagation();
    window.__wigImportState = {
      csvText: '',
      parsedRows: [],
      validatedRows: [],
      importResult: null
    };
    render();
    setTab('wigImport');
  }

  if (importConfirmBtn) {
    event.preventDefault();
    event.stopPropagation();
    const importState = window.__wigImportState;
    if (!importState || !importState.validatedRows?.length) {
      toast('请先解析 CSV 数据');
      return;
    }
    const validRows = importState.validatedRows.filter((r) => r.isValid).map((r) => r.data);
    if (validRows.length === 0) {
      toast('没有可导入的有效数据');
      return;
    }
    try {
      const result = await api('/api/wigs/batch-import', {
        method: 'POST',
        body: JSON.stringify({ rows: validRows })
      });
      window.__wigImportState = {
        ...importState,
        importResult: result
      };
      render();
      setTab('wigImport');
      await load();
      toast(`导入完成：成功 ${result.success} 条，失败 ${result.fail} 条`);
    } catch (error) {
      toast(error.message);
    }
  }
});

document.addEventListener('input', (event) => {
  const view = state.config.views.find((entry) => entry.id && (event.target.id === `search-${entry.id}` || event.target.id === `status-${entry.id}`));
  if (view) {
    if (view.type === 'preChecklist') {
      $(`#list-${view.id}`).innerHTML = renderPreChecklistList(view);
    } else {
      $(`#list-${view.id}`).innerHTML = renderList(view);
    }
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-create]');
  if (!form) return;
  event.preventDefault();
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  let payload = values(form, view);
  if (view.collection === 'preChecklists') {
    payload.checkItems = (state.config.checkItems || []).map((name) => ({
      name,
      result: '',
      note: ''
    }));
    payload.findings = '';
    payload.suggestions = '';
    payload.checker = '';
    payload.checkedAt = '';
    if (!payload.status) payload.status = '待检查';
  }
  await api(`/api/${form.dataset.create}`, { method: 'POST', body: JSON.stringify(payload) });
  form.reset();
  await load();
  toast('已保存');
});

$('#refreshBtn').addEventListener('click', () => load().then(() => toast('已刷新')));

async function boot() {
  state.config = await api('/api/config');
  renderTabs();
  await load();
}

boot().catch((error) => toast(error.message));
