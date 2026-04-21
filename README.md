# FotoVault 📸

A self-hosted photo platform with Wasabi S3 storage, Firebase Auth, and role-based access control.

## Architecture

```
fotovault/
├── backend/          # Node.js + Express API
│   ├── routes/       # photos, albums, users, config
│   ├── middleware/   # Firebase auth + role guard
│   ├── services/     # Wasabi S3, Firebase Admin
│   └── server.js
└── frontend/         # React SPA
    └── src/
        ├── pages/    # Login, Register, Gallery, Albums, Admin
        ├── components/ # Navbar, PhotoGrid, UploadModal, Lightbox
        ├── contexts/ # AuthContext (Firebase)
        └── utils/    # Axios API client
```

## Roles

| Role    | View Photos | Download | Upload | Delete | Admin Panel |
|---------|-------------|----------|--------|--------|-------------|
| User    | ✓           | ✓        | ✗      | ✗      | ✗           |
| Editor  | ✓           | ✓        | ✓      | ✗      | ✗           |
| Admin   | ✓           | ✓        | ✓      | ✓      | ✓           |

## Prerequisites

- Node.js 18+
- A [Wasabi](https://wasabi.com) account with a bucket
- A [Firebase](https://console.firebase.google.com) project with:
  - Authentication enabled (Email/Password + Google)
  - Firestore database created

---

## Step 1: Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Enable **Authentication** → Sign-in methods → Email/Password + Google
3. Create a **Firestore** database (start in production mode)
4. Go to **Project Settings → Service Accounts** → Generate new private key
   - Save as `backend/serviceAccountKey.json` (or use the env vars below)
5. Go to **Project Settings → General** → copy the web app config

---

## Step 2: Wasabi Setup

1. Create a bucket (e.g. `fotovault-photos`) — note the region
2. Create an IAM user with programmatic access
3. Attach a policy granting full access to your bucket
4. Note your Access Key and Secret Key

---

## Step 3: Backend

```bash
cd backend
cp .env.example .env
# Fill in your Wasabi and Firebase credentials in .env
npm install
npm run dev
```

### Backend .env values

```
WASABI_ACCESS_KEY=     # from Wasabi IAM
WASABI_SECRET_KEY=     # from Wasabi IAM
WASABI_BUCKET=         # your bucket name
WASABI_REGION=         # e.g. us-east-1
WASABI_ENDPOINT=       # e.g. https://s3.us-east-1.wasabisys.com

FIREBASE_PROJECT_ID=   # from Firebase project settings
FIREBASE_CLIENT_EMAIL= # from service account JSON
FIREBASE_PRIVATE_KEY=  # from service account JSON (keep the \n escapes)

PORT=4000
FRONTEND_URL=http://localhost:3000
```

---

## Step 4: Frontend

```bash
cd frontend
cp .env.example .env
# Fill in your Firebase web config values
npm install
npm start
```

### Frontend .env values

```
REACT_APP_API_URL=http://localhost:4000
REACT_APP_FIREBASE_API_KEY=
REACT_APP_FIREBASE_AUTH_DOMAIN=
REACT_APP_FIREBASE_PROJECT_ID=
REACT_APP_FIREBASE_STORAGE_BUCKET=
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=
REACT_APP_FIREBASE_APP_ID=
```

---

## Step 5: First Admin User

After registering your first account:

1. Open **Firestore** in the Firebase console
2. Navigate to `users` collection → find your document (by UID)
3. Edit the `role` field from `"user"` to `"admin"`
4. Refresh the app — you'll now see the Admin panel

---

## Wasabi CORS Configuration

In your Wasabi bucket settings, add this CORS policy to allow browser uploads:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

For tighter rules, restrict writes by role using custom claims or server-side validation (already done via the backend middleware).

---

## Production Deployment

- **Backend**: Deploy to Railway, Render, Fly.io, or any Node.js host
- **Frontend**: `npm run build` → deploy to Vercel, Netlify, or S3+CloudFront
- Update `FRONTEND_URL` in backend `.env` and `REACT_APP_API_URL` in frontend `.env`

---

## Features

- 🔐 Firebase Auth (email/password + Google OAuth)
- 👥 Role-based access: user / editor / admin
- 📁 Albums with photo counts and cover photos
- 🏷️ Tags with filter chips in the gallery
- ⬆️ Drag-and-drop multi-photo upload with progress bars
- 🖼️ Auto-generated WebP thumbnails (via Sharp)
- 🔍 Lightbox viewer with keyboard navigation (←/→/Esc)
- ⚙️ Admin panel: branding (name, colors, logo), user management, settings
- 📥 Presigned download URLs (files served directly from Wasabi)
- 📱 Responsive design
