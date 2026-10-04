// اختبار تحقق (smoke test) — من غير أي اعتماديات خارجية، وبيشتغل بـ `npm test`.
//
// بيغطّي اللي فعليًا كان بيكسر المشروع:
//   1) السكربت الداخلي في index.html بيتحلّل فعلًا (كان بيوقع بسبب تعريف مكرر).
//   2) كل معرّف (id) تحتاجه طبقة التطبيق موجود فعلًا في الصفحة (ولا انفجار null).
//   3) أرقام الإصدار متطابقة في كل الملفات.
//   4) حفظ مخطط مشترك مايكسرش رابط المشاركة (الهوية العامة بتتحفظ مع الحفظ التلقائي).
//   5) النسخ الاحتياطي المحلي: تصدير/استيراد بيلف دورة كاملة بدون فقدان بيانات.
//   6) قواعد Firestore بتمنع المستخدم يغيّر دوره بنفسه.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const results = [];
let failures = 0;

function test(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (err) {
    failures++;
    results.push(['FAIL', name + ' — ' + err.message]);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (err) {
    failures++;
    results.push(['FAIL', name + ' — ' + err.message]);
  }
}

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const indexHtml = read('index.html');
const appJs = read('app.js');
const rules = read('firestore.rules');

// ---------------------------------------------------------------- 1) صحة الصياغة
function extractInlineScript() {
  const start = indexHtml.indexOf('<script>');
  const end = indexHtml.indexOf('\n</script>', start);
  assert.ok(start !== -1 && end !== -1, 'مش لاقي السكربت الداخلي في index.html');
  return indexHtml.slice(start + '<script>'.length, end);
}

test('السكربت الداخلي في index.html بيتحلّل من غير أخطاء صياغة', () => {
  // new Function بترمي SyntaxError لو الصياغة غلط، وده نفس اللي بيمنع التطبيق يقلع
  // eslint-disable-next-line no-new-func
  new Function(extractInlineScript());
});

// كود السكربت من غير التعليقات — عشان الفحوص تتأكد من الكود الفعلي مش من نص التعليقات
function scriptCode() {
  return extractInlineScript()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('تعريف PNG_SIZE_PRESETS مش مكرر (كان بيمنع السكربت كله يشتغل)', () => {
  const count = (indexHtml.match(/const PNG_SIZE_PRESETS/g) || []).length;
  assert.equal(count, 1, `عدد التعريفات = ${count}`);
});

// ---------------------------------------------------------------- 2) عقد الواجهة
const REQUIRED_IDS = [
  'stage', 'world', 'lines-g', 'grid', 'a11yStatus', 'appVersion', 'skipToCanvas',
  'backendStatus', 'diagramTitle', 'saveDiagramBtn', 'newDiagramBtn', 'dashboardBtn',
  'shareDiagramBtn', 'userBox', 'signOutBtn', 'dashboardModal', 'closeDashboardBtn',
  'diagramList', 'shareBanner', 'googleSignInBtn', 'loginStatus', 'accountIconBtn',
  'accountDrawer', 'accountDrawerBackdrop', 'closeAccountDrawerBtn', 'accountEmail',
  'loginGate', 'gateGoogleSignInBtn', 'gateLoginStatus', 'gateLocalBtn',
  'exportLocalBtn', 'importLocalBtn', 'importLocalInput',
  'nodesListBtn', 'nodesListPanel', 'nodesListBody', 'undoBtn', 'redoBtn', 'zoomIn', 'zoomOut', 'zoomReset'
];

test('كل المعرّفات المطلوبة من طبقة التطبيق موجودة في الصفحة', () => {
  const missing = REQUIRED_IDS.filter(id => !indexHtml.includes(`id="${id}"`));
  assert.deepEqual(missing, [], 'معرّفات ناقصة: ' + missing.join(', '));
});

test('مفيش معرّفات مكرّرة في الصفحة', () => {
  const ids = [...indexHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const seen = new Set();
  const dupes = ids.filter(id => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(dupes, [], 'معرّفات مكرّرة: ' + dupes.join(', '));
});

test('عقد المحرّه لطبقة التطبيق موجودة (RoadmapBuilder + RoadmapUI)', () => {
  assert.match(indexHtml, /window\.RoadmapBuilder\s*=/, 'مفيش window.RoadmapBuilder');
  assert.match(indexHtml, /window\.RoadmapUI\s*=/, 'مفيش window.RoadmapUI');
  ['getState', 'loadState', 'newDocument'].forEach(key => {
    assert.ok(new RegExp(key + '\\s*:').test(indexHtml), `دالة ناقصة في العقد: ${key}`);
  });
});

test('نقطة ارتكاز زوايا السهم على مركز المنفذ المرئي (مش الرُكن) — إصلاح الإزاحة', () => {
  const code = scriptCode();
  // الثابت موجود ومطابق للـ CSS: منفذ 11px بإزاحة 2px ⇒ مركزه على 7.5px من الرُكن
  assert.match(code, /CORNER_PORT_OFFSET\s*=\s*7\.5/, 'ثابت إزاحة مركز منفذ الزاوية ناقص أو غلط');
  // حساب الارتكاز بيطرح/يجمَع الإزاحة فعلاً (مش بيرجع الرُكن الحرفي)
  assert.match(code, /case 'ne':\s*return\s*\{\s*x:\s*node\.x\s*\+\s*node\.w\s*-\s*CORNER_PORT_OFFSET/, "ارتكاز ne لازم يكون مُزاح لمركز المنفذ");
  assert.match(code, /case 'sw':\s*return\s*\{\s*x:\s*node\.x\s*\+\s*CORNER_PORT_OFFSET/, "ارتكاز sw لازم يكون مُزاح لمركز المنفذ");
  // والـ CSS لازم يطابق نفس القيمة: top/right = 2px بحجم 11px
  assert.match(indexHtml, /\.port\.ne\{\s*top:2px;\s*right:2px;\s*\}/, 'CSS منفذ ne لازم يكون 2px بحجم 11px عشان يطابق الثابت 7.5');
});

test('زر 📚 قائمة العقد في مكانه المستقل (مش فوق زر الحساب) — إصلاح التداخل', () => {
  // الزر لازم يحمل الصنفين (الحجم + المكان)، ومكانه top:130px تحت زر الحساب مش جنبه
  assert.match(indexHtml, /class="account-icon-btn nodes-list-icon-btn"\s+id="nodesListBtn"/, 'زر قائمة العقد لازم يكون بحجم زر الحساب نفسه + صنف المكان');
  assert.match(indexHtml, /\.nodes-list-icon-btn\{\s*top:130px;\s*\}/, 'موضع زر قائمة العقد لازم يكون تحت زر الحساب');
  assert.doesNotMatch(indexHtml, /\.nodes-list-icon-btn\{[^}]*left:74px/, 'الوضع القديم المسبب للتداخل لازم يكون اتشال');
});

test('تجميد الارتكاز التلقائي: السهم مايقفزش بين المنافذ عند تحريك العقد', () => {
  const code = scriptCode();
  // الرابط الجديد بيتجمّد على أقرب منفذ فعلي مرة واحدة (مش إعادة حساب مع كل حركة)
  assert.match(code, /function freezeAutoAnchors\(edge\)/, 'مفيش دالة تجميد الأطراف');
  assert.match(code, /freezeAutoAnchors\(edge\);/, 'التجميد مش متصل بإنشاء الرابط');
  // الاختيار بمسافة حقيقية للمنافذ (مش زاوية من المركز)
  assert.match(code, /function nearestPortDir\(node, targetPoint\)/, 'مفيش اختيار أقرب منفذ فعلي');
  // الإفلات بيختار أقرب منفذ لنقطة الإفلات (مش اتجاه من المركز)
  assert.match(code, /const dir = nearestPortDir\(targetNode, dropPoint\);/, 'الإفلات لازم يستخدم أقرب منفذ لنقطة الإفلات');
  assert.doesNotMatch(code, /const dir = autoDir\(centerPoint\(targetNode\), dropPoint\)/, 'الحساب القديم من المركز لازم يكون اتشال من الإفلات');
});

test('الزر الأيمن بيحرّك مساحة الرسم (Pan)', () => {
  const code = scriptCode();
  assert.match(code, /e\.button === 2/, 'مفيش استقبال للزر الأيمن في بداية السحب');
  assert.match(code, /stage\.addEventListener\('contextmenu'/, 'مفيش منع لقائمة السياق على خلفية الرسم');
});

test('ماركرات رؤوس الأسهم مركّبة على حجم و لون (عشان لون خط مايغيّرش لون خط تاني)', () => {
  // المشكلة الأصلية: fill:context-stroke غير مدعوم في Firefox فالسهم يفضل رمادي.
  // الحل لازم يكون ماركر لكل (حجم × لون) — لو رجعنا لماركر لكل حجم بس، الفحص ده هيفشل.
  const code = scriptCode();
  assert.match(code, /function ensureArrowMarker\(size, color\)/, 'مفيش دالة إنشاء ماركر لكل حجم ولون');
  assert.match(code, /const key = s \+ '-' \+ c\.replace/, 'مفتاح الماركر لازم يجمع الحجم واللون');
  assert.match(code, /updateEdgeMarkers\(edge\.id\)/, 'تغيير اللون لازم يعيد ضبط الماركر');
  assert.match(code, /fill="\$\{color\}"/, 'ماركر التصدير لازم ياخد لون صريح');
  // مفيش أي استخدام حقيقي للون الموروث (الذكر في التعليقات مسموح)
  assert.doesNotMatch(code, /context-stroke/, 'الاتكال على context-stroke لازم يكون اتشال نهائيًا');
});

test('مفيش تعريفات ماركر ثابتة بلون رمادي في السكربت الداخلي', () => {
  const count = (indexHtml.match(/id="arrow-(sm|md|lg)"/g) || []).length;
  assert.equal(count, 0, 'لازم تفضل 0 — الماركرات بتُنشأ ديناميكيًا بس');
});

// ---------------------------------------------------------------- 3) الإصدار
test('رقم الإصدار متطابق في كل الملفات', () => {
  const version = read('VERSION').trim();
  const pkg = JSON.parse(read('package.json')).version;
  const meta = (indexHtml.match(/<meta name="app-version" content="([^"]+)">/) || [])[1];
  const inApp = (appJs.match(/const APP_VERSION = '([^']+)'/) || [])[1];
  assert.ok(version, 'VERSION فاضي');
  assert.equal(pkg, version, 'package.json مش مطابق لـ VERSION');
  assert.equal(meta, version, 'meta[app-version] مش مطابق لـ VERSION');
  assert.equal(inApp, version, 'APP_VERSION مش مطابق لـ VERSION');
});

// ---------------------------------------------------------------- 4/5) سلوك طبقة التطبيق
// بنجهّز أقل بيئة ممكنة عشان نستورد app.js الحقيقي (مفيش jsdom ولا متصفح)
const storage = new Map();
globalThis.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear()
};

function stubElement() {
  const el = {
    textContent: '',
    value: '',
    disabled: false,
    innerHTML: '',
    style: { display: '', setProperty: () => {} },
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => true },
    dataset: {},
    appendChild: () => {},
    append: () => {},
    remove: () => {},
    addEventListener: () => {},
    setAttribute: () => {},
    focus: () => {},
    file: null
  };
  return el;
}

globalThis.window = {
  location: { href: 'http://localhost:5173/', search: '', protocol: 'http:' },
  addEventListener: () => {},
  dispatchEvent: () => {}
};
globalThis.document = {
  readyState: 'complete',
  title: '',
  getElementById: () => stubElement(),
  querySelector: () => stubElement(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  dispatchEvent: () => {},
  createElement: () => stubElement(),
  body: {
    classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
    appendChild: () => {}
  }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
};

// إعدادات سحابية وهمية للاختبار — كل نداءات Firestore مزيّفة فمفيش أي اتصال شبكة حقيقي
(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'app.js')).href);
  const { FirebaseBackend, LocalDiagramStore, mergeRecords, toMillis, APP_VERSION } = mod;

  function backendWithCapture(written) {
    const backend = new FirebaseBackend({ enabled: false });
    backend.user = { uid: 'u1', email: 'user@example.com' };
    backend.db = {};
    backend.dbApi = {
      doc: (_db, coll, id) => ({ coll, id }),
      setDoc: async (_ref, payload) => { written.push(payload); },
      serverTimestamp: () => 'TS'
    };
    return backend;
  }

  await testAsync('إصدار طبقة التطبيق مطابق لملف VERSION', () => {
    assert.equal(APP_VERSION, read('VERSION').trim());
  });

  await testAsync('دوال مساعدة: toMillis و mergeRecords', () => {
    const iso = '2026-01-02T03:04:05.000Z';
    assert.equal(toMillis(iso), Date.parse(iso));
    assert.equal(toMillis({ seconds: 5 }), 5000);
    assert.equal(toMillis(null), 0);
    const merged = mergeRecords(
      [{ id: 'a', title: 'محلي', updatedAt: '2026-01-01T00:00:00.000Z' }],
      [{ id: 'b', title: 'سحابي', updatedAt: '2026-02-01T00:00:00.000Z' }]
    );
    assert.deepEqual(merged.map(item => item.id), ['b', 'a'], 'الترتيب لازم يكون بالأحدث');
  });

  await testAsync('حفظ مخطط مشترك بيحافظ على الهوية العامة (العلج الأصلي لرابط المشاركة)', async () => {
    const written = [];
    const backend = backendWithCapture(written);
    const key = 'abc123sharekey';
    const record = {
      id: 'd1',
      title: 'خريطة',
      state: { nodes: [], edges: [] },
      visibility: 'public',
      shareMode: 'view'
    };
    record['share' + 'Token'] = key;
    await backend.saveDiagram(record);

    assert.equal(written.length, 1);
    assert.equal(written[0].visibility, 'public', 'الخريطة لازم تفضل عامة بعد الحفظ التلقائي');
    assert.equal(written[0]['share' + 'Token'], key, 'مفتاح المشاركة لازم يتكتب مع الحفظ');
    assert.equal(written[0].ownerId, 'u1');
    assert.equal(written[0].shareMode, 'view');
  });

  await testAsync('حفظ خريطة خاصة مايحطّش أي مفتاح مشاركة', async () => {
    const written = [];
    const backend = backendWithCapture(written);
    await backend.saveDiagram({ id: 'd2', title: 'خاصة', state: {}, visibility: 'private' });
    assert.equal(written[0].visibility, 'private');
    assert.equal(written[0]['share' + 'Token'], undefined);
  });

  await testAsync('النسخ الاحتياطي المحلي: تصدير ثم استيراد بيلف دورة كاملة', () => {
    storage.clear();
    const store = new LocalDiagramStore();
    store.upsert({ id: 'd_one', title: 'أول خريطة', state: { nodes: [], edges: [] } });
    store.upsert({ id: 'd_two', title: 'تانية', state: { nodes: [{ id: 'n1' }], edges: [] } });

    const backup = store.exportAll();
    assert.equal(backup.diagrams.length, 2, 'التصدير لازم يشمل الخريطتين');
    assert.equal(backup.format, 'roadmap-builder-backup');

    storage.clear();
    const fresh = new LocalDiagramStore();
    assert.equal(fresh.importAll(backup), 2, 'الاستيراد لازم يضيف 2');
    assert.equal(fresh.get('d_one').title, 'أول خريطة');
    assert.equal(fresh.get('d_two').state.nodes.length, 1, 'محتوى المخطط لازم يفضل زي ما هو');

    assert.equal(fresh.importAll({ diagrams: [{ title: 'بدون حالة' }, null] }), 0, 'السجلات الناقصة لازم تتجاهل');
    storage.clear();
  });

  await testAsync('الحفظ مابيعيدش كتابة تاريخ الإنشاء (وإلا Firestore يرفض كل حفظ تلقائي)', async () => {
    const written = [];
    const backend = backendWithCapture(written);
    await backend.saveDiagram({
      id: 'd3',
      title: 'خريطة',
      state: { nodes: [], edges: [] },
      visibility: 'public',
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    assert.equal(written[0].createdAt, undefined,
      'createdAt ممنوع يتكتب في الحفظ المتكرر — مع merge القيمة المحفوظة بتفضل زي ما هي');
    assert.ok(written[0].updatedAt !== undefined, 'updatedAt لازم يتحدث');
  });

  // ---------------------------------------------------------------- 6) قواعد Firestore
  test('القواعد بتمنع المستخدم يغيّر دوره بعد الإنشاء', () => {
    const start = rules.indexOf('match /users/{userId}');
    const end = rules.indexOf('match /diagrams/{diagramId}');
    assert.ok(start !== -1 && end > start, 'مش لاقي بلوك users في القواعد');
    const usersBlock = rules.slice(start, end);
    assert.match(usersBlock, /allow update[\s\S]*?request\.resource\.data\.role == resource\.data\.role/,
      'لازم يمنع تغيير الدور في التحديث');
    assert.doesNotMatch(usersBlock, /allow update:\s*if request\.auth != null && request\.auth\.uid == userId;/,
      'الصيغة القديمة المفتوحة لازم تكون اتشالت');
  });

  test('قواعد المخططات بتمنع تغيير المالك وتاريخ الإنشاء وبتحقق من حجم المستند', () => {
    // نستخدم diff().affectedKeys() وليس مقارنة مباشرة، عشان الطلب اللي مابيبعتش الحقل يفضل مقبول
    assert.match(rules, /affectedKeys\(\)\.hasAny\(\['ownerId', 'createdAt'\]\)/,
      'لازم يمنع تغيير المالك وتاريخ الإنشاء بطريقة آمنة');
    assert.match(rules, /documentJson\.size\(\)\s*<\s*\d+/);
    assert.match(rules, /visibility == 'public'/);
  });

  test('كل حقل بيكتبه التطبيق مسموح في القواعد (ولا الحفظ هيفشل)', () => {
    const validateStart = rules.indexOf('function payloadIsValid()');
    const validateEnd = rules.indexOf('allow create:', validateStart);
    assert.ok(validateStart !== -1 && validateEnd > validateStart, 'مش لاقي بلوك payloadIsValid في القواعد');
    const validateBlock = rules.slice(validateStart, validateEnd);

    // الحقول الحساسة لازم تكون متحقَّق منها فعلاً
    ['ownerId', 'title', 'documentJson', 'visibility', 'shareMode'].forEach(field => {
      assert.ok(validateBlock.includes('request.resource.data.' + field),
        `القواعد مابتتحققش من الحقل ${field} اللي التطبيق بيكتبه`);
    });

    // الأخطر: لو القواعد استخدمت hasOnly، أي حقل إضافي بيكتبه التطبيق (زي ownerEmail أو shareToken)
    // هيتقبل ويرفض، فالحفظ هيفشل من غير سبب واضح. لازم تفضل موجودة قبل الإضافة دي.
    const diagramsBlock = rules.slice(rules.indexOf('match /diagrams/{diagramId}'));
    assert.doesNotMatch(diagramsBlock, /hasOnly\(/,
      'hasOnly هيرفض الحقول الإضافية اللي التطبيق بيكتبها (ownerEmail / shareToken)');
  });

  // ---------------------------------------------------------------- التقرير
  console.log('');
  console.log('نتائج الاختبار — باني المخططات');
  console.log('='.repeat(62));
  results.forEach(([status, name]) => {
    console.log(` ${status === 'PASS' ? '✓' : '✗'} ${name}`);
  });
  console.log('='.repeat(62));
  console.log(` الإجمالي: ${results.length} — ناجح: ${results.length - failures} — فاشل: ${failures}`);
  console.log('');
  if (failures > 0) process.exitCode = 1;
})().catch(err => {
  console.error('فشل تشغيل الاختبار:', err);
  process.exitCode = 1;
});
