const state = {
  config: null,
  db: {},
  staffStats: {},
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

  const actions = state.config.actions
    .filter((action) => action.collection === view.collection)
    .map((action) => `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`)
    .join('');

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
        <button class="ghost" data-check-submit="待检查" data-check-id="${item.id}">保存草稿</button>
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

function render() {
  $('#title').textContent = state.config.title;
  document.title = state.config.title;
  $('#lede').textContent = state.config.lede;
  $('#main').innerHTML = state.config.views.map((view) => {
    if (view.type === 'dashboard') return renderDashboardView(view);
    if (view.type === 'preChecklist') return renderPreChecklistView(view);
    return renderCrudView(view);
  }).join('');
  setTab(state.activeTab || state.config.views[0].id);
}

async function load() {
  const [db, staffStats] = await Promise.all([api('/api/db'), api('/api/staff-stats')]);
  state.db = db;
  state.staffStats = staffStats;
  render();
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  const action = event.target.closest('[data-action]');
  const checkEdit = event.target.closest('[data-check-edit]');
  const checkCancel = event.target.closest('[data-check-cancel]');
  const checkSubmit = event.target.closest('[data-check-submit]');
  const generateBtn = event.target.closest('[id^="generate-btn-"]');

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
