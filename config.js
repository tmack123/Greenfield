// GreenField configuration
// Paste your Firebase web config below (Firebase Console → Project settings → Your apps → Web app).
// Leave firebase as null to run in demo mode (everything saved on the device only).
window.GF_CONFIG = {
  firebase: null,
  /* Example:
  firebase: {
    apiKey: "AIza...",
    authDomain: "greenfield-app.firebaseapp.com",
    projectId: "greenfield-app",
    storageBucket: "greenfield-app.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abc123"
  },
  */
  // Optional: Cloudinary unsigned upload preset for listing photos.
  // Without it, photos are compressed and stored inside the listing itself.
  cloudinary: { cloudName: "", uploadPreset: "" }
};
