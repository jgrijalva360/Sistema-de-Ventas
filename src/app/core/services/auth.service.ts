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
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { UsuarioSistema, RolUsuario } from '../models/models';
import { SuscripcionService } from './suscripcion.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSignal = signal<User | null>(null);
  private perfilUsuarioSignal = signal<UsuarioSistema | null>(null);

  public currentUser = this.currentUserSignal.asReadonly();
  public perfilUsuario = this.perfilUsuarioSignal.asReadonly();
  public isAuthenticated = computed(() => !!this.currentUserSignal());

  // Computados de Roles
  public rol = computed<RolUsuario>(() => this.perfilUsuarioSignal()?.rol || 'CAJERO');
  public esAdmin = computed(() => {
    const r = this.rol();
    return r === 'ADMIN' || r === 'SUPERADMIN';
  });
  public esEncargado = computed(() => {
    const r = this.rol();
    return r === 'ENCARGADO' || r === 'ADMIN' || r === 'SUPERADMIN';
  });
  public esCajero = computed(() => this.rol() === 'CAJERO');

  public nombreUsuario = computed(() => {
    const p = this.perfilUsuarioSignal();
    if (p && p.nombre) return p.nombre;
    const u = this.currentUserSignal();
    if (u && u.email) return u.email.split('@')[0];
    return 'Usuario';
  });

  private authReadyPromise: Promise<User | null>;

  constructor(
    public fb: FirebaseService,
    private router: Router,
    private suscripcionService: SuscripcionService
  ) {
    this.authReadyPromise = new Promise((resolve) => {
      onAuthStateChanged(this.fb.auth, async (user) => {
        this.currentUserSignal.set(user);
        if (user && user.uid) {
          await this.cargarPerfilUsuario(user);
        } else {
          this.perfilUsuarioSignal.set(null);
        }
        resolve(user);
      });
    });
  }

  async waitForAuthReady(): Promise<User | null> {
    return this.authReadyPromise;
  }

  /**
   * Carga o auto-crea el perfil del usuario en Firestore (usuarios/{uid}).
   * Garantiza retrocompatibilidad total con la cuenta principal existente.
   */
  async cargarPerfilUsuario(user: User): Promise<UsuarioSistema> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', user.uid);
    let snap = await getDoc(userDocRef);

    let perfil: UsuarioSistema;

    if (snap.exists()) {
      perfil = snap.data() as UsuarioSistema;
    } else {
      // Auto-crear como Dueño / ADMIN con su propio UID como empresaId inicial
      perfil = {
        uid: user.uid,
        email: user.email || '',
        nombre: user.displayName || user.email?.split('@')[0] || 'Administrador',
        empresaId: user.uid,
        rol: 'ADMIN',
        activo: true,
        fechaCreacion: new Date().toISOString(),
        ultimoAcceso: new Date().toISOString()
      };
      await setDoc(userDocRef, perfil);
    }

    this.perfilUsuarioSignal.set(perfil);
    localStorage.setItem('pos_tenant_id', perfil.empresaId);
    localStorage.setItem('pos_user_role', perfil.rol);

    // Inicializar y escuchar suscripción de la empresa
    await this.suscripcionService.inicializarSuscripcion(perfil.empresaId, perfil.email, perfil.nombre);
    this.suscripcionService.iniciarEscuchadorLive(perfil.empresaId);

    return perfil;
  }

  async login(email: string, pass: string): Promise<User> {
    const cred = await signInWithEmailAndPassword(this.fb.auth, email, pass);
    this.currentUserSignal.set(cred.user);
    const perfil = await this.cargarPerfilUsuario(cred.user);

    if (!perfil.activo) {
      await this.logout();
      throw new Error('Esta cuenta de usuario ha sido desactivada por el administrador.');
    }

    return cred.user;
  }

  async register(email: string, pass: string, nombreNegocio = 'Mi Negocio'): Promise<User> {
    const cred = await createUserWithEmailAndPassword(this.fb.auth, email, pass);
    this.currentUserSignal.set(cred.user);
    
    // Crear perfil ADMIN y empresa asociada
    const perfil: UsuarioSistema = {
      uid: cred.user.uid,
      email: cred.user.email || email,
      nombre: email.split('@')[0],
      empresaId: cred.user.uid,
      rol: 'ADMIN',
      activo: true,
      fechaCreacion: new Date().toISOString()
    };

    const userDocRef = doc(this.fb.firestore, 'usuarios', cred.user.uid);
    await setDoc(userDocRef, perfil);
    this.perfilUsuarioSignal.set(perfil);
    localStorage.setItem('pos_tenant_id', perfil.empresaId);
    localStorage.setItem('pos_user_role', perfil.rol);

    await this.suscripcionService.inicializarSuscripcion(perfil.empresaId, email, nombreNegocio);
    this.suscripcionService.iniciarEscuchadorLive(perfil.empresaId);

    return cred.user;
  }

  async logout(): Promise<void> {
    await signOut(this.fb.auth);
    this.currentUserSignal.set(null);
    this.perfilUsuarioSignal.set(null);
    localStorage.removeItem('pos_tenant_id');
    localStorage.removeItem('pos_user_role');
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
    const perfil = this.perfilUsuarioSignal();
    if (perfil && perfil.empresaId) return perfil.empresaId;
    const user = this.fb.auth.currentUser;
    if (user && user.uid) return user.uid;
    const cached = localStorage.getItem('pos_tenant_id');
    if (cached) return cached;
    return 'main';
  }

  // ── Gestión de Colaboradores (Centro de Administración) ───────
  async listarUsuariosEmpresa(): Promise<UsuarioSistema[]> {
    const empresaId = this.getTenantId();
    const q = query(
      collection(this.fb.firestore, 'usuarios'),
      where('empresaId', '==', empresaId)
    );
    const snap = await getDocs(q);
    const list: UsuarioSistema[] = [];
    snap.forEach((d) => list.push(d.data() as UsuarioSistema));
    return list;
  }

  async actualizarEstadoUsuario(uid: string, activo: boolean): Promise<void> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await updateDoc(userDocRef, { activo });
  }

  async actualizarRolUsuario(uid: string, rol: RolUsuario, sucursalId?: string, sucursalNombre?: string): Promise<void> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await updateDoc(userDocRef, {
      rol,
      sucursalId: sucursalId || '',
      sucursalNombre: sucursalNombre || ''
    });
  }
}

