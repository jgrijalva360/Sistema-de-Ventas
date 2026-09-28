import { Component, output, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { SucursalesService } from '../../core/services/sucursales.service';
import { SyncService } from '../../core/services/sync.service';
import { AuthService } from '../../core/services/auth.service';
import { SoporteService } from '../../core/services/soporte.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <header class="main-header">
      <div class="header-left">
        <button type="button" class="btn-hamburger" (click)="toggleMenu.emit()">
          ☰
        </button>

        <!-- Selector de Sucursal Activa (Solo en módulos POS operativos) -->
        @if (authService.mostrarModulosOperativos()) {
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
        }
      </div>

      <div class="header-right">
        <!-- Indicador de Sincronización en Vivo (Solo en módulos POS operativos) -->
        @if (authService.mostrarModulosOperativos()) {
          <div class="sync-indicator" [class]="syncService.syncStatus()">
            <span class="sync-dot"></span>
            <span class="sync-text">{{ syncService.syncMessage() }}</span>
          </div>
        }

        <!-- Botón Rápido de SuperAdmin para Alternar Módulos POS -->
        @if (authService.esSuperAdmin() && !authService.estaEnModoSoporte()) {
          <button
            type="button"
            class="btn-toggle-pos-header"
            [class.active]="authService.superAdminModoPos()"
            (click)="authService.toggleSuperAdminModoPos()"
            title="Alternar vista entre Solo Administración y Módulos de Punto de Venta"
          >
            {{ authService.superAdminModoPos() ? '🛒 POS: Activo' : '🛡️ Solo Admin' }}
          </button>
        }

        <!-- Notificaciones de Tickets de Soporte para SuperAdministrador -->
        @if (authService.esSuperAdmin()) {
          <div class="notifications-wrapper">
            <button
              type="button"
              class="btn-notification"
              (click)="toggleMenuTickets()"
              title="Solicitudes de Soporte de Empresas"
            >
              <span class="bell-icon">🔔</span>
              @if (soporteService.conteoAbiertos() > 0) {
                <span class="badge-pulse">{{ soporteService.conteoAbiertos() }}</span>
              }
            </button>

            @if (menuTicketsAbierto()) {
              <div class="tickets-dropdown-backdrop" (click)="menuTicketsAbierto.set(false)"></div>
              <div class="tickets-dropdown">
                <div class="dropdown-header">
                  <div>
                    <strong>🎧 Soporte Técnico</strong>
                    <div style="font-size: 0.72rem; color: #64748b;">
                      {{ soporteService.conteoAbiertos() }} ticket(s) pendiente(s)
                    </div>
                  </div>
                  <button type="button" class="btn-ver-todos" (click)="irATickets()">
                    Ver todos &rarr;
                  </button>
                </div>

                <div class="dropdown-list">
                  @for (t of soporteService.ticketsAbiertos().slice(0, 5); track t.folio) {
                    <div class="dropdown-ticket-item" (click)="irATickets()">
                      <div class="dt-top">
                        <strong class="dt-negocio">{{ t.nombreNegocio }}</strong>
                        <span class="dt-prio prio-{{ t.prioridad.toLowerCase() }}">{{ t.prioridad }}</span>
                      </div>
                      <p class="dt-desc">{{ t.descripcion }}</p>
                      <div class="dt-footer">
                        <span>👤 {{ t.usuarioNombre || t.usuarioEmail }}</span>
                        <span>{{ t.fechaCreacion | date:'dd/MM HH:mm' }}</span>
                      </div>
                    </div>
                  } @empty {
                    <div class="dropdown-empty">
                      <span>🎉 Sin tickets pendientes</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }


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

    .btn-toggle-pos-header {
      background: #f1f5f9;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 0.78rem;
      font-weight: 700;
      color: #475569;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;

      &:hover {
        background: #e2e8f0;
      }

      &.active {
        background: #e0f2fe;
        color: #0284c7;
        border-color: #38bdf8;
      }
    }

    /* Notificaciones de Tickets */
    .notifications-wrapper {
      position: relative;

      .btn-notification {
        position: relative;
        background: #f8fafc;
        border: 1.5px solid #cbd5e1;
        border-radius: 8px;
        padding: 6px 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;

        &:hover {
          background: #e2e8f0;
          border-color: #94a3b8;
        }

        .bell-icon {
          font-size: 1.15rem;
          line-height: 1;
        }

        .badge-pulse {
          position: absolute;
          top: -5px;
          right: -5px;
          background: #ef4444;
          color: white;
          font-size: 0.7rem;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 999px;
          box-shadow: 0 0 0 2px white;
          animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      }
    }

    @keyframes pulse-ring {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }

    .tickets-dropdown-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 99;
    }

    .tickets-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 330px;
      max-width: 90vw;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1);
      border: 1px solid #e2e8f0;
      z-index: 100;
      overflow: hidden;

      .dropdown-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;

        .btn-ver-todos {
          background: none;
          border: none;
          color: #0284c7;
          font-weight: 700;
          font-size: 0.8rem;
          cursor: pointer;
          padding: 0;
          &:hover { text-decoration: underline; }
        }
      }

      .dropdown-list {
        max-height: 320px;
        overflow-y: auto;

        .dropdown-ticket-item {
          padding: 10px 14px;
          border-bottom: 1px solid #f1f5f9;
          cursor: pointer;
          transition: background 0.15s;

          &:hover { background: #f8fafc; }

          .dt-top {
            display: flex;
            justify-content: space-between;
            align-items: center;

            .dt-negocio {
              font-size: 0.85rem;
              color: #0f172a;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 200px;
            }

            .dt-prio {
              font-size: 0.65rem;
              font-weight: 800;
              padding: 2px 6px;
              border-radius: 4px;

              &.prio-alta { background: #fee2e2; color: #b91c1c; }
              &.prio-media { background: #fef3c7; color: #b45309; }
              &.prio-baja { background: #e0f2fe; color: #0369a1; }
            }
          }

          .dt-desc {
            margin: 4px 0;
            font-size: 0.8rem;
            color: #475569;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.3;
          }

          .dt-footer {
            display: flex;
            justify-content: space-between;
            font-size: 0.72rem;
            color: #94a3b8;
          }
        }

        .dropdown-empty {
          padding: 24px;
          text-align: center;
          font-size: 0.84rem;
          color: #64748b;
        }
      }
    }

    .cajero-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      padding: 4px 10px 4px 12px;
      border-radius: 12px;
      font-size: 0.85rem;

      .cajero-icon {
        font-size: 1.15rem;
      }

      .cajero-info {
        display: flex;
        flex-direction: column;
        line-height: 1.15;
      }

      .cajero-label {
        font-size: 0.65rem;
        color: #166534;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }

      .cajero-nombre {
        font-size: 0.86rem;
        color: #14532d;
        font-weight: 800;
        white-space: nowrap;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .btn-bloquear-terminal {
        background: #0284c7;
        color: white;
        border: none;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 0.76rem;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all 0.15s ease;

        &:hover {
          background: #0369a1;
          transform: translateY(-1px);
        }

        &:active {
          transform: scale(0.96);
        }
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
  public soporteService = inject(SoporteService);
  private router = inject(Router);

  public menuTicketsAbierto = signal<boolean>(false);

  toggleMenuTickets(): void {
    this.menuTicketsAbierto.update(v => !v);
  }

  irATickets(): void {
    this.menuTicketsAbierto.set(false);
    this.router.navigate(['/super-admin'], { queryParams: { tab: 'TICKETS' } });
  }

  onSucursalChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    if (select) {
      this.sucursalesService.cambiarSucursalActiva(select.value);
    }
  }
}
