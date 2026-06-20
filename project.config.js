module.exports = {
  port: 3909,
  title: '剧场假发勾织维修单',
  lede: '维护角色假发档案、演出排期、可用状态、维修记录和归还入库，让服化团队在演出前知道哪顶假发能上场。',
  tones: {
    '可演出': 'ok',
    '已完成': 'ok',
    '已归还入库': 'ok',
    '紧急维修': 'bad',
    '需要维修': 'warn',
    '待处理': 'warn',
    '维修中': 'warn',
    '待检查': 'warn',
    '已排期': 'ok',
    '待确认': 'warn',
    '库存充足': 'ok',
    '库存不足': 'warn',
    '库存告警': 'bad',
    '检查通过': 'ok',
    '检查不通过': 'bad',
    '借出中': 'warn',
    '已归还': 'ok',
    '归还待检查': 'warn',
    '归还检查通过': 'ok',
    '归还检查不通过': 'bad',
    '已复盘': 'ok',
    '待复盘': 'warn'
  },
  collections: {
    wigs: { label: '假发档案' },
    repairs: { label: '维修单' },
    repairReviews: { label: '维修质量复盘' },
    schedules: { label: '演出排期' },
    consumables: { label: '耗材台账' },
    staff: { label: '服化团队' },
    preChecklists: { label: '演出前检查' },
    lendings: { label: '借出归还' }
  },
  checkItems: [
    '外观完整性',
    '发网状态',
    '发际线贴合度',
    '定型效果',
    '清洁度',
    '发丝牢固度',
    '配件齐全'
  ],
  stats: [
    { label: '假发档案', collection: 'wigs' },
    { label: '可演出', collection: 'wigs', filter: { field: 'status', value: '可演出' } },
    { label: '演出排期', collection: 'schedules' },
    { label: '维修单', collection: 'repairs' },
    { label: '紧急维修', collection: 'wigs', filter: { field: 'status', value: '紧急维修' } },
    { label: '耗材种类', collection: 'consumables' },
    { label: '库存告警', collection: 'consumables', dynamic: 'lowStock' },
    { label: '团队成员', collection: 'staff' },
    { label: '待处理维修', collection: 'repairs', filter: { field: 'status', value: '待处理' } },
    { label: '维修中', collection: 'repairs', filter: { field: 'status', value: '维修中' } },
    { label: '待检查', collection: 'repairs', filter: { field: 'status', value: '待检查' } },
    { label: '待检查清单', collection: 'preChecklists', filter: { field: 'status', value: '待检查' } },
    { label: '检查通过', collection: 'preChecklists', filter: { field: 'status', value: '检查通过' } },
    { label: '检查不通过', collection: 'preChecklists', filter: { field: 'status', value: '检查不通过' } },
    { label: '借出中', collection: 'lendings', filter: { field: 'status', value: '借出中' } },
    { label: '归还待检查', collection: 'lendings', filter: { field: 'status', value: '归还待检查' } },
    { label: '维修复盘', collection: 'repairReviews' },
    { label: '待复盘维修', collection: 'repairs', dynamic: 'pendingReview' }
  ],
  views: [
    {
      id: 'dashboard',
      label: '看板',
      type: 'dashboard',
      focusTitle: '演出前优先清单',
      focus: { collection: 'wigs', field: 'status', values: ['需要维修', '紧急维修', '可演出'], limit: 8 }
    },
    {
      id: 'schedules',
      label: '演出排期',
      collection: 'schedules',
      formTitle: '新增演出排期',
      listTitle: '排期列表',
      submitLabel: '创建排期',
      searchPlaceholder: '搜索剧目、角色',
      searchFields: ['show', 'role'],
      statusField: 'status',
      statusOptions: ['已排期', '待确认'],
      titleFields: ['show', 'performanceDate'],
      summaryFields: ['note'],
      relation: { collection: 'wigs', localKey: 'wigId', labelFields: ['role', 'show'] },
      detailFields: [
        { label: '场次日期', name: 'performanceDate' },
        { label: '角色', name: 'role' },
        { label: '假发状态', name: 'wigStatus', type: 'dynamic' }
      ],
      showWigStatus: true,
      fields: [
        { label: '剧目', name: 'show', required: true },
        { label: '场次日期', name: 'performanceDate', type: 'date', required: true },
        { label: '角色', name: 'role', required: true },
        { label: '假发', name: 'wigId', type: 'relation', collection: 'wigs', labelFields: ['role', 'show', 'color'], required: true, wide: true },
        { label: '排期状态', name: 'status', type: 'select', options: ['已排期', '待确认'] },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'preChecklists',
      label: '演出前检查',
      collection: 'preChecklists',
      type: 'preChecklist',
      formTitle: '生成检查清单',
      listTitle: '检查任务',
      submitLabel: '生成检查任务',
      searchPlaceholder: '搜索剧目、角色',
      searchFields: ['show', 'role'],
      statusField: 'status',
      statusOptions: ['待检查', '检查通过', '检查不通过'],
      titleFields: ['show', 'performanceDate'],
      summaryFields: ['findings'],
      relation: { collection: 'wigs', localKey: 'wigId', labelFields: ['role', 'show'] },
      detailFields: [
        { label: '演出日期', name: 'performanceDate' },
        { label: '角色', name: 'role' },
        { label: '检查状态', name: 'status' },
        { label: '检查人', name: 'checker' }
      ],
      showWigStatus: true,
      generateFromSchedules: true,
      checkItemList: true,
      fields: [
        { label: '演出日期', name: 'performanceDate', type: 'date', required: true },
        { label: '剧目', name: 'show', required: true },
        { label: '角色', name: 'role', required: true },
        { label: '假发', name: 'wigId', type: 'relation', collection: 'wigs', labelFields: ['role', 'show', 'color'], required: true, wide: true },
        { label: '检查状态', name: 'status', type: 'select', options: ['待检查', '检查通过', '检查不通过'] }
      ]
    },
    {
      id: 'lendings',
      label: '借出归还',
      collection: 'lendings',
      type: 'lending',
      formTitle: '登记借出',
      listTitle: '借出记录',
      submitLabel: '登记借出',
      searchPlaceholder: '搜索演员、剧目、角色',
      searchFields: ['actor', 'show', 'role'],
      statusField: 'status',
      statusOptions: ['借出中', '归还待检查', '归还检查通过', '归还检查不通过'],
      titleFields: ['actor', 'show'],
      summaryFields: ['note'],
      relation: { collection: 'wigs', localKey: 'wigId', labelFields: ['role', 'show'] },
      detailFields: [
        { label: '演员', name: 'actor' },
        { label: '剧目', name: 'show' },
        { label: '角色', name: 'role' },
        { label: '借出时间', name: 'lendDate' },
        { label: '预计归还', name: 'expectedReturnDate' },
        { label: '状态', name: 'status' }
      ],
      showWigStatus: true,
      checkItemList: true,
      fields: [
        { label: '假发', name: 'wigId', type: 'relation', collection: 'wigs', labelFields: ['role', 'show', 'color'], required: true, wide: true },
        { label: '演员姓名', name: 'actor', required: true },
        { label: '剧目', name: 'show', required: true },
        { label: '角色', name: 'role', required: true },
        { label: '借出日期', name: 'lendDate', type: 'date', required: true },
        { label: '预计归还日期', name: 'expectedReturnDate', type: 'date', required: true },
        { label: '借出状态', name: 'status', type: 'select', options: ['借出中', '归还待检查', '归还检查通过', '归还检查不通过'] },
        { label: '借出备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'wigs',
      label: '假发档案',
      collection: 'wigs',
      formTitle: '新增假发档案',
      listTitle: '档案列表',
      submitLabel: '保存档案',
      searchPlaceholder: '搜索角色、剧目、位置',
      searchFields: ['role', 'show', 'location', 'color'],
      statusField: 'status',
      statusOptions: ['可演出', '需要维修', '紧急维修', '已归还入库', '借出中', '归还待检查'],
      titleFields: ['role', 'show'],
      summaryFields: ['note'],
      detailFields: [
        { label: '发色', name: 'color' },
        { label: '发网', name: 'capSize' },
        { label: '演出日期', name: 'performanceDate' }
      ],
      fields: [
        { label: '角色', name: 'role', required: true },
        { label: '剧目', name: 'show', required: true },
        { label: '发色', name: 'color', required: true },
        { label: '发网尺寸', name: 'capSize', required: true },
        { label: '发际线类型', name: 'hairline', required: true },
        { label: '存放位置', name: 'location', required: true },
        { label: '演出日期', name: 'performanceDate', type: 'date', required: true },
        { label: '可用状态', name: 'status', type: 'select', options: ['可演出', '需要维修', '紧急维修', '已归还入库', '借出中', '归还待检查'] },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'repairs',
      label: '维修流转',
      collection: 'repairs',
      formTitle: '登记维修',
      listTitle: '维修单',
      submitLabel: '创建维修单',
      searchPlaceholder: '搜索处理人、类型、内容',
      searchFields: ['handler', 'type', 'details'],
      statusField: 'status',
      statusOptions: ['待处理', '维修中', '待检查', '已完成'],
      titleFields: ['type'],
      relation: { collection: 'wigs', localKey: 'wigId', labelFields: ['role', 'show'] },
      summaryFields: ['details', 'result'],
      detailFields: [
        { label: '处理人', name: 'handler', type: 'relation', collection: 'staff', labelFields: ['name'] },
        { label: '截止日期', name: 'dueDate' },
        { label: '状态', name: 'status' },
        { label: '结果', name: 'result' }
      ],
      fields: [
        { label: '假发', name: 'wigId', type: 'relation', collection: 'wigs', labelFields: ['role', 'show'], required: true, wide: true },
        { label: '类型', name: 'type', type: 'select', options: ['勾织', '补发', '清洗', '定型', '归还检查'] },
        { label: '处理人', name: 'handler', type: 'relation', collection: 'staff', labelFields: ['name'], required: true },
        { label: '截止日期', name: 'dueDate', type: 'date', required: true },
        { label: '状态', name: 'status', type: 'select', options: ['待处理', '维修中', '待检查', '已完成'] },
        { label: '处理内容', name: 'details', type: 'textarea', required: true, wide: true },
        { label: '结果', name: 'result', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'repairReviews',
      label: '维修质量复盘',
      collection: 'repairReviews',
      type: 'repairReview',
      formTitle: '新增复盘记录',
      listTitle: '复盘列表',
      submitLabel: '保存复盘',
      searchPlaceholder: '搜索复盘结论、返工原因',
      searchFields: ['conclusion', 'reworkReason', 'reviewer'],
      statusField: 'status',
      statusOptions: ['已复盘'],
      titleFields: ['conclusion'],
      relation: { collection: 'repairs', localKey: 'repairId', labelFields: ['type'] },
      summaryFields: ['reworkReason'],
      detailFields: [
        { label: '关联维修', name: 'repairId', type: 'relation', collection: 'repairs', labelFields: ['type'] },
        { label: '耗时评分', name: 'timeScore', type: 'score' },
        { label: '影响演出', name: 'affectsPerformance', type: 'pill' },
        { label: '复盘人', name: 'reviewer' }
      ],
      showWigStatus: true,
      fields: [
        { label: '维修单', name: 'repairId', type: 'relation', collection: 'repairs', labelFields: ['type', 'details'], required: true, wide: true, filterByStatus: '已完成' },
        { label: '复盘结论', name: 'conclusion', type: 'textarea', required: true, wide: true },
        { label: '返工原因', name: 'reworkReason', type: 'textarea', wide: true },
        { label: '耗时评分', name: 'timeScore', type: 'select', options: ['5', '4', '3', '2', '1'], required: true },
        { label: '是否影响演出', name: 'affectsPerformance', type: 'select', options: ['否', '是'], required: true },
        { label: '复盘人', name: 'reviewer', required: true },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'dispatchBoard',
      label: '维修派工板',
      type: 'dispatchBoard',
      collection: 'repairs',
      statusField: 'status',
      statusOptions: ['待处理', '维修中', '待检查', '已完成'],
      titleFields: ['type'],
      relation: { collection: 'wigs', localKey: 'wigId', labelFields: ['role', 'show'] },
      detailFields: [
        { label: '截止日期', name: 'dueDate' },
        { label: '状态', name: 'status' }
      ],
      showWigStatus: true
    },
    {
      id: 'staff',
      label: '人员工作台',
      collection: 'staff',
      formTitle: '新增团队成员',
      listTitle: '服化团队',
      submitLabel: '保存成员',
      searchPlaceholder: '搜索姓名、擅长工种',
      searchFields: ['name', 'specialty'],
      statusField: 'workloadStatus',
      statusOptions: ['空闲', '轻松', '适中', '繁忙', '过载'],
      titleFields: ['name', 'specialty'],
      summaryFields: ['note'],
      detailFields: [
        { label: '联系方式', name: 'contact' },
        { label: '工作负载', name: 'workload', type: 'staffWorkload' },
        { label: '待处理', name: 'pendingCount', type: 'staffStat', statKey: 'pending' },
        { label: '维修中', name: 'repairingCount', type: 'staffStat', statKey: 'repairing' },
        { label: '待检查', name: 'checkingCount', type: 'staffStat', statKey: 'checking' },
        { label: '在办总数', name: 'activeCount', type: 'staffStat', statKey: 'activeCount' }
      ],
      detailClass: 'staff-detail',
      cardClass: 'staff-card',
      fields: [
        { label: '姓名', name: 'name', required: true },
        { label: '擅长工种', name: 'specialty', required: true },
        { label: '联系方式', name: 'contact', required: true },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'consumables',
      label: '耗材台账',
      collection: 'consumables',
      formTitle: '新增耗材',
      listTitle: '耗材列表',
      submitLabel: '保存耗材',
      searchPlaceholder: '搜索耗材名称、备注',
      searchFields: ['name', 'note'],
      titleFields: ['name'],
      summaryFields: ['note'],
      detailFields: [
        { label: '当前库存', name: 'stock', type: 'stock' },
        { label: '安全库存', name: 'safeStock' },
        { label: '库存状态', name: 'stockStatus', type: 'dynamic' }
      ],
      stockField: 'stock',
      safeStockField: 'safeStock',
      fields: [
        { label: '耗材名称', name: 'name', required: true },
        { label: '库存数量', name: 'stock', type: 'number', required: true, default: 0 },
        { label: '安全库存', name: 'safeStock', type: 'number', required: true, default: 0 },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'wigImport',
      label: '批量导入',
      type: 'wigImport',
      collection: 'wigs',
      formTitle: '批量导入假发档案',
      listTitle: '导入预览',
      requiredFields: ['role', 'show', 'color', 'location', 'performanceDate'],
      fieldLabels: {
        role: '角色',
        show: '剧目',
        color: '发色',
        capSize: '发网尺寸',
        hairline: '发际线类型',
        location: '存放位置',
        performanceDate: '演出日期',
        status: '可用状态',
        note: '备注'
      },
      defaultStatus: '可演出'
    }
  ],
  actions: [
    { id: 'schedule-confirm', label: '确认排期', collection: 'schedules', patches: [{ field: 'status', value: '已排期' }] },
    { id: 'wig-ready', label: '标记可演出', collection: 'wigs', guards: [{ left: 'item.status', op: 'notIn', values: ['借出中', '归还待检查'], message: '借出或待检查中的假发不能直接标记为可演出，请先完成归还检查' }], patches: [{ field: 'status', value: '可演出' }] },
    { id: 'wig-urgent', label: '紧急维修', collection: 'wigs', guards: [{ left: 'item.status', op: 'notIn', values: ['借出中', '归还待检查'], message: '借出或待检查中的假发不能标记为紧急维修' }], patches: [{ field: 'status', value: '紧急维修' }] },
    {
      id: 'wig-return',
      label: '归还入库',
      collection: 'wigs',
      guards: [
        { left: 'item.status', op: 'notIn', values: ['借出中', '归还待检查'], message: '借出或待检查中的假发不能直接归还入库，请先完成归还检查' }
      ],
      patches: [{ field: 'status', value: '已归还入库' }]
    },
    { id: 'repair-doing', label: '维修中', collection: 'repairs', patches: [{ field: 'status', value: '维修中' }] },
    { id: 'repair-check', label: '待检查', collection: 'repairs', patches: [{ field: 'status', value: '待检查' }] },
    {
      id: 'repair-done',
      label: '完成维修',
      collection: 'repairs',
      relation: { collection: 'wigs', localKey: 'wigId' },
      guards: [
        { left: 'related.status', op: 'notIn', values: ['借出中', '归还待检查'], message: '该假发当前处于借出或待检查状态，不能完成维修，请先处理借出归还' }
      ],
      patches: [
        { field: 'status', value: '已完成' },
        { target: 'related', field: 'status', value: '可演出' }
      ]
    },
    {
      id: 'lending-return',
      label: '提交归还',
      collection: 'lendings',
      relation: { collection: 'wigs', localKey: 'wigId' },
      guards: [
        { left: 'item.status', op: 'eq', right: '借出中', message: '只有借出中的记录可以提交归还' }
      ],
      patches: [
        { field: 'status', value: '归还待检查' },
        { target: 'related', field: 'status', value: '归还待检查' }
      ]
    },
    {
      id: 'lending-check-pass',
      label: '检查通过',
      collection: 'lendings',
      relation: { collection: 'wigs', localKey: 'wigId' },
      guards: [
        { left: 'item.status', op: 'eq', right: '归还待检查', message: '只有归还待检查状态可以执行检查通过' }
      ],
      patches: [
        { field: 'status', value: '归还检查通过' },
        { target: 'related', field: 'status', value: '可演出' }
      ]
    },
    {
      id: 'lending-check-fail',
      label: '检查不通过',
      collection: 'lendings',
      relation: { collection: 'wigs', localKey: 'wigId' },
      guards: [
        { left: 'item.status', op: 'eq', right: '归还待检查', message: '只有归还待检查状态可以执行检查不通过' }
      ],
      patches: [
        { field: 'status', value: '归还检查不通过' },
        { target: 'related', field: 'status', value: '需要维修' }
      ]
    }
  ]
};
