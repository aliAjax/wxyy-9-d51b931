const state = {
  config: null,
  db: {},
  staffStats: {},
  dispatchBoard: {},
  availabilityWarnings: { warnings: [], stats: {} },
  auditLogs: { data: [], total: 0, loading: false },
  activeTab: '',
  dashboardDateFilter: { startDate: '', endDate: '' },
  _warningsDebounceTimer: null,
  _dashboardDebounceTimer: null
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

function filterByDateRange(items, dateField, startDate, endDate) {
  if (!startDate && !endDate) return items;
  return items.filter((item) => {
    const itemDate = new Date(item[dateField]);
    itemDate.setHours(0, 0, 0, 0);
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      if (itemDate < start) return false;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (itemDate > end) return false;
    }
    return true;
  });
}

function groupItemsByDate(items, dateField) {
  const groups = {};
  items.forEach((item) => {
    const date = item[dateField] || '未知日期';
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  });
  const sortedDates = Object.keys(groups).sort((a, b) => new Date(a) - new Date(b));
  return sortedDates.map((date) => ({ date, items: groups[date] }));
}

function formatDateLabel(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[date.getDay()];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  let label = `${month}月${day}日 ${weekday}`;
  if (diffDays === 0) label += '（今天）';
  else if (diffDays === 1) label += '（明天）';
  else if (diffDays === -1) label += '（昨天）';
  else if (diffDays > 0 && diffDays <= 7) label += `（还有${diffDays}天）`;
  else if (diffDays < 0 && diffDays >= -7) label += `（已过${Math.abs(diffDays)}天）`;
  return label;
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
    let items = state.db[field.collection] || [];
    if (field.filterByStatus) {
      items = items.filter((item) => item.status === field.filterByStatus);
    }
    if (field.filterWithoutReview) {
      const reviews = state.db.repairReviews || [];
      const reviewedIds = new Set(reviews.map((r) => r.repairId));
      items = items.filter((item) => !reviewedIds.has(item.id));
    }
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${optionList(items, field.labelFields)}</select></label>`;
  }
  return `<label class="${field.wide ? 'wide' : ''}">${field.label}<input type="${field.type || 'text'}" name="${field.name}" ${value} ${required}></label>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(value || '-')}</span>`;
}

function scoreStars(score) {
  const num = Number(score) || 0;
  const full = Math.min(Math.max(num, 0), 5);
  const empty = 5 - full;
  return `<span class="score-stars" title="${full} 分">${'★'.repeat(full)}${'☆'.repeat(empty)}</span>`;
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

async function setTab(tabId) {
  state.activeTab = tabId;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === tabId));

  if (tabId === 'auditLogs' && state.auditLogs.data.length === 0) {
    await loadAuditLogs();
    renderAuditList();
  }
}

function getPendingReviewCount() {
  const repairs = state.db.repairs || [];
  const reviews = state.db.repairReviews || [];
  const reviewedRepairIds = new Set(reviews.map((r) => r.repairId));
  return repairs.filter((r) => r.status === '已完成' && !reviewedRepairIds.has(r.id)).length;
}

function renderStats() {
  const { startDate, endDate } = state.dashboardDateFilter || {};
  const hasDateFilter = !!(startDate || endDate);
  const dateFieldMap = {
    schedules: 'performanceDate',
    preChecklists: 'performanceDate'
  };

  return `<div class="stats">${state.config.stats.map((stat) => {
    let items = state.db[stat.collection] || [];
    const dateField = dateFieldMap[stat.collection];
    if (hasDateFilter && dateField) {
      items = filterByDateRange(items, dateField, startDate, endDate);
    }
    let value;
    if (stat.dynamic === 'lowStock') {
      value = items.filter((item) => isLowStock(item)).length;
    } else if (stat.dynamic === 'pendingReview') {
      value = getPendingReviewCount();
    } else if (stat.filter) {
      value = items.filter((item) => item[stat.filter.field] === stat.filter.value).length;
    } else {
      value = items.length;
    }
    const labelSuffix = (hasDateFilter && dateField) ? '（日期筛选）' : '';
    return `<div class="stat"><span>${escapeHtml(stat.label)}${escapeHtml(labelSuffix)}</span><strong>${value}</strong></div>`;
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
    let isHtml = false;
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
    } else if (field.type === 'score') {
      value = scoreStars(item[field.name]);
      isHtml = true;
    } else if (field.type === 'pill') {
      const pillValue = item[field.name];
      tone = pillValue === '是' ? 'bad' : 'ok';
      value = pillValue || '-';
    } else if (field.type === 'relation') {
      value = relationLabel(field, item[field.name]);
    } else {
      value = item[field.name];
    }
    if (isHtml) {
      return `<div>${escapeHtml(field.label)}<br>${value}</div>`;
    }
    if (tone) {
      const displayValue = value === 0 ? '0' : (value || '-');
      return `<div>${escapeHtml(field.label)}<br>${pill(displayValue, tone)}</div>`;
    }
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');
  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');

  let reviewSummary = '';
  if (collection === 'repairs') {
    const review = getReviewForRepair(item.id);
    if (review) {
      const scoreHtml = scoreStars(review.timeScore);
      const affectsTone = review.affectsPerformance === '是' ? 'bad' : 'ok';
      reviewSummary = `
        <div class="repair-review-summary">
          <div class="review-summary-header">
            <span class="pill ok">已复盘</span>
            <span class="review-score">${scoreHtml}</span>
            <span class="pill ${affectsTone}">影响演出：${review.affectsPerformance}</span>
          </div>
          ${review.conclusion ? `<div class="review-conclusion-preview"><strong>结论：</strong>${escapeHtml(review.conclusion)}</div>` : ''}
          ${review.reviewer ? `<div class="review-reviewer">复盘人：${escapeHtml(review.reviewer)}</div>` : ''}
        </div>
      `;
    } else if (item.status === '已完成') {
      reviewSummary = `
        <div class="repair-review-summary pending">
          <span class="pill warn">待复盘</span>
          <span class="review-pending-hint">该维修单已完成，请到质量复盘模块登记复盘结论</span>
        </div>
      `;
    }
  }

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
    ${reviewSummary}
    ${details ? `<div class="detail${view.detailClass ? ' ' + view.detailClass : ''}">${details}</div>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${historyHtml(item)}
  </article>`;
}

function renderList(view) {
  const collection = view.collection;
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  const dateStart = view.dateRangeFilter ? $(`#date-start-${view.id}`)?.value || '' : '';
  const dateEnd = view.dateRangeFilter ? $(`#date-end-${view.id}`)?.value || '' : '';
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
  if (view.dateRangeFilter && view.dateField && (dateStart || dateEnd)) {
    items = filterByDateRange(items, view.dateField, dateStart, dateEnd);
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

  if (view.groupByDate && view.dateField && items.length > 0) {
    const groups = groupItemsByDate(items, view.dateField);
    const hasDateFilter = dateStart || dateEnd;
    const emptyHint = hasDateFilter
      ? `<div class="empty">该日期范围内暂无${escapeHtml(collectionLabel(collection))}</div>`
      : `<div class="empty">暂无${escapeHtml(collectionLabel(collection))}</div>`;
    return groups.length
      ? groups.map((group) => `
          <div class="date-group">
            <div class="date-group-header">
              <span class="date-group-title">${escapeHtml(formatDateLabel(group.date))}</span>
              <span class="date-group-count">${group.items.length} 场</span>
            </div>
            <div class="date-group-items">
              ${group.items.map((item) => renderCard(item, collection, view)).join('')}
            </div>
          </div>
        `).join('')
      : emptyHint;
  }

  const hasDateFilter = dateStart || dateEnd;
  const emptyHint = hasDateFilter
    ? `<div class="empty">该日期范围内暂无${escapeHtml(collectionLabel(collection))}</div>`
    : `<div class="empty">暂无${escapeHtml(collectionLabel(collection))}</div>`;
  return items.length ? items.map((item) => renderCard(item, collection, view)).join('') : emptyHint;
}

function renderDashboardView(view) {
  const { startDate, endDate } = state.dashboardDateFilter || {};
  const hasDateFilter = !!(startDate || endDate);
  const source = view.focus;
  const dateFieldMap = {
    schedules: 'performanceDate',
    preChecklists: 'performanceDate'
  };

  let items = [...(state.db[source.collection] || [])];
  if (source.field) items = items.filter((item) => source.values.includes(item[source.field]));

  const sourceDateField = dateFieldMap[source.collection];
  if (hasDateFilter && sourceDateField) {
    items = filterByDateRange(items, sourceDateField, startDate, endDate);
  }

  items = items.slice(0, source.limit || 8);
  const cardView = state.config.views.find((entry) => entry.collection === source.collection) || source;

  const dateFilterInfo = hasDateFilter
    ? `<span class="pill accent">日期筛选中 · 开始：${startDate || '不限'} 至 ${endDate || '不限'}</span>`
    : '';

  return `<section class="view active" id="${view.id}">
    <div class="dashboard-date-filter">
      <div class="date-range-filter dashboard-date-range">
        <label class="date-range-label">
          <span>开始日期</span>
          <input type="date" id="dashboard-date-start" class="date-filter-input" value="${escapeHtml(startDate)}">
        </label>
        <label class="date-range-label">
          <span>结束日期</span>
          <input type="date" id="dashboard-date-end" class="date-filter-input" value="${escapeHtml(endDate)}">
        </label>
        <button class="ghost date-reset-btn" id="dashboard-date-reset" type="button">重置日期</button>
      </div>
      ${dateFilterInfo}
    </div>
    ${renderStats()}
    <div class="panel"><h2>${escapeHtml(view.focusTitle)}${hasDateFilter && sourceDateField ? '（日期筛选）' : ''}</h2><div class="list">${items.length ? items.map((item) => renderCard(item, source.collection, cardView)).join('') : `<div class="empty">${hasDateFilter ? '日期范围内暂无重点事项' : '暂无重点事项'}</div>`}</div></div>
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
  const dateStart = view.dateRangeFilter ? $(`#date-start-${view.id}`)?.value || '' : '';
  const dateEnd = view.dateRangeFilter ? $(`#date-end-${view.id}`)?.value || '' : '';
  let items = [...(state.db[view.collection] || [])];

  if (query) {
    items = items.filter((item) => view.searchFields.some((field) => {
      const value = String(item[field] || '');
      return value.includes(query);
    }));
  }
  if (status) {
    items = items.filter((item) => item[view.statusField] === status);
  }
  if (view.dateRangeFilter && view.dateField && (dateStart || dateEnd)) {
    items = filterByDateRange(items, view.dateField, dateStart, dateEnd);
  }

  items.sort((a, b) => {
    const dateA = new Date(a.performanceDate || 0);
    const dateB = new Date(b.performanceDate || 0);
    return dateA - dateB;
  });

  if (view.groupByDate && view.dateField && items.length > 0) {
    const groups = groupItemsByDate(items, view.dateField);
    const hasDateFilter = dateStart || dateEnd;
    const emptyHint = hasDateFilter
      ? `<div class="empty">该日期范围内暂无${escapeHtml(collectionLabel(view.collection))}</div>`
      : `<div class="empty">暂无${escapeHtml(collectionLabel(view.collection))}</div>`;
    return groups.length
      ? groups.map((group) => `
          <div class="date-group">
            <div class="date-group-header">
              <span class="date-group-title">${escapeHtml(formatDateLabel(group.date))}</span>
              <span class="date-group-count">${group.items.length} 项</span>
            </div>
            <div class="date-group-items">
              ${group.items.map((item) => renderPreChecklistCard(item, view)).join('')}
            </div>
          </div>
        `).join('')
      : emptyHint;
  }

  const hasDateFilter = dateStart || dateEnd;
  const emptyHint = hasDateFilter
    ? `<div class="empty">该日期范围内暂无${escapeHtml(collectionLabel(view.collection))}</div>`
    : `<div class="empty">暂无${escapeHtml(collectionLabel(view.collection))}</div>`;
  return items.length ? items.map((item) => renderPreChecklistCard(item, view)).join('') : emptyHint;
}

function renderPreChecklistView(view) {
  const statusOptions = view.statusOptions || [];
  const dateRangeFilter = view.dateRangeFilter ? `
    <div class="date-range-filter">
      <label class="date-range-label">
        <span>开始日期</span>
        <input type="date" id="date-start-${view.id}" class="date-filter-input">
      </label>
      <label class="date-range-label">
        <span>结束日期</span>
        <input type="date" id="date-end-${view.id}" class="date-filter-input">
      </label>
      <button class="ghost date-reset-btn" id="date-reset-${view.id}" type="button">重置日期</button>
    </div>
  ` : '';
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <div class="panel">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="generate-section">
          <div class="generate-date-range">
            <label>开始日期
              <input type="date" id="generate-date-start-${view.id}">
            </label>
            <label>结束日期
              <input type="date" id="generate-date-end-${view.id}">
            </label>
          </div>
          <div class="generate-single-date" style="display:none;">
            <label>按演出日期生成
              <input type="date" id="generate-date-${view.id}">
            </label>
          </div>
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
        ${dateRangeFilter}
        <div class="list" id="list-${view.id}">${renderPreChecklistList(view)}</div>
      </div>
    </div>
  </section>`;
}

function renderCrudView(view) {
  const statusOptions = view.statusOptions || [];
  const dateRangeFilter = view.dateRangeFilter ? `
    <div class="date-range-filter">
      <label class="date-range-label">
        <span>开始日期</span>
        <input type="date" id="date-start-${view.id}" class="date-filter-input">
      </label>
      <label class="date-range-label">
        <span>结束日期</span>
        <input type="date" id="date-end-${view.id}" class="date-filter-input">
      </label>
      <button class="ghost date-reset-btn" id="date-reset-${view.id}" type="button">重置日期</button>
    </div>
  ` : '';
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
        ${dateRangeFilter}
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

function renderLendingCard(item, view) {
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

  const checkItemsHtml = renderCheckItems(item.checkItems || []);

  const actions = state.config.actions
    .filter((action) => action.collection === view.collection)
    .map((action) => `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`)
    .join('');

  let wigStatusBadge = '';
  if (view.showWigStatus && item.wigId) {
    const wigInfo = getWigStatus(item.wigId);
    wigStatusBadge = `<div class="wig-status"><span class="wig-status-label">假发状态：</span>${pill(wigInfo.status, wigInfo.tone)}</div>`;
  }

  const findingsHtml = item.checkFindings ? `<div class="findings"><strong>检查发现：</strong>${escapeHtml(item.checkFindings)}</div>` : '';

  const actualReturnHtml = item.actualReturnDate ? `<div class="meta">实际归还：${escapeHtml(item.actualReturnDate)}</div>` : '';
  const checkerHtml = item.checker ? `<div class="meta">检查人：${escapeHtml(item.checker)}</div>` : '';

  return `<article class="card check-card lending-card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, statusTone) : ''}</div>
    ${relation}
    ${wigStatusBadge}
    ${actualReturnHtml}
    ${checkerHtml}
    ${checkItemsHtml}
    ${findingsHtml}
    ${details ? `<div class="detail">${details}</div>` : ''}
    ${item.status === '借出中' || item.status === '归还待检查' ? `
    <div class="inline-actions">
      <button class="ghost" data-lending-check="${item.id}">${item.status === '借出中' ? '提交归还' : '查看/检查'}</button>
    </div>
    ` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${historyHtml(item)}
    <div class="check-form-panel" id="lending-check-form-${item.id}" style="display:none;">
      <h4>归还检查记录</h4>
      <div class="check-form-items">
        ${(item.checkItems || state.config.checkItems || []).map((ci, idx) => `
          <div class="check-form-item">
            <label class="check-item-label">${escapeHtml(ci.name || ci)}</label>
            <select data-lending-check-idx="${idx}" data-lending-check-field="result">
              <option value="">未检查</option>
              <option value="通过" ${ci.result === '通过' ? 'selected' : ''}>通过</option>
              <option value="不通过" ${ci.result === '不通过' ? 'selected' : ''}>不通过</option>
            </select>
            <input type="text" data-lending-check-idx="${idx}" data-lending-check-field="note" placeholder="备注" value="${escapeHtml(ci.note || '')}">
          </div>
        `).join('')}
      </div>
      <label>检查发现<textarea name="checkFindings" data-lending-check-text="checkFindings">${escapeHtml(item.checkFindings || '')}</textarea></label>
      <label>检查人<input type="text" name="checker" data-lending-check-text="checker" value="${escapeHtml(item.checker || '')}"></label>
      <div class="actions">
        <button class="secondary" data-lending-check-cancel="${item.id}">取消</button>
        ${item.status === '归还待检查' || item.status === '归还检查通过' || item.status === '归还检查不通过' ? `<button class="ghost" data-lending-check-reset="${item.id}">重置为待检查</button>` : item.status === '借出中' ? `<button class="ghost" data-lending-check-submit="归还待检查" data-lending-check-id="${item.id}">提交归还</button>` : ''}
        ${item.status !== '借出中' ? '' : ''}
        <button class="ghost" data-lending-check-submit="归还检查通过" data-lending-check-id="${item.id}">检查通过</button>
        <button class="danger" data-lending-check-submit="归还检查不通过" data-lending-check-id="${item.id}">检查不通过</button>
      </div>
    </div>
  </article>`;
}

function renderLendingList(view) {
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db[view.collection] || [])];

  items.sort((a, b) => {
    const dateA = new Date(a.lendDate || 0);
    const dateB = new Date(b.lendDate || 0);
    return dateB - dateA;
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
  return items.length ? items.map((item) => renderLendingCard(item, view)).join('') : `<div class="empty">暂无${escapeHtml(collectionLabel(view.collection))}</div>`;
}

function renderLendingView(view) {
  const statusOptions = view.statusOptions || [];
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <div class="panel">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <form class="single-create-form" data-create="${view.collection}" data-view="${view.id}">
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
        <div class="list" id="list-${view.id}">${renderLendingList(view)}</div>
      </div>
    </div>
  </section>`;
}

function getReviewForRepair(repairId) {
  return (state.db.repairReviews || []).find((r) => r.repairId === repairId);
}

function renderRepairReviewCard(item, view) {
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  let statusValue = item[view.statusField];
  let statusTone = toneFor(statusValue);
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    let value;
    let tone = '';
    let isHtml = false;
    if (field.type === 'dynamic' && field.name === 'wigStatus') {
      const wigInfo = getWigStatus(item.wigId);
      value = wigInfo.status;
      tone = wigInfo.tone;
    } else if (field.type === 'score') {
      value = scoreStars(item[field.name]);
      isHtml = true;
    } else if (field.type === 'pill') {
      const pillValue = item[field.name];
      tone = pillValue === '是' ? 'bad' : 'ok';
      value = pillValue || '-';
    } else if (field.type === 'relation') {
      value = relationLabel(field, item[field.name]);
    } else {
      value = item[field.name];
    }
    if (isHtml) {
      return `<div>${escapeHtml(field.label)}<br>${value}</div>`;
    }
    if (tone) {
      const displayValue = value || '-';
      return `<div>${escapeHtml(field.label)}<br>${pill(displayValue, tone)}</div>`;
    }
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');

  let wigStatusBadge = '';
  if (view.showWigStatus && item.wigId) {
    const wigInfo = getWigStatus(item.wigId);
    wigStatusBadge = `<div class="wig-status"><span class="wig-status-label">假发状态：</span>${pill(wigInfo.status, wigInfo.tone)}</div>`;
  }

  const conclusionHtml = item.conclusion ? `<div class="review-conclusion"><strong>复盘结论：</strong>${escapeHtml(item.conclusion)}</div>` : '';
  const reworkReasonHtml = item.reworkReason ? `<div class="review-rework-reason"><strong>返工原因：</strong>${escapeHtml(item.reworkReason)}</div>` : '';
  const reviewerHtml = item.reviewer ? `<div class="meta">复盘人：${escapeHtml(item.reviewer)}</div>` : '';
  const reviewedAtHtml = item.reviewedAt ? `<div class="meta">复盘时间：${escapeHtml(fmtDate(item.reviewedAt))}</div>` : '';

  return `<article class="card review-card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, statusTone) : ''}</div>
    ${relation}
    ${wigStatusBadge}
    ${reviewerHtml}
    ${reviewedAtHtml}
    ${conclusionHtml}
    ${reworkReasonHtml}
    ${details ? `<div class="detail">${details}</div>` : ''}
    <div class="inline-actions">
      <button class="ghost" data-review-edit="${item.id}">查看/编辑</button>
    </div>
    ${historyHtml(item)}
    <div class="review-form-panel" id="review-form-${item.id}" style="display:none;">
      <h4>编辑复盘记录</h4>
      <div class="review-form-items">
        <label class="wide">复盘结论<textarea name="conclusion" data-review-field="conclusion">${escapeHtml(item.conclusion || '')}</textarea></label>
        <label class="wide">返工原因<textarea name="reworkReason" data-review-field="reworkReason">${escapeHtml(item.reworkReason || '')}</textarea></label>
        <label>耗时评分
          <select name="timeScore" data-review-field="timeScore">
            ${['5', '4', '3', '2', '1'].map((s) => `<option value="${s}" ${item.timeScore === s ? 'selected' : ''}>${s} 分</option>`).join('')}
          </select>
        </label>
        <label>是否影响演出
          <select name="affectsPerformance" data-review-field="affectsPerformance">
            <option value="否" ${item.affectsPerformance === '否' ? 'selected' : ''}>否</option>
            <option value="是" ${item.affectsPerformance === '是' ? 'selected' : ''}>是</option>
          </select>
        </label>
        <label>复盘人<input type="text" name="reviewer" data-review-field="reviewer" value="${escapeHtml(item.reviewer || '')}"></label>
        <label class="wide">备注<textarea name="note" data-review-field="note">${escapeHtml(item.note || '')}</textarea></label>
      </div>
      <div class="actions">
        <button class="secondary" data-review-cancel="${item.id}">取消</button>
        <button data-review-save="${item.id}">保存修改</button>
      </div>
    </div>
  </article>`;
}

function renderRepairReviewList(view) {
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db[view.collection] || [])];

  items.sort((a, b) => {
    const dateA = new Date(a.reviewedAt || a.createdAt || 0);
    const dateB = new Date(b.reviewedAt || b.createdAt || 0);
    return dateB - dateA;
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
  return items.length ? items.map((item) => renderRepairReviewCard(item, view)).join('') : `<div class="empty">暂无${escapeHtml(collectionLabel(view.collection))}</div>`;
}

function renderRepairReviewView(view) {
  const statusOptions = view.statusOptions || [];
  const pendingCount = getPendingReviewCount();
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <div class="panel">
        <h2>${escapeHtml(view.formTitle)}</h2>
        ${pendingCount > 0 ? `<div class="pending-review-hint">还有 <span class="pill warn">${pendingCount}</span> 个已完成的维修单等待复盘</div>` : `<div class="pending-review-hint all-reviewed">所有已完成维修单都已复盘，做得好！ <span class="pill ok">✓</span></div>`}
        <form class="single-create-form" data-create="repair-reviews" data-view="${view.id}">
          <div class="form-grid">${view.fields.map((field) => {
            if (field.name === 'repairId') {
              return formField({ ...field, filterWithoutReview: true });
            }
            return formField(field);
          }).join('')}</div>
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
        <div class="list" id="list-${view.id}">${renderRepairReviewList(view)}</div>
      </div>
    </div>
  </section>`;
}

function renderRiskTypeLabel(type) {
  const map = {
    wigUnavailable: '假发不可用',
    repairLate: '维修超期',
    lendingOverdue: '借出未归还',
    scheduleConflict: '场次冲突',
    returnCheckFail: '归还检查不通过',
    preCheckPending: '演出前检查'
  };
  return map[type] || type;
}

function renderWarningCard(item) {
  const levelTone = item.riskLevel === 'high' ? 'bad' : item.riskLevel === 'medium' ? 'warn' : 'ok';
  const levelLabel = item.riskLevel === 'high' ? '高风险' : item.riskLevel === 'medium' ? '中风险' : '低风险';
  const daysLabel = item.daysUntilPerformance < 0
    ? `已过演出 ${Math.abs(item.daysUntilPerformance)} 天`
    : item.daysUntilPerformance === 0
    ? '今天演出'
    : item.daysUntilPerformance <= 2
    ? `还有 ${item.daysUntilPerformance} 天`
    : `还有 ${item.daysUntilPerformance} 天`;
  const daysTone = item.daysUntilPerformance <= 2 ? 'bad' : item.daysUntilPerformance <= 7 ? 'warn' : 'ok';

  let cardClass = 'card warning-card';
  if (item.riskLevel === 'high') cardClass += ' warning-high';
  else if (item.riskLevel === 'medium') cardClass += ' warning-medium';

  const relatedInfo = item.relatedItems?.lending?.actor
    ? `<div class="meta">使用人：${escapeHtml(item.relatedItems.lending.actor)}${item.relatedItems.lending.expectedReturnDate ? `，预计归还：${escapeHtml(item.relatedItems.lending.expectedReturnDate)}` : ''}</div>`
    : '';
  const handlerInfo = item.relatedItems?.repair?.handler
    ? `<div class="meta">维修处理人：${escapeHtml(relationLabel({ collection: 'staff', labelFields: ['name'] }, item.relatedItems.repair.handler))}${item.relatedItems.repair.dueDate ? `，截止：${escapeHtml(item.relatedItems.repair.dueDate)}` : ''}</div>`
    : '';

  return `<article class="${cardClass}" data-warning-id="${item.id}" data-wig-id="${item.wigId}" data-performance-date="${item.performanceDate}" data-show="${escapeHtml(item.show || '')}" data-role="${escapeHtml(item.role || '')}">
    <div class="card-head">
      <h3>${escapeHtml(item.title)}</h3>
      <div class="warning-badges">
        ${pill(levelLabel, levelTone)}
        ${pill(renderRiskTypeLabel(item.riskType), '')}
      </div>
    </div>
    <div class="warning-schedule-info">
      <strong>${escapeHtml(item.show || '-')}</strong> · ${escapeHtml(item.role || '-')}
      <span class="warning-date">${escapeHtml(item.performanceDate)}</span>
      ${pill(daysLabel, daysTone)}
    </div>
    <div class="warning-wig">关联假发：${escapeHtml(item.wigLabel)}</div>
    <p class="warning-description">${escapeHtml(item.description)}</p>
    ${relatedInfo}
    ${handlerInfo}
    <div class="actions warning-actions">
      ${item.actions.map((a) => a.type === 'link'
        ? `<button class="ghost" data-warning-nav="${a.target}">${escapeHtml(a.label)}</button>`
        : `<button class="${a.id === 'create-repair' ? 'danger' : 'ghost'}" data-warning-action="${a.id}" data-lending-id="${a.lendingId || ''}" data-prechecklist-id="${a.preChecklistId || ''}" data-repair-id="${a.repairId || ''}">${escapeHtml(a.label)}</button>`
      ).join('')}
    </div>
  </article>`;
}

function renderAvailabilityWarningsView(view) {
  const { warnings = [], stats = {} } = state.availabilityWarnings;
  const byType = stats.byType || {};
  const dateFilterInfo = stats.hasDateFilter
    ? `<span class="pill accent">日期筛选中 · 共 ${stats.totalPerformances || 0} 场演出</span>`
    : '';

  return `<section class="view" id="${view.id}">
    <div class="availability-header">
      <h2>演出可用性预警中心</h2>
      <div class="availability-refresh">
        <button class="ghost" id="warnings-refresh">刷新预警</button>
      </div>
    </div>
    <div class="availability-date-filter">
      <div class="date-range-filter warnings-date-filter">
        <label class="date-range-label">
          <span>开始日期</span>
          <input type="date" id="warnings-date-start" class="date-filter-input">
        </label>
        <label class="date-range-label">
          <span>结束日期</span>
          <input type="date" id="warnings-date-end" class="date-filter-input">
        </label>
        <button class="ghost date-reset-btn" id="warnings-date-reset" type="button">重置日期</button>
      </div>
      ${dateFilterInfo}
    </div>
    <div class="availability-stats">
      <div class="stat"><span>${stats.hasDateFilter ? '筛选范围内演出' : '未来14天演出'}</span><strong>${stats.hasDateFilter ? (stats.totalPerformances || 0) : (stats.upcomingPerformances || 0)}</strong></div>
      <div class="stat warning-stat-high"><span>高风险</span><strong>${stats.high || 0}</strong></div>
      <div class="stat warning-stat-medium"><span>中风险</span><strong>${stats.medium || 0}</strong></div>
      <div class="stat"><span>预警总数</span><strong>${stats.total || 0}</strong></div>
    </div>
    <div class="availability-type-stats">
      ${[
        { key: 'wigUnavailable', label: '假发不可用', tone: 'bad' },
        { key: 'repairLate', label: '维修超期', tone: 'bad' },
        { key: 'lendingOverdue', label: '借出未归还', tone: 'warn' },
        { key: 'scheduleConflict', label: '场次冲突', tone: 'warn' },
        { key: 'returnCheckFail', label: '归还检查不通过', tone: 'warn' },
        { key: 'preCheckPending', label: '检查待跟进', tone: 'warn' }
      ].map((t) => `
        <div class="type-stat-item">
          <span class="pill ${byType[t.key] > 0 ? t.tone : ''}">${escapeHtml(t.label)}</span>
          <strong>${byType[t.key] || 0}</strong>
        </div>
      `).join('')}
    </div>
    <div class="panel">
      <div class="availability-toolbar">
        <h3>风险清单（按演出日期排序）</h3>
        <div class="availability-filters">
          <select id="warnings-level-filter">
            <option value="">全部风险等级</option>
            <option value="high">仅高风险</option>
            <option value="medium">仅中风险</option>
          </select>
          <select id="warnings-type-filter">
            <option value="">全部风险类型</option>
            <option value="wigUnavailable">假发不可用</option>
            <option value="repairLate">维修超期</option>
            <option value="lendingOverdue">借出未归还</option>
            <option value="scheduleConflict">场次冲突</option>
            <option value="returnCheckFail">归还检查不通过</option>
            <option value="preCheckPending">检查待跟进</option>
          </select>
        </div>
      </div>
      <div class="list" id="warnings-list">
        ${warnings.length
          ? warnings.map(renderWarningCard).join('')
          : '<div class="empty">太棒了！近期演出没有可用性风险 🎉</div>'}
      </div>
    </div>
  </section>`;
}

function render() {
  $('#title').textContent = state.config.title;
  document.title = state.config.title;
  $('#lede').textContent = state.config.lede;
  $('#main').innerHTML = state.config.views.map((view) => {
    if (view.type === 'availabilityWarnings') return renderAvailabilityWarningsView(view);
    if (view.type === 'dashboard') return renderDashboardView(view);
    if (view.type === 'preChecklist') return renderPreChecklistView(view);
    if (view.type === 'dispatchBoard') return renderDispatchBoardView(view);
    if (view.type === 'wigImport') return renderWigImportView(view);
    if (view.type === 'lending') return renderLendingView(view);
    if (view.type === 'repairReview') return renderRepairReviewView(view);
    if (view.type === 'auditLogs') return renderAuditLogsView(view);
    return renderCrudView(view);
  }).join('');
  setTab(state.activeTab || state.config.views[0].id);
}

async function loadAvailabilityWarnings(startDate, endDate) {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  const query = params.toString() ? `?${params.toString()}` : '';
  const result = await api(`/api/availability-warnings${query}`);
  state.availabilityWarnings = result;
  return result;
}

async function load() {
  const warningsStart = $('#warnings-date-start')?.value || '';
  const warningsEnd = $('#warnings-date-end')?.value || '';
  const [db, staffStats, dispatchBoard, availabilityWarnings] = await Promise.all([
    api('/api/db'),
    api('/api/staff-stats'),
    api('/api/dispatch-board'),
    loadAvailabilityWarnings(warningsStart, warningsEnd)
  ]);
  state.db = db;
  state.staffStats = staffStats;
  state.dispatchBoard = dispatchBoard;
  state.availabilityWarnings = availabilityWarnings;

  if (state.activeTab === 'auditLogs') {
    await loadAuditLogs();
  }

  render();
}

async function loadAuditLogs(offset = 0) {
  state.auditLogs.loading = true;
  try {
    const result = await api(`/api/audit-logs?limit=50&offset=${offset}`);
    if (offset === 0) {
      state.auditLogs = { ...result, loading: false };
    } else {
      state.auditLogs = {
        ...result,
        data: [...state.auditLogs.data, ...result.data],
        loading: false
      };
    }
  } catch (error) {
    state.auditLogs.loading = false;
    toast(error.message);
  }
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
  const auditUndoBtn = event.target.closest('[data-audit-undo]');
  const auditLoadMoreBtn = event.target.closest('[data-audit-load-more]');
  const auditExpandBtn = event.target.closest('[data-audit-expand]');

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

  const lendingCheckEdit = event.target.closest('[data-lending-check]');
  const lendingCheckCancel = event.target.closest('[data-lending-check-cancel]');
  const lendingCheckSubmit = event.target.closest('[data-lending-check-submit]');
  const lendingCheckReset = event.target.closest('[data-lending-check-reset]');

  if (lendingCheckEdit) {
    const id = lendingCheckEdit.dataset.lendingCheck;
    const panel = document.getElementById(`lending-check-form-${id}`);
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }
  if (lendingCheckCancel) {
    const id = lendingCheckCancel.dataset.lendingCheckCancel;
    const panel = document.getElementById(`lending-check-form-${id}`);
    if (panel) panel.style.display = 'none';
  }
  if (lendingCheckSubmit) {
    event.preventDefault();
    event.stopPropagation();
    const id = lendingCheckSubmit.dataset.lendingCheckId;
    const status = lendingCheckSubmit.dataset.lendingCheckSubmit;
    const card = lendingCheckSubmit.closest('.lending-card');
    if (!card) return;

    const checkItems = [];
    const itemEls = card.querySelectorAll('[data-lending-check-idx]');
    const itemMap = new Map();
    itemEls.forEach((el) => {
      const idx = el.dataset.lendingCheckIdx;
      const field = el.dataset.lendingCheckField;
      if (!itemMap.has(idx)) itemMap.set(idx, {});
      itemMap.get(idx)[field] = el.value;
    });
    itemMap.forEach((val, idx) => {
      const labelEl = card.querySelector(`[data-lending-check-idx="${idx}"][data-lending-check-field="result"]`);
      const nameEl = labelEl?.closest('.check-form-item')?.querySelector('.check-item-label');
      checkItems.push({
        name: nameEl?.textContent || `检查项${Number(idx) + 1}`,
        result: val.result || '',
        note: val.note || ''
      });
    });

    const checkFindings = card.querySelector('[data-lending-check-text="checkFindings"]')?.value || '';
    const checker = card.querySelector('[data-lending-check-text="checker"]')?.value || '';

    try {
      await api(`/api/lendings/${id}/check`, {
        method: 'PATCH',
        body: JSON.stringify({ checkItems, checkFindings, checker, status })
      });
      await load();
      toast(status === '归还待检查' ? '已提交归还' : `已${status}`);
    } catch (error) {
      toast(error.message);
    }
  }
  if (lendingCheckReset) {
    event.preventDefault();
    event.stopPropagation();
    const id = lendingCheckReset.dataset.lendingCheckReset;
    try {
      await api(`/api/lendings/${id}/check`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: '归还待检查',
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
    const dateStartInput = document.getElementById(`generate-date-start-${viewId}`);
    const dateEndInput = document.getElementById(`generate-date-end-${viewId}`);
    const dateInput = document.getElementById(`generate-date-${viewId}`);

    let startDate = dateStartInput?.value || '';
    let endDate = dateEndInput?.value || '';
    let singleDate = dateInput?.value || '';

    if (startDate || endDate) {
      if (!startDate || !endDate) {
        toast('请选择完整的日期区间（开始日期和结束日期）');
        return;
      }
      if (new Date(startDate) > new Date(endDate)) {
        toast('开始日期不能晚于结束日期');
        return;
      }
      try {
        const result = await api('/api/pre-checklists/generate-range', {
          method: 'POST',
          body: JSON.stringify({ startDate, endDate })
        });
        await load();
        toast(`已生成 ${result.created} 个检查任务（共 ${result.total} 条排期，涉及 ${result.dateCount} 天）`);
      } catch (error) {
        toast(error.message);
      }
    } else if (singleDate) {
      try {
        const result = await api('/api/pre-checklists/generate', {
          method: 'POST',
          body: JSON.stringify({ performanceDate: singleDate })
        });
        await load();
        toast(`已生成 ${result.created} 个检查任务（共 ${result.total} 条排期）`);
      } catch (error) {
        toast(error.message);
      }
    } else {
      toast('请选择演出日期或日期区间');
    }
  }

  const dateResetBtn = event.target.closest('[id^="date-reset-"]');
  if (dateResetBtn) {
    event.preventDefault();
    event.stopPropagation();
    const viewId = dateResetBtn.id.replace('date-reset-', '');
    const startInput = $(`#date-start-${viewId}`);
    const endInput = $(`#date-end-${viewId}`);
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    const view = state.config.views.find((entry) => entry.id === viewId);
    if (view) {
      if (view.type === 'preChecklist') {
        $(`#list-${view.id}`).innerHTML = renderPreChecklistList(view);
      } else if (view.type === 'lending') {
        $(`#list-${view.id}`).innerHTML = renderLendingList(view);
      } else if (view.type === 'repairReview') {
        $(`#list-${view.id}`).innerHTML = renderRepairReviewList(view);
      } else {
        $(`#list-${view.id}`).innerHTML = renderList(view);
      }
    }
  }

  const warningsDateResetBtn = event.target.closest('#warnings-date-reset');
  if (warningsDateResetBtn) {
    event.preventDefault();
    event.stopPropagation();
    const startInput = $('#warnings-date-start');
    const endInput = $('#warnings-date-end');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    if (state._warningsDebounceTimer) {
      clearTimeout(state._warningsDebounceTimer);
    }
    loadAvailabilityWarnings('', '').then(() => {
      render();
      setTab(state.activeTab);
    }).catch((error) => {
      toast(error.message || '重置日期失败');
    });
  }

  const dashboardDateResetBtn = event.target.closest('#dashboard-date-reset');
  if (dashboardDateResetBtn) {
    event.preventDefault();
    event.stopPropagation();
    const startInput = $('#dashboard-date-start');
    const endInput = $('#dashboard-date-end');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    if (state._dashboardDebounceTimer) {
      clearTimeout(state._dashboardDebounceTimer);
    }
    state.dashboardDateFilter = { startDate: '', endDate: '' };
    render();
    setTab(state.activeTab);
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
    const allRows = importState.validatedRows.map((r) => r.data);
    if (validRows.length === 0) {
      toast('没有可导入的有效数据');
      return;
    }
    try {
      const result = await api('/api/wigs/batch-import', {
        method: 'POST',
        body: JSON.stringify({ rows: allRows })
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

  const reviewEdit = event.target.closest('[data-review-edit]');
  const reviewCancel = event.target.closest('[data-review-cancel]');
  const reviewSave = event.target.closest('[data-review-save]');

  if (reviewEdit) {
    const id = reviewEdit.dataset.reviewEdit;
    const panel = document.getElementById(`review-form-${id}`);
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }
  if (reviewCancel) {
    const id = reviewCancel.dataset.reviewCancel;
    const panel = document.getElementById(`review-form-${id}`);
    if (panel) panel.style.display = 'none';
  }
  if (reviewSave) {
    event.preventDefault();
    event.stopPropagation();
    const id = reviewSave.dataset.reviewSave;
    const card = reviewSave.closest('.review-card');
    if (!card) return;

    const payload = {};
    const fieldEls = card.querySelectorAll('[data-review-field]');
    fieldEls.forEach((el) => {
      const field = el.dataset.reviewField;
      payload[field] = el.value;
    });

    try {
      await api(`/api/repair-reviews/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await load();
      toast('复盘记录已更新');
    } catch (error) {
      toast(error.message);
    }
  }

  const warningsRefresh = event.target.closest('#warnings-refresh');
  if (warningsRefresh) {
    try {
      state.availabilityWarnings = await api('/api/availability-warnings');
      render();
      setTab('availabilityWarnings');
      toast('预警已刷新');
    } catch (error) {
      toast(error.message);
    }
  }

  const warningNav = event.target.closest('[data-warning-nav]');
  if (warningNav) {
    event.preventDefault();
    event.stopPropagation();
    const target = warningNav.dataset.warningNav;
    setTab(target);
  }

  const warningActionBtn = event.target.closest('[data-warning-action]');
  if (warningActionBtn) {
    event.preventDefault();
    event.stopPropagation();
    const actionId = warningActionBtn.dataset.warningAction;
    const card = warningActionBtn.closest('.warning-card');
    if (!card) return;

    const wigId = card.dataset.wigId;
    const performanceDate = card.dataset.performanceDate;
    const show = card.dataset.show;
    const role = card.dataset.role;
    const lendingId = warningActionBtn.dataset.lendingId;
    const preChecklistId = warningActionBtn.dataset.prechecklistId;
    const repairId = warningActionBtn.dataset.repairId;

    let actionType = '';
    if (actionId === 'create-repair') actionType = 'create-repair';
    else if (actionId === 'mark-return') actionType = 'mark-return';
    else if (actionId === 'mark-precheck') actionType = 'mark-precheck';
    else if (actionId === 'generate-precheck') actionType = 'generate-precheck';
    else if (actionId === 'reassign-repair') {
      setTab('dispatchBoard');
      toast('请到派工板重新指派');
      return;
    }

    if (!actionType) return;

    try {
      const result = await api('/api/availability-warnings/action', {
        method: 'POST',
        body: JSON.stringify({
          actionType,
          wigId,
          lendingId,
          preChecklistId,
          repairId,
          performanceDate,
          show,
          role
        })
      });
      await load();
      toast(result.message || '操作成功');
    } catch (error) {
      toast(error.message);
    }
  }

  if (auditExpandBtn) {
    const id = auditExpandBtn.dataset.auditExpand;
    const detailEl = document.getElementById(`audit-detail-${id}`);
    if (detailEl) {
      detailEl.style.display = detailEl.style.display === 'none' ? 'block' : 'none';
    }
  }

  if (auditUndoBtn) {
    event.preventDefault();
    event.stopPropagation();
    const id = auditUndoBtn.dataset.auditUndo;
    const confirmed = confirm('确定要撤销此操作吗？撤销后数据将恢复到操作前的状态。');
    if (!confirmed) return;

    try {
      const result = await api(`/api/audit-logs/${id}/undo`, { method: 'POST' });
      await load();
      await loadAuditLogs();
      renderAuditList();
      toast(result.message || '撤销成功');
    } catch (error) {
      toast(error.message);
    }
  }

  if (auditLoadMoreBtn) {
    event.preventDefault();
    event.stopPropagation();
    if (state.auditLogs.loading) return;
    const currentOffset = state.auditLogs.data.length;
    await loadAuditLogs(currentOffset);
    renderAuditList();
  }
});

document.addEventListener('input', (event) => {
  const view = state.config.views.find((entry) => entry.id && (
    event.target.id === `search-${entry.id}` ||
    event.target.id === `status-${entry.id}` ||
    event.target.id === `date-start-${entry.id}` ||
    event.target.id === `date-end-${entry.id}`
  ));
  if (view) {
    if (view.type === 'preChecklist') {
      $(`#list-${view.id}`).innerHTML = renderPreChecklistList(view);
    } else if (view.type === 'lending') {
      $(`#list-${view.id}`).innerHTML = renderLendingList(view);
    } else if (view.type === 'repairReview') {
      $(`#list-${view.id}`).innerHTML = renderRepairReviewList(view);
    } else {
      $(`#list-${view.id}`).innerHTML = renderList(view);
    }
  }

  if (event.target.id === 'warnings-level-filter' || event.target.id === 'warnings-type-filter') {
    const levelFilter = $('#warnings-level-filter')?.value || '';
    const typeFilter = $('#warnings-type-filter')?.value || '';
    let warnings = state.availabilityWarnings.warnings || [];
    if (levelFilter) warnings = warnings.filter((w) => w.riskLevel === levelFilter);
    if (typeFilter) warnings = warnings.filter((w) => w.riskType === typeFilter);
    const listEl = $('#warnings-list');
    if (listEl) {
      listEl.innerHTML = warnings.length
        ? warnings.map(renderWarningCard).join('')
        : '<div class="empty">没有符合筛选条件的预警</div>';
    }
  }

  if (event.target.id === 'warnings-date-start' || event.target.id === 'warnings-date-end') {
    if (state._warningsDebounceTimer) {
      clearTimeout(state._warningsDebounceTimer);
    }
    state._warningsDebounceTimer = setTimeout(async () => {
      const startDate = $('#warnings-date-start')?.value || '';
      const endDate = $('#warnings-date-end')?.value || '';
      try {
        await loadAvailabilityWarnings(startDate, endDate);
        const warningsView = state.config.views.find((v) => v.type === 'availabilityWarnings');
        if (warningsView && state.activeTab === warningsView.id) {
          const listEl = $('#warnings-list');
          const statsEl = $('.availability-stats');
          const typeStatsEl = $('.availability-type-stats');
          const dateFilterInfoEl = $('.availability-date-filter');
          if (listEl && statsEl && typeStatsEl) {
            const warnings = state.availabilityWarnings.warnings || [];
            const stats = state.availabilityWarnings.stats || {};
            const byType = stats.byType || {};
            listEl.innerHTML = warnings.length
              ? warnings.map(renderWarningCard).join('')
              : '<div class="empty">太棒了！当前范围内没有可用性风险 🎉</div>';
          }
          render();
          setTab(state.activeTab);
        }
      } catch (error) {
        toast(error.message || '加载预警数据失败');
      }
    }, 500);
  }

  if (event.target.id === 'dashboard-date-start' || event.target.id === 'dashboard-date-end') {
    if (state._dashboardDebounceTimer) {
      clearTimeout(state._dashboardDebounceTimer);
    }
    state._dashboardDebounceTimer = setTimeout(() => {
      const startDate = $('#dashboard-date-start')?.value || '';
      const endDate = $('#dashboard-date-end')?.value || '';
      state.dashboardDateFilter = { startDate, endDate };
      const dashboardView = state.config.views.find((v) => v.type === 'dashboard');
      if (dashboardView && state.activeTab === dashboardView.id) {
        render();
        setTab(state.activeTab);
      }
    }, 300);
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
  if (view.collection === 'lendings') {
    payload.checkItems = (state.config.checkItems || []).map((name) => ({
      name,
      result: '',
      note: ''
    }));
    payload.checkFindings = '';
    payload.checker = '';
    payload.checkedAt = '';
    if (!payload.status) payload.status = '借出中';
  }
  const createPath = form.dataset.create;
  await api(`/api/${createPath}`, { method: 'POST', body: JSON.stringify(payload) });
  form.reset();
  await load();
  toast('已保存');
});

$('#refreshBtn').addEventListener('click', () => load().then(() => toast('已刷新')));

function operationTypeLabel(type) {
  const labels = {
    create: '创建',
    update: '更新',
    delete: '删除',
    action: '动作'
  };
  return labels[type] || type;
}

function operationTypeTone(type) {
  const tones = {
    create: 'ok',
    update: 'warn',
    delete: 'bad',
    action: 'accent'
  };
  return tones[type] || '';
}

function renderChangesDiff(before, after, title) {
  if (!before && !after) return '';

  const fields = new Set();
  if (before) Object.keys(before).forEach(k => fields.add(k));
  if (after) Object.keys(after).forEach(k => fields.add(k));

  const changes = [];
  for (const field of fields) {
    if (['updatedAt', 'history', 'createdAt'].includes(field)) continue;
    const beforeVal = before?.[field];
    const afterVal = after?.[field];
    if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) continue;

    changes.push(`
      <div class="diff-row">
        <span class="diff-field">${escapeHtml(field)}</span>
        <span class="diff-before">${beforeVal !== undefined ? escapeHtml(JSON.stringify(beforeVal)) : '—'}</span>
        <span class="diff-arrow">→</span>
        <span class="diff-after">${afterVal !== undefined ? escapeHtml(JSON.stringify(afterVal)) : '—'}</span>
      </div>
    `);
  }

  if (changes.length === 0) return '';

  return `
    <div class="diff-section">
      <div class="diff-title">${escapeHtml(title)}</div>
      <div class="diff-table">
        ${changes.join('')}
      </div>
    </div>
  `;
}

function renderAuditLogCard(log) {
  const collectionLabel = state.config.collections[log.collection]?.label || log.collection;
  const isUndone = log.undone;
  const canUndo = log.canUndo;
  const cannotUndoReason = log.cannotUndoReason;

  let relatedChangesHtml = '';
  if (log.relatedChanges && log.relatedChanges.length > 0) {
    relatedChangesHtml = log.relatedChanges.map(rc => {
      const rcLabel = state.config.collections[rc.collection]?.label || rc.collection;
      return renderChangesDiff(rc.before, rc.after, `关联变更：${rcLabel} - ${rc.targetLabel || rc.targetId}`);
    }).join('');
  }

  const mainDiffHtml = renderChangesDiff(log.before, log.after,
    log.operationType === 'create' ? '创建数据' :
    log.operationType === 'delete' ? '删除数据' :
    '变更详情'
  );

  const undoButton = isUndone
    ? `<span class="pill muted">已撤销</span>`
    : canUndo
      ? `<button class="danger" data-audit-undo="${log.id}">撤销此操作</button>`
      : `<button class="ghost" disabled title="${escapeHtml(cannotUndoReason || '')}">无法撤销</button>`;

  const undoReason = !isUndone && !canUndo && cannotUndoReason
    ? `<div class="undo-reason">${escapeHtml(cannotUndoReason)}</div>`
    : '';

  return `
    <div class="audit-card ${isUndone ? 'undone' : ''}">
      <div class="audit-header">
        <div class="audit-title">
          <span class="pill ${operationTypeTone(log.operationType)}">${operationTypeLabel(log.operationType)}</span>
          <span class="pill">${escapeHtml(collectionLabel)}</span>
          <span class="audit-summary">${escapeHtml(log.summary)}</span>
        </div>
        <div class="audit-time">${fmtDate(log.createdAt)}</div>
      </div>
      <div class="audit-meta">
        <span>影响对象：${escapeHtml(log.targetLabel || log.targetId)}</span>
        ${log.actionLabel ? `<span>动作：${escapeHtml(log.actionLabel)}</span>` : ''}
        ${log.relatedChanges && log.relatedChanges.length > 0 ? `<span>关联变更：${log.relatedChanges.length} 项</span>` : ''}
      </div>
      <div class="audit-actions">
        ${undoButton}
        <button class="ghost" data-audit-expand="${log.id}">查看详情</button>
      </div>
      ${undoReason}
      <div id="audit-detail-${log.id}" class="audit-detail" style="display: none;">
        ${mainDiffHtml}
        ${relatedChangesHtml}
        <div class="audit-ids">
          <div><strong>审计ID：</strong>${escapeHtml(log.id)}</div>
          <div><strong>对象ID：</strong>${escapeHtml(log.targetId)}</div>
          ${log.undoneAt ? `<div><strong>撤销时间：</strong>${fmtDate(log.undoneAt)}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderAuditList() {
  const listEl = $('#list-auditLogs');
  if (!listEl) return;

  const logs = state.auditLogs.data || [];
  const total = state.auditLogs.total || 0;
  const loading = state.auditLogs.loading;

  if (logs.length === 0 && !loading) {
    listEl.innerHTML = '<div class="empty">暂无操作记录</div>';
    return;
  }

  let loadMoreHtml = '';
  if (logs.length < total) {
    loadMoreHtml = `
      <div class="load-more">
        <button class="ghost" data-audit-load-more ${loading ? 'disabled' : ''}>
          ${loading ? '加载中...' : `加载更多（${logs.length}/${total}）`}
        </button>
      </div>
    `;
  }

  listEl.innerHTML = logs.map(renderAuditLogCard).join('') + loadMoreHtml;
}

function renderAuditLogsView(view) {
  return `
    <section class="view" id="${view.id}">
      <h2>${escapeHtml(view.formTitle)}</h2>
      <div class="audit-description">
        <p>记录所有数据的新增、修改、删除和动作流转操作。支持撤销最近一次未被依赖的普通操作。</p>
      </div>
      <div class="audit-stats">
        <div class="stat">
          <span>总记录数</span>
          <strong>${state.auditLogs.total || 0}</strong>
        </div>
        <div class="stat">
          <span>已撤销</span>
          <strong>${(state.auditLogs.data || []).filter(l => l.undone).length}</strong>
        </div>
        <div class="stat">
          <span>可撤销</span>
          <strong>${(state.auditLogs.data || []).filter(l => !l.undone && l.canUndo).length}</strong>
        </div>
      </div>
      <div id="list-${view.id}" class="audit-list">
        ${state.auditLogs.loading ? '<div class="empty">加载中...</div>' : ''}
      </div>
    </section>
  `;
}

async function boot() {
  state.config = await api('/api/config');
  renderTabs();
  await load();
}

boot().catch((error) => toast(error.message));
