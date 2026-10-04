# Roadmap Builder

> Build interactive node-and-connection diagrams — roadmaps, mind maps, learning paths, org charts — visually in your browser, then export them as standalone HTML/CSS/JS or a PNG image. No design tools, no code required.

<!-- Add badges here once available: license, GitHub stars, live deployment status -->

---

## 📌 Overview

- **What it is:**
  A browser-based, no-code visual diagram editor for building node-and-connection charts — roadmaps, learning paths, mind maps, org charts, process flows — on an infinite pannable/zoomable canvas, with full styling control and one-click export.
- **Who it's for:**
  - Individuals and teams who want to design a visual roadmap/diagram without touching a design tool or writing code
  - Educators and content creators who want to turn a course or curriculum into a shareable visual map (this project itself started as a programming-course roadmap)
  - Developers who need a quick, self-contained HTML/CSS/JS diagram to drop into a course page, README, or landing page
- **The problem it solves:**
  Most diagramming tools are either too generic (general-purpose whiteboards with a learning curve) or locked behind a paid SaaS with no clean export. Roadmap Builder focuses specifically on the "sequence of connected steps" use case, gives you real design control (colors, fonts, arrow styles, curved or right-angle connectors, even connections that branch off *other* connections), and always lets you walk away with a plain, dependency-free HTML/CSS/JS bundle or a PNG — no lock-in.
- **What makes it different (strongest angles):**
  - **Connections aren't limited to node-to-node.** Any connector can branch from a point on *another* connector, which is what most simple diagram tools can't do but real-world flow/org charts constantly need.
  - **Two connector styles, fully manual control.** Smooth curved connectors (drag a single control point) or right-angle "elbow" connectors (with automatic or forced horizontal/vertical trunk direction, snapped to the grid).
  - **Genuinely portable export.** The exported HTML/CSS/JS bundle is 100% self-contained — no dependency on this app or any backend to view or re-host it.
  - **Per-diagram default styling.** Set your preferred node/edge look once per diagram; every new element you add inherits it, and new diagrams pick up the last style you used.

---

## ✨ Features

**Available now**
- [x] Infinite pannable, zoomable canvas with a snap-to-grid toggle
- [x] Draggable nodes, resizable from all four corners
- [x] 8 connection points per node (4 sides + 4 corners) — the exact point used is decided by exactly where you drag from/drop onto, not an auto-guess
- [x] Curved (bezier, single drag handle) or right-angle "elbow" connectors, with automatic or manual trunk direction and grid snapping
- [x] Connections can branch off *another connection*, not just off a node
- [x] Arrowheads: none / end / start / both, in 3 sizes, colored automatically to match the line
- [x] Full node styling: background, text color, border color and width (px), hover color, hover animation (lift / glow / pulse / none), font family, font size
- [x] "Milestone" vs. regular node types
- [x] Optional clickable link per node (safe-URL checked — only `http`, `https`, `mailto`)
- [x] Multi-select via marquee (rubber-band) selection or Shift+click — drag, or delete, a whole group at once
- [x] Copy/paste nodes (single or multi-selected) with `Ctrl/Cmd+C` / `Ctrl/Cmd+V`
- [x] Full undo/redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`)
- [x] Node list / outline panel (WordPress-Gutenberg-style list view) — jump to any node, reorder stacking order by drag, delete from the list
- [x] Per-diagram default styles for new nodes/edges, saved with the diagram; new diagrams inherit your last-used defaults
- [x] Export as a standalone, dependency-free `index.html` + `style.css` + `script.js` bundle
- [x] Export as a PNG image — choose background (white / transparent / custom color), output size (native / HD / Full HD / square / custom), and resolution multiplier (1×/2×/3×)
- [x] Google sign-in (Firebase Auth), cloud save and a personal dashboard of your diagrams (Firestore)
- [x] Live share links (`?share=token`) that read the diagram straight from the database — different from exporting, the shared view always reflects the latest saved version, and view-only mode hides all editing controls
- [x] In-app toast / confirm / share-link dialogs (no default browser `alert`/`confirm`/`prompt`)

**Planned / not built yet**
- [ ] Installable component/package (e.g. `npm install`) for embedding in another app — the project is currently a standalone web app, not a library
- [ ] Granular roles & permissions UI (today there's a single configured owner account; everyone else is a regular editor)
- [ ] Workspaces / team accounts
- [ ] Version history for diagrams
- [ ] Prebuilt templates
- [ ] Real-time multi-user collaboration
- [ ] Paid plans / billing

---

## 🖼️ Demo / Screenshots

- [ ] Live demo link: *TODO — add your GitHub Pages URL, e.g. `https://USERNAME.github.io/REPO/`*
- [ ] Screenshot or GIF of the editor in action: *TODO*
- [ ] Screenshot of an exported diagram: *TODO*

---

## 🚀 Quick Start

Roadmap Builder is currently a **static web app**, not an npm package — there's nothing to install into another project (yet; see [Project Roadmap](#️-project-roadmap)). To run it:

### 1. Run it locally

> ⚠️ Google sign-in will **not** work if you just double-click `index.html` (`file://`). It needs to be served over `http(s)://`.

```bash
git clone <your-repo-url>
cd <repo-folder>
python -m http.server 5173
```

Then open `http://localhost:5173`.

### 2. Connect your own Firebase project (optional, for cloud save + sharing)

