import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
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
import { docStream$, collectionStream$ } from '../utils/realtime.util';
import { Subscription, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSignal = signal<User | null>(null);
  private perfilUsuarioSignal = signal<UsuarioSistema | null>(null);

  public currentUser = this.currentUserSignal.asReadonly();
  public perfilUsuario = this.perfilUsuarioSignal.asReadonly();
  public isAuthenticated = computed(() => !!this.currentUserSignal());

  // ── Modo Terminal de Cobro / Cajero Activo por PIN ───────────
  public cajeroActivo = signal<UsuarioSistema | null>(
    (() => {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem('pos_terminal_cajero_activo');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    })()
  );

  public terminalBloqueada = signal<boolean>(
    (() => {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem('pos_terminal_bloqueada') === 'true';
    })()
  );

  // Computados de Roles y Permisos (Se adaptan al colaborador autenticado por PIN)
  public rol = computed<RolUsuario>(() => {
    const cajero = this.cajeroActivo();
    if (cajero && cajero.rol) {
      return cajero.rol;
    }
    return this.perfilUsuarioSignal()?.rol || 'CAJERO';
  });

  public esSuperAdmin = computed(() => {
    if (this.cajeroActivo() && this.cajeroActivo()?.rol !== 'SUPERADMIN') {
      return false;
    }
    return (this.perfilUsuarioSignal()?.rol || this.rol()) === 'SUPERADMIN';
  });

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
    const cajero = this.cajeroActivo();
    if (cajero && cajero.nombre) return cajero.nombre;
    const p = this.perfilUsuarioSignal();
    if (p && p.nombre) return p.nombre;
    const u = this.currentUserSignal();
    if (u && u.email) return u.email.split('@')[0];
    return 'Usuario';
  });

  public nombreOperadorActual = computed(() => this.nombreUsuario());

  public rolOperadorActual = computed(() => this.rol());

  // ── Modo Soporte / Suplantación para SuperAdministrador ───────
  private impersonatedEmpresaIdSignal = signal<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem('pos_impersonated_tenant_id') : null
  );
  private impersonatedEmpresaNombreSignal = signal<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem('pos_impersonated_tenant_nombre') : null
  );

  public estaEnModoSoporte = computed(() => !!this.impersonatedEmpresaIdSignal());
  public nombreEmpresaSoporte = computed(() => this.impersonatedEmpresaNombreSignal() || 'Empresa');
  public idEmpresaSoporte = computed(() => this.impersonatedEmpresaIdSignal() || '');

  // ── Control de Visibilidad de Módulos Operativos para SuperAdministrador ───
  public superAdminModoPos = signal<boolean>(
    typeof localStorage !== 'undefined' ? localStorage.getItem('pos_superadmin_modo_pos') === 'true' : false
  );

  public mostrarModulosOperativos = computed(() => {
    // Si NO es SuperAdmin, siempre ve sus módulos operativos de tienda
    if (!this.esSuperAdmin()) return true;
    // Si está inspeccionando una empresa en Modo Soporte, ve los módulos POS
    if (this.estaEnModoSoporte()) return true;
    // Si es SuperAdmin en su cuenta maestra, solo los ve si los habilitó explícitamente
    return this.superAdminModoPos();
  });

  public toggleSuperAdminModoPos(): void {
    const nuevo = !this.superAdminModoPos();
    this.superAdminModoPos.set(nuevo);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pos_superadmin_modo_pos', nuevo ? 'true' : 'false');
    }
  }

  private authReadyPromise: Promise<User | null>;
  private subPerfilLive?: import('rxjs').Subscription;
  private readonly STORAGE_SESSION_TOKEN = 'pos_session_token';

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
          this.iniciarEscuchadorPerfilLive(user.uid);
        } else {
          this.detenerEscuchadorPerfilLive();
          this.perfilUsuarioSignal.set(null);
        }
        resolve(user);
      });
    });
  }

  async waitForAuthReady(): Promise<User | null> {
    return this.authReadyPromise;
  }

  private readonly STORAGE_DEVICE_ID = 'pos_device_id';

  public generarTokenSesion(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
  }

  public obtenerOcrearDeviceId(): string {
    if (typeof localStorage === 'undefined') return 'unknown_device';
    let id = localStorage.getItem(this.STORAGE_DEVICE_ID);
    if (!id) {
      id = 'dev_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10)));
      localStorage.setItem(this.STORAGE_DEVICE_ID, id);
    }
    return id;
  }

  public obtenerNombreDispositivo(): string {
    if (typeof navigator === 'undefined') return 'Equipo';
    const ua = navigator.userAgent;
    let so = 'PC';
    if (/Windows/i.test(ua)) so = 'Windows';
    else if (/Macintosh|Mac OS/i.test(ua)) so = 'Mac';
    else if (/Linux/i.test(ua)) so = 'Linux';
    else if (/Android/i.test(ua)) so = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) so = 'iOS';

    let nav = 'Navegador';
    if (/Edg\//i.test(ua)) nav = 'Edge';
    else if (/Chrome\//i.test(ua)) nav = 'Chrome';
    else if (/Firefox\//i.test(ua)) nav = 'Firefox';
    else if (/Safari\//i.test(ua)) nav = 'Safari';

    return `${so} (${nav})`;
  }

  /**
   * Inicia escucha reactiva en tiempo real sobre el documento del usuario en Firestore
   */
  private iniciarEscuchadorPerfilLive(uid: string): void {
    this.detenerEscuchadorPerfilLive();

    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);

    this.subPerfilLive = docStream$(userDocRef).subscribe({
      next: async (snap) => {
        if (snap.exists()) {
          const nuevoPerfil = snap.data() as UsuarioSistema;
          this.perfilUsuarioSignal.set(nuevoPerfil);
          localStorage.setItem('pos_tenant_id', nuevoPerfil.empresaId);
          localStorage.setItem('pos_user_role', nuevoPerfil.rol);

          // Si el usuario fue desactivado por el Administrador, expulsarlo y cerrar sesión de inmediato
          if (nuevoPerfil.activo === false) {
            this.detenerEscuchadorPerfilLive();
            alert('⚠️ Tu cuenta ha sido desactivada por el administrador. La sesión se cerrará de inmediato.');
            await this.logout(false);
            return;
          }

          const esAdminONegocio = nuevoPerfil.rol === 'ADMIN' || nuevoPerfil.rol === 'SUPERADMIN' || nuevoPerfil.uid === nuevoPerfil.empresaId;
          const tokenLocal = localStorage.getItem(this.STORAGE_SESSION_TOKEN);

          if (!esAdminONegocio) {
            // Control de Dispositivo Autorizado en tiempo real
            if (!nuevoPerfil.permitirCualquierDispositivo && nuevoPerfil.dispositivoAutorizadoId) {
              const devId = this.obtenerOcrearDeviceId();
              if (nuevoPerfil.dispositivoAutorizadoId !== devId) {
                this.detenerEscuchadorPerfilLive();
                alert(`🚫 Dispositivo no autorizado: Esta cuenta de cobro está vinculada a otro equipo.`);
                await this.logout(false);
                return;
              }
            }

            // Control de Sesión Única
            // Caso 1: Se inició sesión en otro equipo (el token de Firestore cambió a uno diferente)
            if (tokenLocal && nuevoPerfil.sesionActivaId && nuevoPerfil.sesionActivaId !== tokenLocal) {
              this.detenerEscuchadorPerfilLive();
              alert('⚠️ Se ha iniciado sesión con esta cuenta en otro equipo o navegador. Tu sesión en este dispositivo ha sido cerrada.');
              await this.logout(false);
              return;
            }

            // Caso 2: Un administrador forzó el cierre de la sesión remota (sesionActivaId = null)
            if (tokenLocal && nuevoPerfil.sesionActivaId === null) {
              this.detenerEscuchadorPerfilLive();
              alert('⚠️ Tu sesión ha sido finalizada remotamente por un administrador.');
              await this.logout(false);
              return;
            }
          }
        } else {
          // Si el documento del usuario fue eliminado de la empresa
          this.detenerEscuchadorPerfilLive();
          alert('⚠️ Tu usuario ya no tiene acceso a esta empresa.');
          await this.logout(false);
        }
      },
      error: (e) => console.warn('Error escuchando perfil de usuario en vivo:', e)
    });
  }

  private detenerEscuchadorPerfilLive(): void {
    if (this.subPerfilLive) {
      this.subPerfilLive.unsubscribe();
      this.subPerfilLive = undefined;
    }
  }

  /**
   * Carga o auto-crea el perfil del usuario en Firestore (usuarios/{uid}).
   * Garantiza retrocompatibilidad total con la cuenta principal existente.
   */
  async cargarPerfilUsuario(user: User): Promise<UsuarioSistema> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', user.uid);
    let snap = await getDoc(userDocRef);

    let perfil: UsuarioSistema;
    let tokenLocal = localStorage.getItem(this.STORAGE_SESSION_TOKEN);

    if (snap.exists()) {
      perfil = snap.data() as UsuarioSistema;
      const esAdminONegocio = perfil.rol === 'ADMIN' || perfil.rol === 'SUPERADMIN' || perfil.uid === perfil.empresaId;

      // Validación de Dispositivo para Cajas y Colaboradores
      if (!esAdminONegocio && !perfil.permitirCualquierDispositivo && perfil.dispositivoAutorizadoId) {
        const deviceId = this.obtenerOcrearDeviceId();
        if (perfil.dispositivoAutorizadoId !== deviceId) {
          await this.logout(false);
          const equipoNom = perfil.dispositivoAutorizadoNombre || 'el equipo físico autorizado';
          throw new Error(`🚫 Acceso Denegado: Esta cuenta ("${perfil.nombre}") solo puede utilizarse en ${equipoNom}.`);
        }
      }

      // Si este cliente local no tenía token de sesión registrado
      if (!tokenLocal) {
        tokenLocal = this.generarTokenSesion();
        localStorage.setItem(this.STORAGE_SESSION_TOKEN, tokenLocal);
        if (!esAdminONegocio) {
          perfil.sesionActivaId = tokenLocal;
          perfil.dispositivoActual = this.obtenerNombreDispositivo();
          const updateData: any = {
            sesionActivaId: tokenLocal,
            dispositivoActual: perfil.dispositivoActual,
            ultimoAcceso: new Date().toISOString()
          };
          if (!perfil.permitirCualquierDispositivo && !perfil.dispositivoAutorizadoId) {
            perfil.dispositivoAutorizadoId = this.obtenerOcrearDeviceId();
            perfil.dispositivoAutorizadoNombre = perfil.dispositivoActual;
            perfil.fechaVinculacionDispositivo = new Date().toISOString();
            updateData.dispositivoAutorizadoId = perfil.dispositivoAutorizadoId;
            updateData.dispositivoAutorizadoNombre = perfil.dispositivoAutorizadoNombre;
            updateData.fechaVinculacionDispositivo = perfil.fechaVinculacionDispositivo;
          }
          try {
            await updateDoc(userDocRef, updateData);
          } catch (_) { }
        }
      }
    } else {
      tokenLocal = this.generarTokenSesion();
      localStorage.setItem(this.STORAGE_SESSION_TOKEN, tokenLocal);

      // Auto-crear como Dueño / ADMIN con su propio UID como empresaId inicial
      perfil = {
        uid: user.uid,
        email: user.email || '',
        nombre: user.displayName || user.email?.split('@')[0] || 'Administrador',
        empresaId: user.uid,
        rol: 'ADMIN',
        activo: true,
        fechaCreacion: new Date().toISOString(),
        ultimoAcceso: new Date().toISOString(),
        sesionActivaId: tokenLocal,
        dispositivoActual: this.obtenerNombreDispositivo(),
        permitirCualquierDispositivo: true
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

    const userDocRef = doc(this.fb.firestore, 'usuarios', cred.user.uid);
    const snap = await getDoc(userDocRef);
    const dataExistente = snap.exists() ? (snap.data() as UsuarioSistema) : null;
    const esAdminONegocio = !dataExistente || dataExistente.rol === 'ADMIN' || dataExistente.rol === 'SUPERADMIN' || dataExistente.uid === dataExistente.empresaId;

    if (!esAdminONegocio && dataExistente) {
      if (!dataExistente.activo) {
        await signOut(this.fb.auth);
        throw new Error('Esta cuenta de usuario ha sido desactivada por el administrador.');
      }

      // Validación de Dispositivo Autorizado para Cajas y Colaboradores
      if (!dataExistente.permitirCualquierDispositivo) {
        const deviceId = this.obtenerOcrearDeviceId();
        if (dataExistente.dispositivoAutorizadoId) {
          if (dataExistente.dispositivoAutorizadoId !== deviceId) {
            await signOut(this.fb.auth);
            localStorage.removeItem(this.STORAGE_SESSION_TOKEN);
            const equipoNom = dataExistente.dispositivoAutorizadoNombre || 'el equipo físico autorizado';
            throw new Error(`🚫 Acceso Denegado: Esta cuenta ("${dataExistente.nombre}") solo puede utilizarse en ${equipoNom}. Para autorizar este equipo, contacta al Administrador.`);
          }
        }
      }
    }

    this.currentUserSignal.set(cred.user);

    const tokenSesion = this.generarTokenSesion();
    localStorage.setItem(this.STORAGE_SESSION_TOKEN, tokenSesion);

    const updatePayload: any = {
      dispositivoActual: this.obtenerNombreDispositivo(),
      ultimoAcceso: new Date().toISOString()
    };
    if (!esAdminONegocio) {
      updatePayload.sesionActivaId = tokenSesion;
      // Si la caja no tenía equipo vinculado previamente, se vincula automáticamente en este primer inicio
      if (dataExistente && !dataExistente.permitirCualquierDispositivo && !dataExistente.dispositivoAutorizadoId) {
        updatePayload.dispositivoAutorizadoId = this.obtenerOcrearDeviceId();
        updatePayload.dispositivoAutorizadoNombre = this.obtenerNombreDispositivo();
        updatePayload.fechaVinculacionDispositivo = new Date().toISOString();
      }
    }

    try {
      await updateDoc(userDocRef, updatePayload);
    } catch (_) { }

    const perfil = await this.cargarPerfilUsuario(cred.user);
    return cred.user;
  }

  async register(email: string, pass: string, nombreNegocio = 'Mi Negocio'): Promise<User> {
    const tokenSesion = this.generarTokenSesion();
    localStorage.setItem(this.STORAGE_SESSION_TOKEN, tokenSesion);

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
      fechaCreacion: new Date().toISOString(),
      sesionActivaId: tokenSesion,
      dispositivoActual: this.obtenerNombreDispositivo(),
      ultimoAcceso: new Date().toISOString()
    };

    const userDocRef = doc(this.fb.firestore, 'usuarios', cred.user.uid);
    await setDoc(userDocRef, perfil);
    this.perfilUsuarioSignal.set(perfil);
    localStorage.setItem('pos_tenant_id', perfil.empresaId);
    localStorage.setItem('pos_user_role', perfil.rol);

    await this.suscripcionService.inicializarSuscripcion(perfil.empresaId, email, nombreNegocio);
    this.suscripcionService.iniciarEscuchadorLive(perfil.empresaId);

    // Enviar correo de verificación en modo estricto
    try {
      await sendEmailVerification(cred.user);
    } catch (e) {
      console.warn('Error al enviar correo de verificación inicial:', e);
    }

    return cred.user;
  }

  /**
   * Reenvía el correo de verificación al usuario actualmente autenticado
   */
  async enviarCorreoVerificacion(): Promise<void> {
    const user = this.fb.auth.currentUser;
    if (!user) throw new Error('No hay una sesión activa de usuario.');
    await sendEmailVerification(user);
  }

  /**
   * Refresca el estado de la cuenta desde Firebase para detectar si ya verificó el correo
   */
  async refrescarEstadoUsuario(): Promise<boolean> {
    const user = this.fb.auth.currentUser;
    if (!user) return false;
    await user.reload();
    this.currentUserSignal.set(user);
    return user.emailVerified;
  }

  async logout(limpiarRemoto: boolean = true): Promise<void> {
    const tokenLocal = localStorage.getItem(this.STORAGE_SESSION_TOKEN);
    const perfil = this.perfilUsuarioSignal();
    const user = this.fb.auth.currentUser;

    this.detenerEscuchadorPerfilLive();

    // Solo si esta máquina es la dueña de la sesión actual en Firestore, la marcamos como cerrada
    if (limpiarRemoto && user && perfil && perfil.sesionActivaId && tokenLocal && perfil.sesionActivaId === tokenLocal) {
      try {
        const userDocRef = doc(this.fb.firestore, 'usuarios', user.uid);
        await updateDoc(userDocRef, {
          sesionActivaId: null
        });
      } catch (e) {
        console.warn('Error al limpiar sesión en Firestore:', e);
      }
    }

    localStorage.removeItem(this.STORAGE_SESSION_TOKEN);
    localStorage.removeItem('pos_tenant_id');
    localStorage.removeItem('pos_user_role');
    localStorage.removeItem('pos_impersonated_tenant_id');
    localStorage.removeItem('pos_impersonated_tenant_nombre');
    localStorage.removeItem('pos_terminal_bloqueada');
    localStorage.removeItem('pos_terminal_cajero_activo');
    this.terminalBloqueada.set(false);
    this.cajeroActivo.set(null);
    this.impersonatedEmpresaIdSignal.set(null);
    this.impersonatedEmpresaNombreSignal.set(null);
    this.currentUserSignal.set(null);
    this.perfilUsuarioSignal.set(null);
    await signOut(this.fb.auth);
    this.router.navigate(['/login']);
  }

  async forzarCierreSesionRemoto(uid: string): Promise<void> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await updateDoc(userDocRef, {
      sesionActivaId: null
    });
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

  /**
   * Activa el Modo Soporte / Visualización como Empresa para el SuperAdministrador
   */
  public entrarModoSoporte(empresaId: string, nombreNegocio: string): void {
    if (!this.esSuperAdmin()) {
      alert('Solo el SuperAdministrador puede activar el modo soporte.');
      return;
    }
    this.impersonatedEmpresaIdSignal.set(empresaId);
    this.impersonatedEmpresaNombreSignal.set(nombreNegocio);
    localStorage.setItem('pos_impersonated_tenant_id', empresaId);
    localStorage.setItem('pos_impersonated_tenant_nombre', nombreNegocio);
    // Reiniciar al Dashboard para que todos los servicios sincronicen los datos de la empresa seleccionada
    window.location.href = '/dashboard';
  }

  /**
   * Sale del Modo Soporte y regresa al panel Master SaaS
   */
  public salirModoSoporte(): void {
    this.impersonatedEmpresaIdSignal.set(null);
    this.impersonatedEmpresaNombreSignal.set(null);
    localStorage.removeItem('pos_impersonated_tenant_id');
    localStorage.removeItem('pos_impersonated_tenant_nombre');
    window.location.href = '/super-admin';
  }

  getTenantId(): string {
    const imp = this.impersonatedEmpresaIdSignal();
    if (imp) return imp;
    if (typeof localStorage !== 'undefined') {
      const cachedImp = localStorage.getItem('pos_impersonated_tenant_id');
      if (cachedImp) return cachedImp;
    }

    const perfil = this.perfilUsuarioSignal();
    if (perfil && perfil.empresaId) return perfil.empresaId;
    const user = this.fb.auth.currentUser;
    if (user && user.uid) return user.uid;
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('pos_tenant_id') : null;
    if (cached) return cached;
    return 'main';
  }

  // ── Gestión de Colaboradores (Centro de Administración) ───────
  streamUsuariosEmpresa$(): Observable<UsuarioSistema[]> {
    const empresaId = this.getTenantId();
    const q = query(
      collection(this.fb.firestore, 'usuarios'),
      where('empresaId', '==', empresaId)
    );
    return collectionStream$(q).pipe(
      map((snap) => {
        const list: UsuarioSistema[] = [];
        snap.forEach((d) => list.push(d.data() as UsuarioSistema));
        return list;
      })
    );
  }

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

  async actualizarColaborador(
    uid: string,
    nombre: string,
    rol?: RolUsuario,
    sucursalId?: string,
    sucursalNombre?: string,
    pin?: string,
    claveAcceso?: string
  ): Promise<void> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    const dataUpdate: Partial<UsuarioSistema> = {
      nombre: nombre.trim()
    };
    if (rol) dataUpdate.rol = rol;
    if (sucursalId !== undefined) dataUpdate.sucursalId = sucursalId;
    if (sucursalNombre !== undefined) dataUpdate.sucursalNombre = sucursalNombre;
    if (pin !== undefined) dataUpdate.pin = pin.trim();
    if (claveAcceso !== undefined) dataUpdate.claveAcceso = claveAcceso.trim();

    await updateDoc(userDocRef, dataUpdate as any);

    const perfil = this.perfilUsuarioSignal();
    if (perfil && perfil.uid === uid) {
      this.perfilUsuarioSignal.set({
        ...perfil,
        ...dataUpdate
      });
    }

    const cajero = this.cajeroActivo();
    if (cajero && cajero.uid === uid) {
      this.cajeroActivo.set({
        ...cajero,
        ...dataUpdate
      });
    }
  }

  async desvincularDispositivoUsuario(uid: string): Promise<void> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await updateDoc(userDocRef, {
      dispositivoAutorizadoId: null,
      dispositivoAutorizadoNombre: null,
      fechaVinculacionDispositivo: null
    });
  }

  async vincularDispositivoUsuario(uid: string, deviceId: string, deviceNombre: string): Promise<void> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await updateDoc(userDocRef, {
      dispositivoAutorizadoId: deviceId,
      dispositivoAutorizadoNombre: deviceNombre,
      fechaVinculacionDispositivo: new Date().toISOString(),
      permitirCualquierDispositivo: false
    });
  }

  async togglePermisoCualquierDispositivo(uid: string, permitir: boolean): Promise<void> {
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await updateDoc(userDocRef, {
      permitirCualquierDispositivo: permitir
    });
  }

  /**
   * Crea un colaborador con cuenta real de autenticación en Firebase para que pueda iniciar sesión
   * directamente en su propia computadora de cobro con su correo y contraseña/PIN.
   */
  async crearColaboradorTerminal(
    nombre: string,
    rol: RolUsuario,
    sucursalId: string,
    sucursalNombre: string,
    pin: string,
    emailCustom?: string,
    passwordCustom?: string
  ): Promise<UsuarioSistema> {
    const empresaId = this.getTenantId();
    if (!empresaId) throw new Error('No se encontró el identificador del negocio.');

    const cleanNombre = nombre.trim();
    if (!cleanNombre) throw new Error('El nombre del colaborador es obligatorio.');
    if (!pin || pin.trim().length < 4) throw new Error('El PIN debe tener al menos 4 dígitos.');

    // Verificar si ya existe otro colaborador con el mismo PIN en la empresa
    const usuarios = await this.listarUsuariosEmpresa();
    const pinExiste = usuarios.some((u) => u.pin && u.pin.trim() === pin.trim());
    if (pinExiste) {
      throw new Error(`El PIN "${pin}" ya está en uso por otro colaborador de este negocio. Elige uno diferente.`);
    }

    // Generar correo de acceso si no se especificó uno
    const slug = cleanNombre.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanEmpresa = empresaId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const emailFinal = (emailCustom && emailCustom.trim())
      ? emailCustom.trim().toLowerCase()
      : `${slug || 'caja'}_${Math.floor(1000 + Math.random() * 9000)}@${cleanEmpresa || 'pos'}.com`;

    // Contraseña para Firebase Auth (mínimo 6 caracteres). Si el PIN tiene 6 dígitos es idéntico; si tiene 4-5 se paddea
    const passwordFinal = (passwordCustom && passwordCustom.trim().length >= 6)
      ? passwordCustom.trim()
      : (pin.trim().length >= 6 ? pin.trim() : `${pin.trim().padEnd(6, '0')}`);

    // Registrar en Firebase Auth usando SecondaryAuthApp para no alterar la sesión del Admin en esta máquina
    const { initializeApp, getApps } = await import('firebase/app');
    const { getAuth, createUserWithEmailAndPassword, signOut } = await import('firebase/auth');
    const { doc, setDoc } = await import('firebase/firestore');
    const { environment } = await import('../../../environments/environment');

    const secondaryAppName = 'SecondaryAuthApp';
    let secondaryApp = getApps().find(app => app.name === secondaryAppName);
    if (!secondaryApp) {
      secondaryApp = initializeApp(environment.firebase, secondaryAppName);
    }
    const secondaryAuth = getAuth(secondaryApp);

    let uid: string;
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, emailFinal, passwordFinal);
      uid = cred.user.uid;
      await signOut(secondaryAuth);
    } catch (authErr: any) {
      await signOut(secondaryAuth);
      if (authErr.code === 'auth/email-already-in-use') {
        throw new Error(`El correo "${emailFinal}" ya está en uso. Elige otro correo o alias.`);
      }
      throw new Error(`Error de autenticación: ${authErr.message || authErr}`);
    }

    const nuevoUsuario: UsuarioSistema = {
      uid,
      nombre: cleanNombre,
      email: emailFinal,
      claveAcceso: passwordFinal,
      empresaId,
      rol,
      sucursalId: sucursalId || 'SUC-MAIN',
      sucursalNombre: sucursalNombre || 'Matriz Principal',
      activo: true,
      pin: pin.trim(),
      creadoPorAdmin: true,
      fechaCreacion: new Date().toISOString()
    };

    const newDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await setDoc(newDocRef, nuevoUsuario);
    return nuevoUsuario;
  }

  /**
   * Valida un PIN de 4 a 6 dígitos y desbloquea la terminal con el operador activo
   */
  async desbloquearConPin(pin: string): Promise<{ success: boolean; usuario?: UsuarioSistema; error?: string }> {
    const cleanPin = pin.trim();
    if (!cleanPin) {
      return { success: false, error: 'Ingresa un PIN válido.' };
    }

    try {
      const usuarios = await this.listarUsuariosEmpresa();
      const match = usuarios.find(
        (u) => u.activo !== false && u.pin && u.pin.trim() === cleanPin
      );

      if (match) {
        this.cajeroActivo.set(match);
        this.terminalBloqueada.set(false);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('pos_terminal_bloqueada', 'false');
          localStorage.setItem('pos_terminal_cajero_activo', JSON.stringify(match));
        }
        return { success: true, usuario: match };
      }

      // Validar si el perfil del usuario maestro tiene este PIN
      const miPerfil = this.perfilUsuarioSignal();
      if (miPerfil && miPerfil.pin && miPerfil.pin.trim() === cleanPin) {
        this.cajeroActivo.set(miPerfil);
        this.terminalBloqueada.set(false);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('pos_terminal_bloqueada', 'false');
          localStorage.setItem('pos_terminal_cajero_activo', JSON.stringify(miPerfil));
        }
        return { success: true, usuario: miPerfil };
      }

      return { success: false, error: 'PIN no reconocido o colaborador inactivo.' };
    } catch (e: any) {
      console.error('Error al validar PIN:', e);
      return { success: false, error: e.message || 'Error al validar el PIN.' };
    }
  }

  /**
   * Bloquea la terminal y solicita el PIN del próximo cajero
   */
  bloquearTerminal(): void {
    this.terminalBloqueada.set(true);
    this.cajeroActivo.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pos_terminal_bloqueada', 'true');
      localStorage.removeItem('pos_terminal_cajero_activo');
    }
  }

  /**
   * Desbloquea la terminal directamente para el administrador de la cuenta
   */
  desbloquearComoAdmin(): void {
    this.terminalBloqueada.set(false);
    this.cajeroActivo.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pos_terminal_bloqueada', 'false');
      localStorage.removeItem('pos_terminal_cajero_activo');
    }
  }

  async eliminarUsuarioEmpresa(uid: string): Promise<void> {
    const { deleteDoc } = await import('firebase/firestore');
    const userDocRef = doc(this.fb.firestore, 'usuarios', uid);
    await deleteDoc(userDocRef);
  }
}

