import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { RolUsuario } from '../models/models';

export const roleGuard = (rolesPermitidos: RolUsuario[]): CanActivateFn => {
  return async () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    await authService.waitForAuthReady();

    if (!authService.isAuthenticated()) {
      router.navigate(['/login']);
      return false;
    }

    const rolActual = authService.rol();

    if (rolActual === 'SUPERADMIN' || rolesPermitidos.includes(rolActual)) {
      return true;
    }

    // Redirigir a ventas o dashboard si no tiene permisos suficientes
    alert('⚠️ No tienes permisos para acceder a este módulo.');
    router.navigate(['/ventas']);
    return false;
  };
};
