import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { FirebaseService } from '../services/firebase.service';

export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const fb = inject(FirebaseService);

  await authService.waitForAuthReady();
  const user = fb.auth.currentUser;

  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  // Los SuperAdmin de la plataforma tienen acceso directo
  if (authService.esSuperAdmin()) {
    return true;
  }

  const perfil = authService.perfilUsuario();

  // Validación de Dispositivo Autorizado para Cajas y Colaboradores
  if (perfil && perfil.rol !== 'ADMIN' && !perfil.permitirCualquierDispositivo && perfil.dispositivoAutorizadoId) {
    const devId = authService.obtenerOcrearDeviceId();
    if (perfil.dispositivoAutorizadoId !== devId) {
      alert(`🚫 Acceso Denegado: Esta computadora no está autorizada para la cuenta "${perfil.nombre}". Contacta al Administrador.`);
      await authService.logout(false);
      router.navigate(['/login']);
      return false;
    }
  }

  // Las cuentas de colaboradores y cajas creadas por el Administrador no requieren verificación externa
  const esCuentaColaborador = perfil && (perfil.creadoPorAdmin || perfil.rol === 'CAJERO' || perfil.rol === 'ENCARGADO');
  if (esCuentaColaborador) {
    return true;
  }

  // Modo Estricto: El correo debe estar verificado para acceder al sistema
  if (!user.emailVerified) {
    try {
      await user.reload();
    } catch (_) { }

    if (!user.emailVerified) {
      router.navigate(['/verificar-correo']);
      return false;
    }
  }

  return true;
};