The app works fully offline/local without this step (diagrams are kept in your browser). To enable Google sign-in, cloud save, and share links:

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication → Google** sign-in provider.
3. Enable **Firestore Database**.
4. Copy your Web app config into `firebase-config.js`:

   ```js
   export const firebaseConfig = {
     apiKey: '...',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     storageBucket: 'your-project.appspot.com',
     messagingSenderId: '...',
     appId: '...'
   };

   export const ownerEmail = 'you@example.com'; // gets the "owner" role
   ```

5. Publish the rules in `firestore.rules` to your Firestore project.
6. In **Authentication → Settings → Authorized domains**, add the domain you're hosting on (e.g. `USERNAME.github.io`, or `localhost` for local testing).

### 3. Deploy

The app is designed to be pushed straight to **GitHub Pages** (or any static host) — no build step required.

### No-code usage

- [ ] Link to the hosted, ready-to-use version: *TODO — same as your demo link above*
- Basic workflow: open the app → sign in with Google → add nodes (or drag ready-made element types from the panel) → connect them → style them from the top bar → export as HTML/CSS/JS or PNG, or share a live link from the account drawer.

---

## ⚙️ Configuration

Configuration currently lives in `firebase-config.js` (not a component-prop API, since this isn't an embeddable library yet):

| Setting | Type | Description |
|---|---|---|
| `firebaseConfig` | object | Standard Firebase Web SDK config (apiKey, authDomain, projectId, etc.) |
| `ownerEmail` | string | The email address that gets the `owner` role on first sign-in; everyone else is created as a regular `editor` |

Per-diagram appearance (node/edge default colors, fonts, border width, arrow style, connector type) is configured **inside the app itself**, from the account drawer's "Default settings for this diagram" panel — see [Customization](#-customization).

---

## 🎨 Customization

- **Per-node styling:** background, text color, border color/width, hover color and animation, font family, font size, milestone flag, optional link — all from the top toolbar when a node is selected.
- **Per-edge styling:** line color, arrow shape and size, connector type (curved or elbow) and elbow direction — from the top toolbar when a connection is selected.
- **Per-diagram defaults:** open the account drawer → "Default settings for this diagram" to set what *new* nodes/edges look like by default (separately for regular vs. milestone nodes). These are saved with the diagram, and your latest choices seed any brand-new diagram you create afterward.
- **Ready-made element presets:** drag a preset (title, topic, sub-topic, paragraph, label, button, resource button, section, horizontal/vertical line) from the sidebar palette straight onto the canvas.
- **Export styling:** the exported HTML/CSS/JS keeps all of the above baked in as plain CSS/SVG — safe to hand-edit further after export.

---

## 🧩 Use Cases / Examples

- Programming/course learning roadmaps (the original use case this project was built for)
- Product or feature roadmaps for a landing page
- Personal learning or career paths
- Lightweight org charts / team structure diagrams
- Process or decision flows

*(Add real screenshots/links here as you gather examples from actual use.)*

---

## 💰 Pricing

There is no billing system yet — the project is free to self-host and use with your own Firebase project.

| Tier | Price | What's included |
|---|---|---|
| Self-hosted (now) | Free | Full editor, export, your own Firebase project for auth/cloud save/sharing |
| Hosted / Pro (planned) | TBD | See [Project Roadmap](#️-project-roadmap) |

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla JavaScript (ES2022+, no framework), HTML5, CSS3, SVG for connectors
- **Backend / Database:** Firebase Authentication (Google sign-in) + Cloud Firestore (diagram storage, share links)
- **Hosting:** Static hosting — built for GitHub Pages, works on any static host
- **Payments:** Not implemented

---

## 🗺️ Project Roadmap

- [x] Core visual editor (canvas, nodes, connectors, styling, export)
- [x] Multi-select, copy/paste, undo/redo, node list panel
- [x] Google auth, cloud save, dashboard, live share links
- [x] Drag-and-drop ready-made element palette, alignment guides
- [ ] Extract the editor into an installable, embeddable component/package
- [ ] Role management UI (beyond a single hardcoded owner)
- [ ] Diagram version history
- [ ] More element types (images, checklists, link groups)
- [ ] Real-time collaboration
- [ ] Paid plans / billing
- [ ] v1.0

---

## 🤝 Contributing

- **Run it locally:** see [Quick Start](#-quick-start) above.
- **Run tests:** *TODO — no automated test suite yet.*
- **Contribution guidelines:** *TODO*
- **Code of conduct:** *TODO*

---

## 📚 Documentation

- **Full docs:** *TODO*
- **API reference:** N/A — not a library yet (see [Project Roadmap](#️-project-roadmap))

---

## 🐛 Support / Feedback

- **Bug reports / feature requests:** *TODO — add your GitHub Issues link*
- **Contact:** *TODO*

---

## 📄 License

*TODO — pick a license (MIT is a common default for a project like this) and add a `LICENSE` file to the repo.*

---

## 🙏 Acknowledgments

- Built iteratively from an in-browser prototype (`prototype/Roadmap Builder v1.html` → `v4.html`) into the current app.
- Fonts: IBM Plex Sans Arabic, Cairo, Tajawal, Almarai, JetBrains Mono (Google Fonts).
- PNG export powered by [html2canvas](https://html2canvas.hertzen.com/).
