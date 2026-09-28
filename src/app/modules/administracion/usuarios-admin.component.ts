import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { UsuarioSistema, RolUsuario } from '../../core/models/models';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-usuarios-admin',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './usuarios-admin.component.html',
  styleUrl: './usuarios-admin.component.scss'
})
export class UsuariosAdminComponent implements OnInit, OnDestroy {
  public authService = inject(AuthService);
  public suscripcionService = inject(SuscripcionService);
  public sucursalesService = inject(SucursalesService);

  public usuarios = signal<UsuarioSistema[]>([]);
  public cargando = signal<boolean>(false);
  private subUsuarios?: Subscription;

  // Modal Nuevo Colaborador / Caja
  public modalAbierto = signal<boolean>(false);
  public emailNuevo = '';
  public passNuevo = '';
  public nombreNuevo = '';
  public rolNuevo: RolUsuario = 'CAJERO';
  public sucursalIdNuevo = 'SUC-MAIN';

  public errorModal = signal<string>('');
  public guardando = signal<boolean>(false);

  // Ficha de credenciales creadas para mostrar al Administrador
  public credencialesCreadas = signal<{
    nombre: string;
    email: string;
    clave: string;
    rol: RolUsuario;
  } | null>(null);

  // Modal Editar Colaborador / Usuario
  public modalEditarAbierto = signal<boolean>(false);
  public usuarioAEditar = signal<UsuarioSistema | null>(null);
  public nombreEdit = '';
  public passEdit = '';
  public rolEdit: RolUsuario = 'CAJERO';
  public sucursalIdEdit = 'SUC-MAIN';
  public guardandoEdit = signal<boolean>(false);
  public errorModalEdit = signal<string>('');
  public permitirCualquierDispositivoEdit = false;

  // Visibilidad de contraseñas en la tabla
  public passVisibleMap: { [uid: string]: boolean } = {};

  // Renovación de Suscripción en el panel
  public codigoRenovacion = '';
  public renovando = signal<boolean>(false);
  public msgRenovacion = signal<string>('');

  ngOnInit(): void {
    this.iniciarEscuchaUsuarios();
  }

  ngOnDestroy(): void {
    if (this.subUsuarios) {
      this.subUsuarios.unsubscribe();
    }
  }

  iniciarEscuchaUsuarios(): void {
    this.cargando.set(true);
    this.subUsuarios = this.authService.streamUsuariosEmpresa$().subscribe({
      next: (list) => {
        this.usuarios.set(list);
        this.cargando.set(false);
      },
      error: (e) => {
        console.error('Error al escuchar colaboradores en tiempo real:', e);
        this.cargando.set(false);
      }
    });
  }

  generarPasswordAleatorio(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  regenerarPasswordNuevo(): void {
    this.passNuevo = this.generarPasswordAleatorio();
  }

  actualizarEmailSugerido(): void {
    const cleanNombre = this.nombreNuevo.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const tenant = (this.authService.getTenantId() || 'pos').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    this.emailNuevo = `${cleanNombre || 'caja'}@${tenant || 'mitienda'}.pos`;
  }

  togglePassVisible(uid: string): void {
    this.passVisibleMap[uid] = !this.passVisibleMap[uid];
  }

  copiarTexto(texto: string, etiqueta = 'Dato'): void {
    if (!texto) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(() => {
        alert(`📋 ${etiqueta} copiado al portapapeles: "${texto}"`);
      }).catch(() => {
        this.fallbackCopiar(texto, etiqueta);
      });
    } else {
      this.fallbackCopiar(texto, etiqueta);
    }
  }

