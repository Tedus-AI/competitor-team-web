import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyA1TJaTQFeh_18p5RSxOUFQGhQwrpaF1Bk",
  authDomain: "competitor-team-web.firebaseapp.com",
  projectId: "competitor-team-web",
  storageBucket: "competitor-team-web.firebasestorage.app",
  messagingSenderId: "733404503139",
  appId: "1:733404503139:web:f0f953664c8b4b0abc6c56"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
