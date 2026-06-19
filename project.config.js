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
    '待确认': 'warn'
  },
  collections: {
    wigs: { label: '假发档案' },
    repairs: { label: '维修单' },
    schedules: { label: '演出排期' }
  },
  stats: [
    { label: '假发档案', collection: 'wigs' },
    { label: '可演出', collection: 'wigs', filter: { field: 'status', value: '可演出' } },
    { label: '演出排期', collection: 'schedules' },
    { label: '维修单', collection: 'repairs' },
    { label: '紧急维修', collection: 'wigs', filter: { field: 'status', value: '紧急维修' } }
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
      id: 'wigs',
      label: '假发档案',
      collection: 'wigs',
      formTitle: '新增假发档案',
      listTitle: '档案列表',
      submitLabel: '保存档案',
      searchPlaceholder: '搜索角色、剧目、位置',
      searchFields: ['role', 'show', 'location', 'color'],
      statusField: 'status',
      statusOptions: ['可演出', '需要维修', '紧急维修', '已归还入库'],
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
        { label: '可用状态', name: 'status', type: 'select', options: ['可演出', '需要维修', '紧急维修', '已归还入库'] },
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
      titleFields: ['type', 'handler'],
      relation: { collection: 'wigs', localKey: 'wigId', labelFields: ['role', 'show'] },
      summaryFields: ['details', 'result'],
      detailFields: [
        { label: '截止日期', name: 'dueDate' },
        { label: '状态', name: 'status' },
        { label: '结果', name: 'result' }
      ],
      fields: [
        { label: '假发', name: 'wigId', type: 'relation', collection: 'wigs', labelFields: ['role', 'show'], required: true, wide: true },
        { label: '类型', name: 'type', type: 'select', options: ['勾织', '补发', '清洗', '定型', '归还检查'] },
        { label: '处理人', name: 'handler', required: true },
        { label: '截止日期', name: 'dueDate', type: 'date', required: true },
        { label: '状态', name: 'status', type: 'select', options: ['待处理', '维修中', '待检查', '已完成'] },
        { label: '处理内容', name: 'details', type: 'textarea', required: true, wide: true },
        { label: '结果', name: 'result', type: 'textarea', wide: true }
      ]
    }
  ],
  actions: [
    { id: 'schedule-confirm', label: '确认排期', collection: 'schedules', patches: [{ field: 'status', value: '已排期' }] },
    { id: 'wig-ready', label: '标记可演出', collection: 'wigs', patches: [{ field: 'status', value: '可演出' }] },
    { id: 'wig-urgent', label: '紧急维修', collection: 'wigs', patches: [{ field: 'status', value: '紧急维修' }] },
    { id: 'wig-return', label: '归还入库', collection: 'wigs', patches: [{ field: 'status', value: '已归还入库' }] },
    { id: 'repair-doing', label: '维修中', collection: 'repairs', patches: [{ field: 'status', value: '维修中' }] },
    { id: 'repair-check', label: '待检查', collection: 'repairs', patches: [{ field: 'status', value: '待检查' }] },
    {
      id: 'repair-done',
      label: '完成维修',
      collection: 'repairs',
      relation: { collection: 'wigs', localKey: 'wigId' },
      patches: [
        { field: 'status', value: '已完成' },
        { target: 'related', field: 'status', value: '可演出' }
      ]
    }
  ]
};
