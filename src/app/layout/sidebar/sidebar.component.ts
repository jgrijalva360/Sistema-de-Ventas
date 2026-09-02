import { Component, input, output, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SyncService } from '../../core/services/sync.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside class="sidebar" [class.open]="isOpen()">
      <div class="sidebar-brand">
        <div class="brand-icon">🛒</div>
        <div class="brand-info">
          <h2>Stockup</h2>
          <span class="brand-sub">Punto de Venta</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <a routerLink="/dashboard" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">📊</span>
          <span>Dashboard</span>
        </a>
        <a routerLink="/ventas" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">💵</span>
          <span>Ventas (POS)</span>
        </a>
        <a routerLink="/pedidos" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">🎨</span>
          <span>Pedidos</span>
        </a>
        <a routerLink="/inventario" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">📦</span>
          <span>Inventario</span>
        </a>
        <a routerLink="/movimientos" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">🔄</span>
          <span>Movimientos</span>
        </a>
        <a routerLink="/gastos" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">🧾</span>
          <span>Gastos</span>
        </a>
        <a routerLink="/cortes" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">🔒</span>
          <span>Cortes de Caja</span>
        </a>
        <a routerLink="/reportes" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">📈</span>
          <span>Reportes</span>
        </a>
        <a routerLink="/bitacora" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">📜</span>
          <span>Bitácora</span>
        </a>
        <a routerLink="/configuracion" routerLinkActive="active" (click)="closeNav()" class="nav-item">
          <span class="nav-icon">⚙️</span>
          <span>Configuración</span>
        </a>
      </nav>

      <!-- Badge de Versión en el Sidebar -->
      <div class="sidebar-footer">
        <div class="version-badge">
          <span class="app-v">{{ syncService.currentVersion() }}</span>
          <span class="rev-v">Rev #{{ syncService.dataRevision() }}</span>
        </div>
      </div>
    </aside>

    @if (isOpen()) {
      <div class="sidebar-overlay" (click)="closeNav()"></div>
    }
  `,
  styles: [`
    .sidebar {
      width: 250px;
      height: 100vh;
      background: #0f172a;
      color: white;
      position: fixed;
      left: 0;
      top: 0;
      display: flex;
      flex-direction: column;
      z-index: 100;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .sidebar-brand {
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);

      .brand-icon {
        font-size: 1.8rem;
        background: rgba(2, 132, 199, 0.2);
        padding: 6px;
        border-radius: 10px;
      }

      h2 {
        font-size: 1.1rem;
        font-weight: 800;
        margin: 0;
        letter-spacing: -0.5px;
      }

      .brand-sub {
        font-size: 0.72rem;
        color: #38bdf8;
        font-weight: 700;
        text-transform: uppercase;
      }
    }

    .sidebar-nav {
      flex: 1;
      padding: 15px 10px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      color: #94a3b8;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
      border-radius: 8px;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #f8fafc;
      }

      &.active {
        background: #0284c7;
        color: white;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
      }

      .nav-icon {
        font-size: 1.15rem;
      }
    }

    .sidebar-footer {
      padding: 14px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(0, 0, 0, 0.2);
    }

    .version-badge {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      font-weight: 700;

      .app-v { color: #38bdf8; }
      .rev-v { color: #a7f3d0; background: rgba(16, 185, 129, 0.2); padding: 2px 6px; border-radius: 4px; }
    }

    .sidebar-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
      z-index: 90;
    }

    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        &.open {
          transform: translateX(0);
        }
      }
    }
  `]
})
export class SidebarComponent {
  public isOpen = input<boolean>(false);
  public closeSidebar = output<void>();

  public syncService = inject(SyncService);

  closeNav() {
    this.closeSidebar.emit();
  }
}
