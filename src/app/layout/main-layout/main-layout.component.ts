import { Component, signal, OnInit, inject } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { HeaderComponent } from '../header/header.component';
import { SyncService } from '../../core/services/sync.service';
import { ProductosService } from '../../core/services/productos.service';
import { VentasService } from '../../core/services/ventas.service';
import { GastosService } from '../../core/services/gastos.service';
import { CortesService } from '../../core/services/cortes.service';
import { PedidosService } from '../../core/services/pedidos.service';
import { MovimientosService } from '../../core/services/movimientos.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { ConfiguracionService } from '../../core/services/configuracion.service';
import { AuthService } from '../../core/services/auth.service';
import { BitacoraService } from '../../core/services/bitacora.service';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { SociosService } from '../../core/services/socios.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, SidebarComponent, HeaderComponent],
  template: `
    <div class="app-layout">
      <app-sidebar [isOpen]="isSidebarOpen()" (closeSidebar)="isSidebarOpen.set(false)" />

      <div class="main-wrapper">
        <!-- Banner de Modo Soporte para SuperAdministrador -->
        @if (authService.estaEnModoSoporte()) {
          <div class="support-mode-banner">
            <div class="support-mode-left">
              <span class="support-badge">🛡️ MODO SOPORTE ACTIVO</span>
              <span class="support-text">
                Viendo datos de la empresa: <strong>{{ authService.nombreEmpresaSoporte() }}</strong>
              </span>
              <span class="support-id">ID: {{ authService.idEmpresaSoporte() }}</span>
            </div>
            <button type="button" class="btn-exit-support" (click)="authService.salirModoSoporte()">
              ✕ Salir del Modo Soporte (Regresar a Master SaaS)
            </button>
          </div>
        }

        <!-- Banner Preventivo de Vencimiento de Suscripción -->
        @if (suscripcionService.estaPorVencer() && !authService.estaEnModoSoporte()) {
          <div class="sub-alert-banner">
            <span>⏳ <strong>Aviso de Membresía:</strong> Tu suscripción a Stockup vence en <strong>{{ suscripcionService.diasRestantes() }} día(s)</strong>.</span>
            @if (authService.esAdmin()) {
              <a routerLink="/administracion" class="btn-sub-renew">Renovar Membresía</a>
            }
          </div>
        }

        <app-header (toggleMenu)="isSidebarOpen.set(!isSidebarOpen())" />

        <main class="page-content">
          <router-outlet />
        </main>
      </div>

      <!-- Banner Flotante si hay Nueva Versión Desplegada -->
      @if (syncService.newVersionAvailable()) {
        <div class="version-banner">
          <span>🚀 Hay una actualización disponible (<strong>{{ syncService.newVersionAvailable() }}</strong>).</span>
          <button class="btn btn-sm btn-primary" (click)="recargarPagina()">Recargar</button>
          <button class="btn-close" (click)="syncService.newVersionAvailable.set(null)">✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .app-layout {
      display: flex;
      min-height: 100vh;
    }

    .support-mode-banner {
      background: linear-gradient(90deg, #065f46, #059669);
      color: #ffffff;
      padding: 10px 20px;
      font-size: 0.9rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      box-shadow: 0 3px 8px rgba(0,0,0,0.15);
      position: sticky;
      top: 0;
      z-index: 1000;

      .support-mode-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .support-badge {
        background: #047857;
        border: 1px solid #34d399;
        color: #ecfdf5;
        padding: 3px 8px;
        border-radius: 6px;
        font-weight: 800;
        font-size: 0.78rem;
        letter-spacing: 0.5px;
      }

      .support-text {
        font-size: 0.92rem;
      }

      .support-id {
        font-family: monospace;
        font-size: 0.8rem;
        opacity: 0.9;
        background: rgba(0, 0, 0, 0.25);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .btn-exit-support {
        background: #ffffff;
        color: #065f46;
        border: none;
        border-radius: 6px;
        padding: 6px 14px;
        font-weight: 800;
        font-size: 0.82rem;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);

        &:hover {
          background: #ecfdf5;
          transform: translateY(-1px);
        }
      }
    }

    .sub-alert-banner {
      background: linear-gradient(90deg, #b45309, #d97706);
      color: white;
      padding: 10px 20px;
      font-size: 0.88rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);

      .btn-sub-renew {
        background: white;
        color: #b45309;
        font-weight: 800;
        font-size: 0.8rem;
        padding: 4px 12px;
        border-radius: 6px;
        text-decoration: none;
        box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        &:hover { background: #fef3c7; }
      }
    }

    .main-wrapper {
      flex: 1;
      margin-left: 250px;
      display: flex;
      flex-direction: column;
      min-width: 0;
      transition: margin-left 0.3s ease;
    }

    .page-content {
      flex: 1;
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
    }

    .version-banner {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 18px;
      border-radius: 8px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 9999;
      font-size: 0.88rem;
      border: 1px solid #334155;
      animation: slideUp 0.3s ease;

      .btn-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 1rem;
        padding: 0 4px;
        &:hover { color: #ffffff; }
      }
    }

    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    @media (max-width: 900px) {
      .main-wrapper {
        margin-left: 0;
      }
      .page-content {
        padding: 16px;
      }
    }
  `]
})
export class MainLayoutComponent implements OnInit {
  public isSidebarOpen = signal<boolean>(false);

  public syncService = inject(SyncService);
  public authService = inject(AuthService);
  public suscripcionService = inject(SuscripcionService);
  private productosService = inject(ProductosService);
  private ventasService = inject(VentasService);
  private gastosService = inject(GastosService);
  private cortesService = inject(CortesService);
  private pedidosService = inject(PedidosService);
  private movimientosService = inject(MovimientosService);
  private sucursalesService = inject(SucursalesService);
  private configuracionService = inject(ConfiguracionService);
  private bitacoraService = inject(BitacoraService);
  private sociosService = inject(SociosService);

  async ngOnInit(): Promise<void> {
    // 0. Esperar a que la sesión de Firebase Auth esté lista
    await this.authService.waitForAuthReady();

    // 1. Carga inicial de datos
    await Promise.all([
      this.productosService.cargarProductos(),
      this.ventasService.cargarVentas(),
      this.gastosService.cargarGastos(),
      this.cortesService.cargarCortes(),
      this.pedidosService.cargarPedidos(),
      this.movimientosService.cargarMovimientos(),
      this.sucursalesService.cargarSucursales(),
      this.configuracionService.cargarConfiguracion(),
      this.bitacoraService.cargarBitacora(),
      this.sociosService.cargarDatos()
    ]);

    // 2. Iniciar escuchadores en tiempo real
    this.syncService.iniciarEscuchadorVersion();
    this.configuracionService.iniciarEscuchadorLive();
    this.productosService.iniciarEscuchadorLive();
    this.movimientosService.iniciarEscuchadorLive();
    this.ventasService.iniciarEscuchadorLiveVentas();
    this.gastosService.iniciarEscuchadorLive();
    this.cortesService.iniciarEscuchadoresLive();
    this.pedidosService.iniciarEscuchadorLive();
    this.sucursalesService.iniciarEscuchadorLive();
    this.bitacoraService.iniciarEscuchadorLive();
  }

  recargarPagina(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString());
    window.location.replace(url.toString());
  }
}
