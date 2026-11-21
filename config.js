// GreenField configuration
// Firebase web config (Firebase Console → Project settings → Your apps → Web app).
// These keys are meant to be public in web apps; Firestore security rules protect the data.
window.GF_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBbD8ZVRo5wEVYopnbyCt9ryjwnxTxrRig",
    authDomain: "greenfield-app-f248b.firebaseapp.com",
    projectId: "greenfield-app-f248b",
    storageBucket: "greenfield-app-f248b.firebasestorage.app",
    messagingSenderId: "535594210757",
    appId: "1:535594210757:web:41a6a0995fb070678227ac"
  },
  // Optional: Cloudinary unsigned upload preset for listing photos.
  // Without it, photos are compressed and stored inside the listing itself.
  cloudinary: { cloudName: "", uploadPreset: "" }
};
