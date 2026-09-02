import { Component, output, inject } from '@angular/core';
import { SucursalesService } from '../../core/services/sucursales.service';
import { SyncService } from '../../core/services/sync.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="main-header">
      <div class="header-left">
        <button type="button" class="btn-hamburger" (click)="toggleMenu.emit()">
          ☰
        </button>

        <!-- Selector de Sucursal Activa -->
        <div class="branch-selector-wrapper">
          <span class="branch-icon">🏢</span>
          <select [value]="sucursalesService.activaId()" (change)="onSucursalChange($event)" class="branch-select">
            @for (sucursal of sucursalesService.sucursales(); track sucursal.id) {
              <option [value]="sucursal.id">
                {{ sucursal.nombre }}{{ sucursal.esMatriz ? ' (Matriz)' : '' }}
              </option>
            }
          </select>
        </div>
      </div>

      <div class="header-right">
        <!-- Indicador de Sincronización en Vivo -->
        <div class="sync-indicator" [class]="syncService.syncStatus()">
          <span class="sync-dot"></span>
          <span class="sync-text">{{ syncService.syncMessage() }}</span>
        </div>

        <!-- Usuario Activo & Logout -->
        <div class="user-badge">
          <span class="user-avatar">👤</span>
          <div style="display: flex; flex-direction: column; line-height: 1.2;">
            <span class="user-email">{{ authService.nombreUsuario() }}</span>
            <small style="font-size: 0.7rem; font-weight: 700; color: #0284c7;">{{ authService.rol() }}</small>
          </div>
          <button type="button" class="btn-logout" (click)="authService.logout()" title="Cerrar Sesión">
            🚪 Salir
          </button>
        </div>
      </div>
    </header>
  `,
  styles: [`
    .main-header {
      height: 64px;
      background: white;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      position: sticky;
      top: 0;
      z-index: 50;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .header-left, .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .btn-hamburger {
      display: none;
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 1.2rem;
      padding: 4px 8px;
      cursor: pointer;
      color: var(--dark);
    }

    .branch-selector-wrapper {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #f8fafc;
      padding: 4px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);

      .branch-icon { font-size: 1.1rem; }
      .branch-select {
        border: none;
        background: transparent;
        font-weight: 700;
        font-size: 0.88rem;
        color: var(--dark);
        outline: none;
        cursor: pointer;
      }
    }

    .sync-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 700;
      border: 1px solid transparent;

      .sync-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      &.online {
        background: #dcfce7;
        color: #15803d;
        border-color: #bbf7d0;
        .sync-dot { background: #10b981; box-shadow: 0 0 8px #10b981; }
      }

      &.saving, &.updated {
        background: #fef3c7;
        color: #b45309;
        border-color: #fde68a;
        .sync-dot { background: #f59e0b; }
      }

      &.offline {
        background: #fee2e2;
        color: #b91c1c;
        border-color: #fecaca;
        .sync-dot { background: #ef4444; }
      }
    }

    .user-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.86rem;

      .user-avatar {
        background: #e0f2fe;
        padding: 4px;
        border-radius: 50%;
      }

      .user-email {
        font-weight: 600;
        color: var(--slate);
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .btn-logout {
        background: #f8fafc;
        border: 1px solid var(--border);
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        color: var(--danger);

        &:hover {
          background: #fee2e2;
        }
      }
    }

    @media (max-width: 768px) {
      .btn-hamburger { display: block; }
      .user-email { display: none; }
      .main-header { padding: 0 12px; }
    }
  `]
})
export class HeaderComponent {
  public toggleMenu = output<void>();

  public sucursalesService = inject(SucursalesService);
  public syncService = inject(SyncService);
  public authService = inject(AuthService);

  onSucursalChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    if (select) {
      this.sucursalesService.cambiarSucursalActiva(select.value);
    }
  }
}