  private fallbackCopiar(texto: string, etiqueta = 'Dato'): void {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = texto;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert(`📋 ${etiqueta} copiado al portapapeles:\n\n${texto}`);
    } catch (_) {
      prompt(`Copia manualmente:`, texto);
    }
  }

  copiarFichaAcceso(u: Partial<UsuarioSistema>): void {
    const clave = u.claveAcceso || '••••••';
    const texto = `🖥️ Terminal / Caja: ${u.nombre}\n✉️ Correo de Acceso: ${u.email}\n🔑 Contraseña: ${clave}\n🏪 Sucursal: ${u.sucursalNombre || 'Matriz'}\n🛡️ Rol: ${u.rol}`;
    this.copiarTexto(texto, 'Ficha de acceso');
  }

  copiarFichaCredenciales(): void {
    const cred = this.credencialesCreadas();
    if (!cred) return;
    const texto = `🖥️ Terminal / Caja: ${cred.nombre}\n✉️ Correo de Acceso: ${cred.email}\n🔑 Contraseña: ${cred.clave}\n🛡️ Rol: ${cred.rol}`;
    this.copiarTexto(texto, 'Ficha de acceso');
  }

  abrirModalNuevo(): void {
    const validacion = this.suscripcionService.puedeCrearUsuario(this.usuarios().length);
    if (!validacion.permitido) {
      alert(`⚠️ ${validacion.mensaje}`);
      return;
    }

    this.nombreNuevo = '';
    this.passNuevo = this.generarPasswordAleatorio();
    this.emailNuevo = '';
    this.rolNuevo = 'CAJERO';
    this.sucursalIdNuevo = this.sucursalesService.sucursales()[0]?.id || 'SUC-MAIN';
    this.actualizarEmailSugerido();
    this.errorModal.set('');
    this.modalAbierto.set(true);
  }

  async crearColaborador(): Promise<void> {
    const validacion = this.suscripcionService.puedeCrearUsuario(this.usuarios().length);
    if (!validacion.permitido) {
      this.errorModal.set(validacion.mensaje || 'Límite alcanzado.');
      return;
    }

    if (!this.nombreNuevo.trim()) {
      this.errorModal.set('El nombre del colaborador o caja es obligatorio.');
      return;
    }

    if (!this.passNuevo || this.passNuevo.trim().length < 6) {
      this.errorModal.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (!this.emailNuevo.trim()) {
      this.actualizarEmailSugerido();
    }

    this.guardando.set(true);
    this.errorModal.set('');

    const sucursalNom = this.sucursalesService.sucursales().find(s => s.id === this.sucursalIdNuevo)?.nombre || 'Matriz';
    const emailFinal = this.emailNuevo.trim();
    const passFinal = this.passNuevo.trim();

    try {
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
        const cred = await createUserWithEmailAndPassword(secondaryAuth, emailFinal, passFinal);
        uid = cred.user.uid;
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          throw new Error(`El correo "${emailFinal}" ya está en uso. Por favor modifícalo.`);
        }
        throw new Error(authErr.message || 'Error al crear credenciales de acceso.');
      } finally {
        await signOut(secondaryAuth);
      }

      const nuevoPerfil: UsuarioSistema = {
        uid,
        email: emailFinal,
        claveAcceso: passFinal,
        nombre: this.nombreNuevo.trim(),
        empresaId: this.authService.getTenantId(),
        rol: this.rolNuevo,
        sucursalId: this.sucursalIdNuevo,
        sucursalNombre: sucursalNom,
        activo: true,
        creadoPorAdmin: true,
        fechaCreacion: new Date().toISOString()
      };

      const userDocRef = doc(this.authService.fb.firestore, 'usuarios', uid);
      await setDoc(userDocRef, nuevoPerfil);

      this.credencialesCreadas.set({
        nombre: nuevoPerfil.nombre,
        email: nuevoPerfil.email,
        clave: passFinal,
        rol: nuevoPerfil.rol
      });

      this.modalAbierto.set(false);
    } catch (e: any) {
      this.errorModal.set(e.message || 'Error al crear usuario.');
    } finally {
      this.guardando.set(false);
    }
  }

  cerrarModalNuevo(): void {
    this.modalAbierto.set(false);
  }

  cerrarModalCredenciales(): void {
    this.credencialesCreadas.set(null);
  }

  regenerarPasswordEdit(): void {
    this.passEdit = this.generarPasswordAleatorio();
  }

  async toggleActivo(u: UsuarioSistema): Promise<void> {
    if (u.uid === this.authService.currentUser()?.uid) {
      alert('No puedes desactivar tu propia cuenta de Administrador.');
      return;
    }

    const nuevoEstado = !u.activo;
    const confirmMsg = nuevoEstado ? `¿Activar a ${u.nombre}?` : `¿Desactivar acceso a ${u.nombre}?`;
    if (confirm(confirmMsg)) {
      await this.authService.actualizarEstadoUsuario(u.uid, nuevoEstado);
    }
  }

  async cambiarRol(u: UsuarioSistema, event: Event): Promise<void> {
    const target = event.target as HTMLSelectElement;
    const nuevoRol = target.value as RolUsuario;
    if (u.uid === this.authService.currentUser()?.uid && nuevoRol !== 'ADMIN') {
      alert('No puedes quitarte el rol de Administrador principal.');
      return;
    }
    await this.authService.actualizarRolUsuario(u.uid, nuevoRol, u.sucursalId, u.sucursalNombre);
  }

  async eliminarColaborador(u: UsuarioSistema): Promise<void> {
    if (u.uid === this.authService.currentUser()?.uid) {
      alert('No puedes eliminar tu propia cuenta de Administrador principal.');
      return;
    }

    if (confirm(`⚠️ ¿Estás seguro de eliminar a "${u.nombre}" (${u.email})? Esta acción revocará su acceso de forma permanente.`)) {
      try {
        await this.authService.eliminarUsuarioEmpresa(u.uid);
      } catch (err: any) {
        alert('❌ Error al eliminar colaborador: ' + (err.message || err));
      }
    }
  }

  async forzarCierreSesion(u: UsuarioSistema): Promise<void> {
    if (confirm(`¿Deseas cerrar la sesión activa del usuario "${u.nombre}" de forma remota? Su equipo se desconectará de inmediato.`)) {
      try {
        await this.authService.forzarCierreSesionRemoto(u.uid);
      } catch (err: any) {
        alert('❌ Error al forzar cierre de sesión: ' + (err.message || err));
      }
    }
  }

  async desvincularEquipo(u: UsuarioSistema): Promise<void> {
    const confirmMsg = `¿Deseas desvincular el equipo de "${u.nombre}"?\n\nAl desvincularlo, la próxima computadora donde inicie sesión quedará registrada automáticamente como su equipo autorizado.`;
    if (confirm(confirmMsg)) {
      try {
        await this.authService.desvincularDispositivoUsuario(u.uid);
        alert(`✅ Equipo desvinculado con éxito para "${u.nombre}".`);
      } catch (err: any) {
        alert('❌ Error al desvincular equipo: ' + (err.message || err));
      }
    }
  }

  async vincularEstaComputadora(u: UsuarioSistema): Promise<void> {
    const devId = this.authService.obtenerOcrearDeviceId();
    const devNom = this.authService.obtenerNombreDispositivo();
    const confirmMsg = `¿Deseas vincular esta computadora actual (${devNom}) a la cuenta "${u.nombre}"?\n\nA partir de ahora, esta cuenta solo podrá iniciar sesión en este equipo.`;
    if (confirm(confirmMsg)) {
      try {
        await this.authService.vincularDispositivoUsuario(u.uid, devId, devNom);
        alert(`✅ Esta computadora ha sido vinculada como equipo autorizado para "${u.nombre}".`);
      } catch (err: any) {
        alert('❌ Error al vincular equipo: ' + (err.message || err));
      }
    }
  }

  async togglePermitirCualquierDispositivo(u: UsuarioSistema): Promise<void> {
    const nuevoValor = !u.permitirCualquierDispositivo;
    const msg = nuevoValor
      ? `¿Permitir que "${u.nombre}" inicie sesión desde CUALQUIER equipo sin restricción física?`
      : `¿Restringir a "${u.nombre}" para que solo pueda iniciar sesión en su equipo autorizado?`;
    if (confirm(msg)) {
      try {
        await this.authService.togglePermisoCualquierDispositivo(u.uid, nuevoValor);
      } catch (err: any) {
        alert('❌ Error: ' + (err.message || err));
      }
    }
  }

  async aplicarCodigoSuscripcion(): Promise<void> {
    if (!this.codigoRenovacion.trim()) return;
    this.renovando.set(true);
    this.msgRenovacion.set('');
    try {
      await this.suscripcionService.activarConCodigo(this.authService.getTenantId(), this.codigoRenovacion);
      this.msgRenovacion.set('🎉 ¡Membresía renovada con éxito!');
      this.codigoRenovacion = '';
    } catch (e: any) {
      this.msgRenovacion.set('❌ ' + (e.message || 'Código inválido'));
    } finally {
      this.renovando.set(false);
    }
  }

  abrirModalEditar(u: UsuarioSistema): void {
    this.usuarioAEditar.set(u);
    this.nombreEdit = u.nombre || '';
    this.passEdit = u.claveAcceso || '';
    this.rolEdit = u.rol;
    this.sucursalIdEdit = u.sucursalId || (this.sucursalesService.sucursales()[0]?.id || 'SUC-MAIN');
    this.permitirCualquierDispositivoEdit = !!u.permitirCualquierDispositivo;
    this.errorModalEdit.set('');
    this.modalEditarAbierto.set(true);
  }

  cerrarModalEditar(): void {
    this.modalEditarAbierto.set(false);
    this.usuarioAEditar.set(null);
  }

  async guardarEdicionColaborador(): Promise<void> {
    const u = this.usuarioAEditar();
    if (!u) return;

    if (!this.nombreEdit.trim()) {
      this.errorModalEdit.set('El nombre del colaborador no puede estar vacío.');
      return;
    }

    if (this.passEdit && this.passEdit.trim().length > 0 && this.passEdit.trim().length < 6) {
      this.errorModalEdit.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    this.guardandoEdit.set(true);
    this.errorModalEdit.set('');

    try {
      const sucursalNom = this.sucursalesService.sucursales().find(s => s.id === this.sucursalIdEdit)?.nombre || 'Matriz';
      const esPropioUsuario = u.uid === this.authService.currentUser()?.uid;
      const rolAGuardar = esPropioUsuario ? u.rol : this.rolEdit;
      const passFinal = this.passEdit ? this.passEdit.trim() : undefined;

      // Si se definió una contraseña y es usuario de caja/colaborador, sincronizar con Firebase Auth
      if (passFinal && u.email && !esPropioUsuario) {
        try {
          const { initializeApp, getApps } = await import('firebase/app');
          const { getAuth, createUserWithEmailAndPassword, signOut } = await import('firebase/auth');
          const { environment } = await import('../../../environments/environment');
          const secondaryAppName = 'SecondaryAuthApp';
          let secondaryApp = getApps().find(app => app.name === secondaryAppName);
          if (!secondaryApp) {
            secondaryApp = initializeApp(environment.firebase, secondaryAppName);
          }
          const secondaryAuth = getAuth(secondaryApp);
          try {
            await createUserWithEmailAndPassword(secondaryAuth, u.email, passFinal);
          } catch (_) { }
          await signOut(secondaryAuth);
        } catch (_) { }
      }

      await this.authService.actualizarColaborador(
        u.uid,
        this.nombreEdit.trim(),
        rolAGuardar,
        this.sucursalIdEdit,
        sucursalNom,
        undefined,
        passFinal
      );

      if (!esPropioUsuario) {
        await this.authService.togglePermisoCualquierDispositivo(u.uid, this.permitirCualquierDispositivoEdit);
      }

      this.cerrarModalEditar();
    } catch (e: any) {
      this.errorModalEdit.set(e.message || 'Error al actualizar colaborador.');
    } finally {
      this.guardandoEdit.set(false);
    }
  }
}
