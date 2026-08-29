import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { FirebaseService } from './firebase.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSignal = signal<User | null>(null);
  public currentUser = this.currentUserSignal.asReadonly();
  public isAuthenticated = computed(() => !!this.currentUserSignal());

  private authReadyPromise: Promise<User | null>;

  constructor(private fb: FirebaseService, private router: Router) {
    this.authReadyPromise = new Promise((resolve) => {
      onAuthStateChanged(this.fb.auth, (user) => {
        this.currentUserSignal.set(user);
        if (user && user.uid) {
          localStorage.setItem('pos_tenant_id', user.uid);
        }
        resolve(user);
      });
    });
  }

  async waitForAuthReady(): Promise<User | null> {
    return this.authReadyPromise;
  }

  async login(email: string, pass: string): Promise<User> {
    const cred = await signInWithEmailAndPassword(this.fb.auth, email, pass);
    this.currentUserSignal.set(cred.user);
    if (cred.user?.uid) {
      localStorage.setItem('pos_tenant_id', cred.user.uid);
    }
    return cred.user;
  }

  async register(email: string, pass: string): Promise<User> {
    const cred = await createUserWithEmailAndPassword(this.fb.auth, email, pass);
    this.currentUserSignal.set(cred.user);
    if (cred.user?.uid) {
      localStorage.setItem('pos_tenant_id', cred.user.uid);
    }
    return cred.user;
  }

  async logout(): Promise<void> {
    await signOut(this.fb.auth);
    this.currentUserSignal.set(null);
    localStorage.removeItem('pos_tenant_id');
    this.router.navigate(['/login']);
  }

  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(this.fb.auth, email);
  }

  async changePassword(currentPass: string, newPass: string): Promise<void> {
    const user = this.fb.auth.currentUser;
    if (!user || !user.email) {
      throw new Error('No hay usuario autenticado activo.');
    }
    const credential = EmailAuthProvider.credential(user.email, currentPass);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPass);
  }

  getTenantId(): string {
    const user = this.fb.auth.currentUser;
    if (user && user.uid) return user.uid;
    if (user && user.email) return user.email.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cached = localStorage.getItem('pos_tenant_id');
    if (cached) return cached;
    return 'main';
  }
}
