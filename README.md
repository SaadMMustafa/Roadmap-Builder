# Roadmap Builder

منصة بناء خرائط بصرية مبنية من البروتوتايب `Roadmap Builder v4.html`، وتعمل كتطبيق static يمكن رفعه على GitHub Pages. الباك إند عبر Firebase: Google Authentication + Firestore للحفظ السحابي وروابط المشاركة الحية.

## التشغيل المحلي

**⚠️ مهم جدًا:** تسجيل الدخول بجوجل **لن يعمل أبدًا** لو فتحت `index.html` مباشرة بضغطتين (بروتوكول `file://`) — ده السبب الأشهر لمشاكل تسجيل الدخول. Firebase Auth يحتاج الصفحة تتقدّم من سيرفر حقيقي (`http://` أو `https://`).

شغّل سيرفر محلي بسيط أولًا:

```bash
python -m http.server 5173
```

ثم افتح:

```text
http://localhost:5173
```

## تفعيل Firebase

1. أنشئ مشروعًا في Firebase Console.
2. فعّل Authentication ثم Google provider.
3. فعّل Firestore Database.
4. انسخ إعدادات Web app إلى `firebase-config.js`.
5. ضع قواعد `firestore.rules` في Firestore Rules وانشرها.
6. من Authentication -> Settings -> Authorized domains أضف دومين GitHub Pages الخاص بك، مثل:

```text
USERNAME.github.io
```

مثال `firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey: '...',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '...',
  appId: '...'
};

export const ownerEmail = 'you@example.com';
```

## النشر على GitHub Pages

ارفع الملفات كما هي إلى Repository:

```text
index.html
app.js
firebase-config.js
firestore.rules
README.md
```

ثم من GitHub:

Settings -> Pages -> Deploy from a branch -> اختر branch مثل `main` و root.

## ملاحظات مهمة

- GitHub Pages يستضيف الفرونت فقط، لذلك تسجيل الدخول والحفظ السحابي والمشاركة يعتمدان على Firebase.
- رابط المشاركة يكون بالشكل: `https://USER.github.io/REPO/?share=TOKEN`.
- الدفع والاشتراكات لاحقًا تحتاج Firebase Cloud Functions أو Backend منفصل لأن مفاتيح Stripe السرية لا توضع داخل GitHub Pages.

## حل مشاكل تسجيل الدخول (Troubleshooting)

من آخر تعديل، شاشة تسجيل الدخول بقت بتعرض **سبب الخطأ الحقيقي** تحت الزرار مباشرة (مش رسالة عامة)، وكمان بقى فيه fallback تلقائي: لو المتصفح حجب نافذة تسجيل الدخول المنبثقة (Popup)، التطبيق هيحوّلك تلقائيًا لصفحة جوجل نفسها (Redirect) بدل ما يفشل بصمت.

أشهر الأسباب حسب الرسالة اللي هتظهرلك:

| الرسالة/الكود | السبب | الحل |
|---|---|---|
| "لازم تشغيل الصفحة من سيرفر" | فاتح `index.html` بالـ `file://` مباشرة | شغّل `python -m http.server` وافتح `http://localhost:...` |
| `auth/unauthorized-domain` | الدومين اللي بتفتح منه المشروع مش مضاف في Firebase | Firebase Console → Authentication → Settings → Authorized domains → أضف الدومين (أو `localhost`) |
| `auth/popup-blocked` | المتصفح حجب النافذة المنبثقة | التطبيق هيحوّلك تلقائيًا لصفحة جوجل كاملة بدل النافذة المنبثقة — أكمل من هناك |
| `auth/operation-not-allowed` | Google Sign-In مش مفعّل في المشروع | Firebase Console → Authentication → Sign-in method → فعّل Google |
| `auth/invalid-api-key` أو Firebase غير مفعّل | بيانات `firebase-config.js` غلط أو ناقصة | تأكد إن القيم منسوخة بالظبط من Firebase Console → Project settings → Web app |
| رسالة عامة "تعذر الاتصال بـ Firebase" مع كود مختلف | افتح Console في المتصفح (F12) وشوف الكود بالظبط جنب الرسالة، وابحث عنه في وثائق Firebase Auth Errors | — |

