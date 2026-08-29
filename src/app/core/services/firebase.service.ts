import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  Firestore,
  memoryLocalCache
} from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  public app: FirebaseApp;
  public firestore: Firestore;
  public auth: Auth;

  constructor() {
    this.app = initializeApp(environment.firebase);

    // Sin persistencia en disco (IndexedDB): todo se consulta en memoria y en tiempo real
    this.firestore = initializeFirestore(this.app, {
      localCache: memoryLocalCache()
    });

    this.auth = getAuth(this.app);
  }
}
