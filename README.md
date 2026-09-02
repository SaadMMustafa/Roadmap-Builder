# Roadmap Builder

منصة بناء خرائط بصرية مبنية من البروتوتايب `Roadmap Builder v4.html`، وتعمل كتطبيق static يمكن رفعه على GitHub Pages. الباك إند اختياري عبر Firebase: Authentication + Firestore للحفظ السحابي وروابط المشاركة الحية.

## التشغيل المحلي

افتح `index.html` مباشرة في المتصفح. سيعمل التطبيق بالحفظ المحلي من خلال `localStorage`.

لو أردت اختباره من سيرفر محلي:

```bash
python -m http.server 5173
```

ثم افتح:

```text
http://localhost:5173
```

## تفعيل Firebase

1. أنشئ مشروعًا في Firebase Console.
2. فعّل Authentication ثم Email/Password.
3. فعّل Firestore Database.
4. انسخ إعدادات Web app إلى `firebase-config.js`.
5. ضع قواعد `firestore.rules` في Firestore Rules وانشرها.

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

- GitHub Pages يستضيف الفرونت فقط، لذلك الحفظ السحابي والمشاركة يعتمدان على Firebase.
- رابط المشاركة يكون بالشكل: `https://USER.github.io/REPO/?share=TOKEN`.
- الدفع والاشتراكات لاحقًا تحتاج Firebase Cloud Functions أو Backend منفصل لأن مفاتيح Stripe السرية لا توضع داخل GitHub Pages.
