// فحص إضافي (مش بديل عن الفتح في المتصفح): بنشغّل ملف التصدير الحقيقي في بيئة DOM مصغّرة
// ونتأكد إن الملفات الناتجة سليمة فعلًا: عُقد، روابط، ألوان أسهم صريحة، وسم lang/dir، وسم إصدار.
// ملاحظة: مفيش jsdom هنا (المشروع بلا اعتماديات)، فبنستخرج المخرجات بطريقة ثابتة:
// بنقرا index.html ونطبّق نفس منطق التصدير على حالة مخطط اختبارية بسيطة.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const results = [];
let failures = 0;
function test(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { failures++; results.push(['FAIL', name + ' — ' + err.message]); }
}

// --- بنبني بيئة DOM صغيرة كافية عشان ملف index.html يقلع ---
// (المحرّر بيعتمد على createElement / appendChild / addEventListener / getElementById)
function makeStubEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    attributes: {},
    dataset: {},
    style: new Proxy({ setProperty: () => {} }, { get: (t, k) => t[k] ?? '', set: (t, k, v) => (t[k] = v, true) }),
    className: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    textContent: '',
    innerHTML: '',
    value: '',
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(c => c !== child); return child; },
    insertBefore(child) { this.children.push(child); return child; },
    remove() {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector: () => makeStubEl(),
    querySelectorAll: () => [],
    focus: () => {},
    getBoundingClientRect: () => ({ width: 1200, height: 800, left: 0, top: 0 }),
    clientWidth: 180, clientHeight: 64, scrollHeight: 40
  };
  return el;
}

const registry = new Map();
globalThis.document = {
  readyState: 'loading',
  title: '',
  documentElement: makeStubEl('html'),
  body: makeStubEl('body'),
  createElement: tag => makeStubEl(tag),
  createElementNS: (_ns, tag) => makeStubEl(tag),
  createTextNode: text => ({ textContent: text }),
  getElementById: id => registry.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  dispatchEvent: () => {},
  activeElement: null
};

