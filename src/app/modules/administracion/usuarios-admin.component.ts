import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { UsuarioSistema, RolUsuario } from '../../core/models/models';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-usuarios-admin',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './usuarios-admin.component.html',
  styleUrl: './usuarios-admin.component.scss'
})
export class UsuariosAdminComponent implements OnInit {
  public authService = inject(AuthService);
  public suscripcionService = inject(SuscripcionService);
  public sucursalesService = inject(SucursalesService);

  public usuarios = signal<UsuarioSistema[]>([]);
  public cargando = signal<boolean>(false);

  // Modal Nuevo Colaborador
  public modalAbierto = signal<boolean>(false);
  public emailNuevo = '';
  public passNuevo = '';
  public nombreNuevo = '';
  public rolNuevo: RolUsuario = 'CAJERO';
  public sucursalIdNuevo = 'SUC-MAIN';

  public errorModal = signal<string>('');
  public guardando = signal<boolean>(false);

  // Renovación de Suscripción en el panel
  public codigoRenovacion = '';
  public renovando = signal<boolean>(false);
  public msgRenovacion = signal<string>('');

  async ngOnInit(): Promise<void> {
    await this.cargarUsuarios();
  }

  async cargarUsuarios(): Promise<void> {
    this.cargando.set(true);
    try {
      const list = await this.authService.listarUsuariosEmpresa();
      this.usuarios.set(list);
    } catch (e) {
      console.error('Error al listar usuarios:', e);
    } finally {
      this.cargando.set(false);
    }
  }

  abrirModalNuevo(): void {
    const validacion = this.suscripcionService.puedeCrearUsuario(this.usuarios().length);
    if (!validacion.permitido) {
      alert(`⚠️ ${validacion.mensaje}`);
      return;
    }

    this.emailNuevo = '';
    this.passNuevo = '';
    this.nombreNuevo = '';
    this.rolNuevo = 'CAJERO';
    this.sucursalIdNuevo = this.sucursalesService.sucursales()[0]?.id || 'SUC-MAIN';
    this.errorModal.set('');
    this.modalAbierto.set(true);
  }

  async crearColaborador(): Promise<void> {
    const validacion = this.suscripcionService.puedeCrearUsuario(this.usuarios().length);
    if (!validacion.permitido) {
      this.errorModal.set(validacion.mensaje || 'Límite alcanzado.');
      return;
    }

    if (!this.emailNuevo || !this.passNuevo || !this.nombreNuevo) {
      this.errorModal.set('Completa todos los campos obligatorios.');
      return;
    }
    if (this.passNuevo.length < 6) {
      this.errorModal.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    this.guardando.set(true);
    this.errorModal.set('');

    try {
      // Registrar usuario con Firebase secundario o auth
      const { initializeApp, getApps } = await import('firebase/app');
      const { getAuth, createUserWithEmailAndPassword, signOut } = await import('firebase/auth');
      const { doc, setDoc } = await import('firebase/firestore');
      const { environment } = await import('../../../environments/environment');

      // Usar app secundaria de Firebase para no cerrar la sesión del Administrador actual
      const secondaryAppName = 'SecondaryAuthApp';
      let secondaryApp = getApps().find(app => app.name === secondaryAppName);
      if (!secondaryApp) {
        secondaryApp = initializeApp(environment.firebase, secondaryAppName);
      }
      const secondaryAuth = getAuth(secondaryApp);

      const cred = await createUserWithEmailAndPassword(secondaryAuth, this.emailNuevo, this.passNuevo);
      const nuevoUid = cred.user.uid;
      await signOut(secondaryAuth);

      const sucursalNom = this.sucursalesService.sucursales().find(s => s.id === this.sucursalIdNuevo)?.nombre || 'Matriz';

      // Crear documento del perfil vinculado a la MISMA empresa
      const nuevoPerfil: UsuarioSistema = {
        uid: nuevoUid,
        email: this.emailNuevo,
        nombre: this.nombreNuevo,
        empresaId: this.authService.getTenantId(),
        rol: this.rolNuevo,
        sucursalId: this.sucursalIdNuevo,
        sucursalNombre: sucursalNom,
        activo: true,
        fechaCreacion: new Date().toISOString()
      };

      const userDocRef = doc(this.authService.fb.firestore, 'usuarios', nuevoUid);
      await setDoc(userDocRef, nuevoPerfil);

      alert(`✅ Colaborador "${this.nombreNuevo}" creado exitosamente.`);
      this.modalAbierto.set(false);
      await this.cargarUsuarios();
    } catch (e: any) {
      this.errorModal.set(e.message || 'Error al crear usuario.');
    } finally {
      this.guardando.set(false);
    }
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
      await this.cargarUsuarios();
    }
  }

  async cambiarRol(u: UsuarioSistema, event: Event): Promise<void> {
    const target = event.target as HTMLSelectElement;
    const nuevoRol = target.value as RolUsuario;
    if (u.uid === this.authService.currentUser()?.uid && nuevoRol !== 'ADMIN') {
      alert('No puedes quitarte el rol de Administrador principal.');
      await this.cargarUsuarios();
      return;
    }
    await this.authService.actualizarRolUsuario(u.uid, nuevoRol, u.sucursalId, u.sucursalNombre);
    await this.cargarUsuarios();
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
}
