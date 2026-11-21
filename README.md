# GreenField

A digital agricultural extension web app with soil assessment, agricultural weather advice and a farm produce marketplace. It is a Progressive Web App (PWA), so farmers can install it to their phone home screen without an app store.

## Features
- **Soil Analyzer**: estimates N, P, K, pH and organic carbon from soil colour and texture, then recommends crops, fertilizer and management practices. The values are estimates and are clearly labelled as such.
- **Weather**: live 7-day forecast (Open-Meteo) with rule-based farming advice for Abeokuta, Lagos, Ibadan, Ijebu-Ode and Sagamu.
- **Marketplace**: shared online listings with photos, search, filters, saved items and WhatsApp contact. Sellers can mark items as sold or delete them.
- **Accounts**: sign in with Google or email and password. Soil analyses are saved to the account and sync across devices.
- **Alerts**: admin announcements reach every user, alongside personal in-app notifications.
- **Admin panel**: remove listings, post or delete announcements, and see user and listing counts.
- **Offline-ready**: the service worker caches the app, and Firestore keeps recent data available offline.

## Files
| File | Purpose |
|---|---|
| `index.html` | The app: screens, styles and the soil, weather and market logic |
| `backend.js` | Firebase sign-in, Firestore data, Cloudinary uploads, profile and admin |
| `config.js` | **Your keys go here** (Firebase and Cloudinary) |
| `firestore.rules` | Security rules to paste into Firebase |
| `manifest.json`, `sw.js`, `icons/` | PWA install and offline support |

Without Firebase keys, the app runs in **demo mode**: everything is saved on the device only, and sample listings are shown.

## Setup (about 10 minutes)

### 1. Firebase
1. Go to console.firebase.google.com, click **Add project** and name it `greenfield-app`.
2. Click the **Web `</>`** icon, register the app, and copy the `firebaseConfig` values into `config.js`.
3. Go to **Build → Authentication → Get started**, then enable **Google** and **Email/Password**.
4. Go to **Build → Firestore Database → Create database** and choose **production mode**.
5. Go to **Firestore → Rules**, replace everything with the contents of `firestore.rules`, and click **Publish**.
6. After deploying, go to **Authentication → Settings → Authorised domains** and add your site's domain (for example `greenfield-app.vercel.app`).

### 2. Cloudinary (optional, for better photos)
1. Go to **Settings → Upload → Add upload preset**, set the signing mode to **Unsigned**, and save.
2. Put your **cloud name** and **preset name** in `config.js`.

Without Cloudinary, photos are compressed and stored inside each listing, which also works.

### 3. Make yourself admin
1. Sign in to the app, open **Account → Admin setup**, and copy your user ID.
2. In **Firestore**, start a collection called `admins` and add a document whose **Document ID** is your user ID (add any field, such as `role` = `admin`).
3. Sign out and sign back in. The **Admin panel** button appears on your Account page.

### 4. Deploy
This is a static site, so no build step is needed. Deploy the folder to Vercel (import the GitHub repo, framework preset **Other**), Netlify or Firebase Hosting.