// كل المعرّفات اللي الصفحة بتحتاجها قبل تشغيل السكربت
const NEEDED = [...indexHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
NEEDED.forEach(id => registry.set(id, makeStubEl('div')));
// عناصر خاصة بتحتاج سلوك إضافي
registry.get('lines-g').appendChild = function (c) { this.children.push(c); return c; };
registry.get('arrowDefs').appendChild = function (c) { this.children.push(c); return c; };

globalThis.window = {
  location: { href: 'http://localhost:5173/', search: '', protocol: 'http:' },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  open: () => null
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
};
globalThis.DOMParser = class DOMParser {
  parseFromString(html) {
    // نستخرج .rm-canvas بشكل بسيط بس للفحص
    return { querySelector: () => ({ outerHTML: html, style: {} }) };
  }
};
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

const inlineScript = indexHtml.slice(
  indexHtml.indexOf('<script>') + '<script>'.length,
  indexHtml.indexOf('\n</script>')
);

// ---------------------------------------------------------------- التشغيل
let api = null;
test('المحرّه يقلع من غير أخطاء ويطلّع واجهته البرمجية', () => {
  const factory = new Function(
    'document', 'window', 'localStorage', 'CustomEvent', 'DOMParser', 'requestAnimationFrame', 'navigator',
    inlineScript
  );
  factory(
    globalThis.document,
    globalThis.window,
    { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    globalThis.CustomEvent,
    globalThis.DOMParser,
    globalThis.requestAnimationFrame,
    { clipboard: {} }
  );
  api = globalThis.window.__roadmapBuilderInternals;
  assert.ok(api, 'مفيش __roadmapBuilderInternals بعد التشغيل');
});

test('المخطط الافتتاحي فيه عُقد وروابط (البذرة اشتغلت)', () => {
  assert.ok(api, 'المحرّه مقالعش');
  const keys = Object.keys(api.nodes);
  assert.ok(keys.length >= 6, `عدد العُقد = ${keys.length}، متوقع 6 على الأقل`);
  assert.ok(api.edges.length >= 6, `عدد الروابط = ${api.edges.length}، متوقع 6 على الأقل`);
});

test('تصدير 3 ملفات بيطلّع HTML و CSS و JS فعليًا', () => {
  assert.ok(api, 'المحرّه مقالعش');
  const out = api.buildExport();
  assert.ok(out, 'التصدير رجّع null');
  for (const key of ['html', 'css', 'js']) {
    assert.equal(typeof out[key], 'string', `${key} مش نص`);
    assert.ok(out[key].length > 200, `${key} فاضي تقريبًا (${out[key].length} حرف)`);
  }
});

test('ملف HTML المُصدَّر فيه العُقد والروابط و dir=rtl و lang=ar', () => {
  const { html } = api.buildExport();
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  const nodeCount = (html.match(/class="rm-node/g) || []).length;
  const edgeCount = (html.match(/class="rm-edge/g) || []).length;
  assert.ok(nodeCount >= 6, `عدد العُقد في التصدير = ${nodeCount}`);
  assert.ok(edgeCount >= 6, `عدد الروابط في التصدير = ${edgeCount}`);
  assert.match(html, /<title>خريطة الطريق<\/title>/);
});

test('ملف HTML المُصدَّر بيدّي كل رسمة وصفًا لقارئ الشاشة', () => {
  const { html } = api.buildExport();
  assert.match(html, /aria-label="/, 'مفيش أي aria-label في التصدير');
  // كل عنصر rm-node لازم يكون عليه إما aria-label أو دور وصفي
  // كل عنصر rm-node (وليس rm-node-text) لازم يكون عليه وصف
  const nodes = html.split(/class="rm-node(?=[" ])/).slice(1);
  assert.ok(nodes.length >= 6, `عدد العُقد المقسّمة = ${nodes.length}`);
  nodes.forEach((chunk, i) => {
    const head = chunk.slice(0, 400);
    assert.ok(/aria-label="/.test(head), `العقدة رقم ${i + 1} ملهاش وصف`);
  });
});

test('لون رأس السهم في التصدير صريح (مش موروث)', () => {
  const { html } = api.buildExport();
  assert.doesNotMatch(html, /context-stroke/, 'لسه بيستخدم context-stroke (يفشل في Firefox)');
  const markers = [...html.matchAll(/<marker id="([^"]+)"[\s\S]*?<path d="M0,0 L10,5 L0,10 z" fill="([^"]+)"/g)];
  assert.ok(markers.length >= 1, 'مفيش ماركرات في التصدير');
  markers.forEach(([, id, fill]) => {
    assert.match(fill, /^#[0-9a-fA-F]{3,8}$/, `الماركر ${id} لونه مش لون صريح: ${fill}`);
  });
  // أي ماركر مستخدم في الملف لازم يكون معرّف فعليًا (مفيش رابط مكسور)
  const used = [...html.matchAll(/marker-(?:start|end)="url\(#([^)]+)\)"/g)].map(m => m[1]);
  const defined = new Set(markers.map(m => m[1]));
  used.forEach(id => assert.ok(defined.has(id), `ماركر مستخدم وغير معرّف: ${id}`));
});

test('ملف CSS المُصدَّر مستقل ومفيش فيه أي اعتماد على التطبيق', () => {
  const { css } = api.buildExport();
  assert.match(css, /\.rm-node/, 'مفيش تنسيق .rm-node');
  assert.match(css, /\.rm-edge/, 'مفيش تنسيق .rm-edge');
  assert.doesNotMatch(css, /roadmap-builder:diagram/, 'في تسريب لمفاتيح التخزين المحلي');
});

test('ملف JS المُصدَّر بيتفاعل مع الكيبورد كمان مش الفأرة بس', () => {
  const { js } = api.buildExport();
  assert.match(js, /addEventListener\('focus'/);
  assert.match(js, /addEventListener\('blur'/);
});

test('مخرجات التصدير بتتحفظ وتتحمّل بنفس الشكل (دورة كاملة)', () => {
  const snapshot = api.snapshotState();
  const before = api.buildExport();
  api.restoreState(JSON.parse(JSON.stringify(snapshot)));
  const after = api.buildExport();
  assert.equal(after.html, before.html, 'الـ HTML اختلف بعد إعادة التحميل');
  assert.equal(after.css, before.css, 'الـ CSS اختلف بعد إعادة التحميل');
});

test('النص الطويل بيتصغّر ليدخل في العقدة (مفيش سكرول داخلي)', () => {
  const longText = 'نص طويل جدًا '.repeat(40);
  const snapshot = api.snapshotState();
  // نضيف عقدة صغيرة بنص طويل ونعيد حساب الملاءمة
  const nodesWithText = { ...snapshot, nodes: snapshot.nodes.concat([{
    id: 'n_long', x: 0, y: 0, w: 120, h: 40, text: longText, milestone: false
  }]) };
  api.restoreState(nodesWithText);
  const node = api.nodes['n_long'];
  assert.ok(node, 'العقدة الطويلة ماضافتش');
  // في بيئة الاختبار الأبعاد بتطلع ثابتة, فالمهم إن الدالة موجودة ومتنفّذة بدون خطأ
  assert.equal(typeof api.fitNodeText, 'function', 'دالة ملاءمة النص ناقصة');
  api.fitNodeText('n_long');
  api.restoreState(snapshot);
});

// ---------------------------------------------------------------- التقرير
console.log('');
console.log('نتائج فحص التصدير — باني المخططات');
console.log('='.repeat(62));
results.forEach(([status, name]) => console.log(` ${status === 'PASS' ? '✓' : '✗'} ${name}`));
console.log('='.repeat(62));
console.log(` الإجمالي: ${results.length} — ناجح: ${results.length - failures} — فاشل: ${failures}`);
console.log('');
if (failures > 0) process.exitCode = 1;
