import { Injectable, inject, Injector } from '@angular/core';
import { ProductosService } from './productos.service';
import { VentasService } from './ventas.service';
import { GastosService } from './gastos.service';
import { CortesService } from './cortes.service';
import { MovimientosService } from './movimientos.service';
import { PedidosService } from './pedidos.service';
import { SucursalesService } from './sucursales.service';
import { BitacoraService } from './bitacora.service';
import { SociosService } from './socios.service';
import { ConfiguracionService } from './configuracion.service';
import { SyncService } from './sync.service';

@Injectable({
  providedIn: 'root'
})
export class DataCleanupService {
  private injector = inject(Injector);

  /**
   * Vacía todo el estado en memoria y cancela las suscripciones activas
   * a colecciones de Firestore para garantizar aislamiento absoluto
   * entre empresas y sesiones de usuario.
   * Utiliza resolución perezosa para evitar dependencias circulares con AuthService.
   */
  limpiarTodoElEstadoLocal(): void {
    try {
      this.injector.get(ProductosService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(VentasService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(GastosService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(CortesService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(MovimientosService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(PedidosService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(SucursalesService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(BitacoraService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(SociosService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(ConfiguracionService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
    try {
      this.injector.get(SyncService, null, { optional: true })?.limpiarEstado();
    } catch (_) {}
  }
}
