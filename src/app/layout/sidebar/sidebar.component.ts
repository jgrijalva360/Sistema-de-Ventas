import { Component, input, output, inject, signal, computed } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { SyncService } from '../../core/services/sync.service';
import { AuthService } from '../../core/services/auth.service';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { FirebaseService } from '../../core/services/firebase.service';
import { SoporteService } from '../../core/services/soporte.service';
import { TicketSoporte } from '../../core/models/models';
import { comprimirImagen, calcularTamanioBase64 } from '../../core/utils/image.util';
import { doc, setDoc } from 'firebase/firestore';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, FormsModule, DatePipe],
  template: `
    <aside class="sidebar" [class.open]="isOpen()">
      <div class="sidebar-brand">
        @if (authService.esSuperAdmin() && !authService.estaEnModoSoporte()) {
          <div class="brand-icon" style="background: rgba(16, 185, 129, 0.2);">🛡️</div>
          <div class="brand-info">
            <h2>Stockup</h2>
            <span class="brand-sub" style="color: #34d399;">Master SaaS</span>
          </div>
        } @else {
          <div class="brand-icon">🛒</div>
          <div class="brand-info">
            <h2>Stockup</h2>
            <span class="brand-sub">Punto de Venta</span>
          </div>
        }
      </div>

      <nav class="sidebar-nav">
        <!-- Panel Exclusivo para SuperAdministrador (Administración Global del Sistema) -->
        @if (authService.esSuperAdmin()) {
          <div class="nav-section-title">ADMINISTRACIÓN SISTEMA</div>

          <a routerLink="/super-admin" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}" (click)="closeNav()" class="nav-item saas-highlight">
            <span class="nav-icon">🛡️</span>
            <span>Master SaaS</span>
          </a>
          <a routerLink="/super-admin" [queryParams]="{tab: 'EMPRESAS'}" (click)="closeNav()" class="nav-item nav-sub">
            <span class="nav-icon">🏢</span>
            <span>Empresas & Clientes</span>
          </a>
          <a routerLink="/super-admin" [queryParams]="{tab: 'PLANES'}" (click)="closeNav()" class="nav-item nav-sub">
            <span class="nav-icon">📋</span>
            <span>Planes & Precios</span>
          </a>
          <a routerLink="/super-admin" [queryParams]="{tab: 'CODIGOS'}" (click)="closeNav()" class="nav-item nav-sub">
            <span class="nav-icon">🎟️</span>
            <span>Códigos Promocionales</span>
          </a>
          <a routerLink="/super-admin" [queryParams]="{tab: 'TICKETS'}" (click)="closeNav()" class="nav-item nav-sub">
            <span class="nav-icon">🎧</span>
            <span>Soporte Técnico</span>
            @if (soporteService.conteoAbiertos() > 0) {
              <span class="badge-pulse-nav">{{ soporteService.conteoAbiertos() }}</span>
            }
          </a>

          <!-- Interruptor para SuperAdmin: Habilitar componentes de Punto de Venta -->
          <div class="superadmin-toggle-box">
            <button
              type="button"
              class="btn-toggle-pos"
              [class.active]="authService.superAdminModoPos()"
              (click)="authService.toggleSuperAdminModoPos()"
              title="Habilitar o deshabilitar módulos de punto de venta"
            >
              <span class="toggle-indicator"></span>
              <span class="toggle-label">
                {{ authService.superAdminModoPos() ? 'Punto de Venta: Habilitado' : 'Habilitar Módulos POS' }}
              </span>
            </button>
          </div>
        }

        <!-- Módulos Operativos (Ventas, Inventario, etc.) -->
        @if (authService.mostrarModulosOperativos()) {
          @if (authService.esSuperAdmin()) {
            <div class="nav-section-title" style="margin-top: 14px; color: #38bdf8;">PUNTO DE VENTA</div>
          }

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

          @if (authService.esEncargado()) {
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
          }

          <a routerLink="/cortes" routerLinkActive="active" (click)="closeNav()" class="nav-item">
            <span class="nav-icon">🔒</span>
            <span>Cortes de Caja</span>
          </a>

          @if (authService.esEncargado()) {
            <a routerLink="/reportes" routerLinkActive="active" (click)="closeNav()" class="nav-item">
              <span class="nav-icon">📈</span>
              <span>Reportes</span>
            </a>
          }

          @if (authService.esAdmin()) {
            <div class="nav-dropdown-group">
              <button
                type="button"
                class="nav-item nav-dropdown-btn"
                [class.has-active]="esRutaAdminActiva()"
                (click)="alternarMenuAdmin()"
                title="Administración y Configuración del Sistema"
              >
                <span class="nav-icon">⚙️</span>
                <span class="dropdown-label">Ajustes & Gestión</span>
                <span class="dropdown-arrow" [class.rotated]="menuAdminDesplegado()">▼</span>
              </button>

              @if (menuAdminDesplegado()) {
                <div class="nav-dropdown-menu">
                  <a routerLink="/socios" routerLinkActive="active" (click)="closeNav()" class="nav-item nav-sub">
                    <span class="nav-icon">🤝</span>
                    <span>Socios</span>
                  </a>
                  <a routerLink="/administracion" routerLinkActive="active" (click)="closeNav()" class="nav-item nav-sub">
                    <span class="nav-icon">👥</span>
                    <span>Colaboradores</span>
                  </a>
                  <a routerLink="/bitacora" routerLinkActive="active" (click)="closeNav()" class="nav-item nav-sub">
                    <span class="nav-icon">📜</span>
                    <span>Bitácora</span>
                  </a>
                  <a routerLink="/configuracion" routerLinkActive="active" (click)="closeNav()" class="nav-item nav-sub">
                    <span class="nav-icon">⚙️</span>
                    <span>Configuración</span>
                  </a>
                </div>
              }
            </div>
          }
        }
      </nav>

      <!-- Botón de Solicitar Soporte / Levantar Ticket (Oculto para SuperAdmin en modo normal) -->
      @if (!authService.esSuperAdmin() || authService.estaEnModoSoporte()) {
        <div class="sidebar-support-box">
          <button type="button" class="btn-support-link" (click)="abrirModalSoporte()">
            <span class="support-icon">🎧</span>
            <div class="support-text">
              <span class="support-title">¿Necesitas Ayuda?</span>
              <span class="support-sub">Levantar Ticket de Soporte</span>
            </div>
            <span class="support-arrow">➔</span>
          </button>
        </div>
      }

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

    <!-- Modal para Centro de Soporte y Chat Técnico -->
    @if (modalSoporteAbierto()) {
      <div class="modal-overlay-support" (click)="cerrarModalSoporte()">
        <div class="modal-support-card" (click)="$event.stopPropagation()">
          
          <!-- Encabezado del Modal -->
          <div class="modal-support-header">
            @if (vistaSoporte() === 'CHAT' && ticketActivo(); as ticket) {
              <div class="header-left" style="display: flex; align-items: center; gap: 10px;">
                <button type="button" class="btn-back-chat" (click)="volverAListaTickets()" title="Volver a mis solicitudes">
                  ← Volver
                </button>
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <h3 style="margin: 0; font-size: 1.05rem;">💬 Chat #{{ ticket.folio }}</h3>
                    <span
                      class="status-pill-sub"
                      [style.background]="ticket.estado === 'ABIERTO' ? '#ef4444' : (ticket.estado === 'EN_PROCESO' ? '#f59e0b' : (ticket.estado === 'RESUELTO' ? '#10b981' : '#64748b'))"
                    >
                      {{ ticket.estado }}
                    </span>
                  </div>
                  <p style="margin: 2px 0 0; font-size: 0.78rem; color: #64748b;">
                    {{ ticket.categoria }} &bull; {{ ticket.prioridad }}
                  </p>
                </div>
              </div>
            } @else {
              <div class="header-left">
                <span class="header-icon">🎧</span>
                <div>
                  <h3>Centro de Soporte y Chat Técnico</h3>
                  <p>Platica con el equipo de soporte y da seguimiento a tus dudas o fallas</p>
                </div>
              </div>
            }
            <button type="button" class="btn-close-support" (click)="cerrarModalSoporte()" aria-label="Cerrar">✕</button>
          </div>

          <!-- Pestañas de Navegación del Soporte si no está en chat activo -->
          @if (vistaSoporte() !== 'CHAT') {
            <div class="support-subtabs">
              <button
                type="button"
                class="subtab-btn"
                [class.active]="vistaSoporte() === 'LISTA'"
                (click)="vistaSoporte.set('LISTA')"
              >
                💬 Mis Solicitudes ({{ soporteService.ticketsEmpresa().length }})
              </button>
              <button
                type="button"
                class="subtab-btn"
                [class.active]="vistaSoporte() === 'NUEVO'"
                (click)="vistaSoporte.set('NUEVO')"
              >
                ➕ Nueva Solicitud
              </button>
            </div>
          }

          <!-- Vista 1: Lista de Solicitudes / Tickets del Cliente -->
          @if (vistaSoporte() === 'LISTA') {
            <div class="modal-support-body" style="padding: 16px; overflow-y: auto; max-height: 60vh;">
              @for (t of soporteService.ticketsEmpresa(); track t.folio) {
                <div class="ticket-client-item" (click)="abrirChatTicket(t)">
                  <div class="t-top">
                    <strong class="t-folio">#{{ t.folio }}</strong>
                    <span
                      class="t-badge"
                      [style.background]="t.estado === 'ABIERTO' ? '#fee2e2' : (t.estado === 'EN_PROCESO' ? '#fef3c7' : (t.estado === 'RESUELTO' ? '#dcfce7' : '#f1f5f9'))"
                      [style.color]="t.estado === 'ABIERTO' ? '#991b1b' : (t.estado === 'EN_PROCESO' ? '#92400e' : (t.estado === 'RESUELTO' ? '#166534' : '#475569'))"
                    >
                      {{ t.estado }}
                    </span>
                  </div>
                  <div class="t-desc">{{ t.descripcion }}</div>
                  <div class="t-meta">
                    <span>📅 {{ t.fechaCreacion | date:'dd/MM/yyyy HH:mm' }}</span>
                    <span>📁 {{ t.categoria }}</span>
                    @if (t.mensajes && t.mensajes.length > 0) {
                      <span class="t-replies">💬 {{ t.mensajes.length }} mensaje(s)</span>
                    }
                  </div>
                </div>
              } @empty {
                <div class="empty-tickets-view">
                  <div class="empty-icon">📭</div>
                  <h4>No tienes solicitudes abiertas</h4>
                  <p>Si necesitas ayuda o encuentras alguna falla, crea una solicitud y te atenderemos de inmediato.</p>
                  <button type="button" class="btn-create-first" (click)="vistaSoporte.set('NUEVO')">
                    ➕ Crear Nueva Solicitud
                  </button>
                </div>
              }
            </div>
          }

          <!-- Vista 2: Chat en Vivo con SuperAdmin -->
          @else if (vistaSoporte() === 'CHAT' && ticketActivo(); as ticket) {
            <div class="client-chat-container">
              <div class="client-chat-scroll" id="clientChatScroll">
                
                <!-- Tarjeta inicial del problema -->
                <div class="client-orig-card">
                  <div class="card-head">
                    <span>👤 Tú (Apertura de Solicitud)</span>
                    <span>{{ ticket.fechaCreacion | date:'dd/MM HH:mm' }}</span>
                  </div>
                  <div class="card-body-txt">{{ ticket.descripcion }}</div>
                  @if (ticket.imagenAdjunta) {
                    <div style="margin-top: 8px;">
                      <img
                        [src]="ticket.imagenAdjunta"
                        (click)="verImagenGrande(ticket.imagenAdjunta)"
                        class="thumb-img"
                        alt="Captura inicial"
                        title="Clic para ampliar"
                      />
                    </div>
                  }
                </div>

                <!-- Mensajes -->
                @for (msg of ticket.mensajes || []; track msg.id) {
                  <div
                    class="client-chat-row"
                    [class.is-admin]="msg.remitenteRol === 'SUPERADMIN'"
                    [class.is-client]="msg.remitenteRol === 'CLIENTE'"
                  >
                    <div class="bubble">
                      <div class="bubble-meta">
                        <strong>{{ msg.remitenteRol === 'SUPERADMIN' ? '🛡️ Soporte Técnico' : '👤 Tú' }}</strong>
                        <small>{{ msg.fecha | date:'dd/MM HH:mm' }}</small>
                      </div>
                      @if (msg.texto) {
                        <p class="bubble-txt">{{ msg.texto }}</p>
                      }
                      @if (msg.imagenUrl) {
                        <div style="margin-top: 6px;">
                          <img
                            [src]="msg.imagenUrl"
                            class="thumb-img"
                            (click)="verImagenGrande(msg.imagenUrl)"
                            title="Clic para ampliar"
                            alt="Imagen de chat"
                          />
                        </div>
                      }
                    </div>
                  </div>
                }

                @if (ticket.respuestaAdmin && (!ticket.mensajes || ticket.mensajes.length === 0)) {
                  <div class="client-chat-row is-admin">
                    <div class="bubble">
                      <div class="bubble-meta">
                        <strong>🛡️ Soporte Técnico</strong>
                        <small>{{ (ticket.fechaRespuesta | date:'dd/MM HH:mm') || 'Anterior' }}</small>
                      </div>
                      <p class="bubble-txt">{{ ticket.respuestaAdmin }}</p>
                    </div>
                  </div>
                }
              </div>

              <!-- Preview de imagen seleccionada por cliente -->
              <!-- Bloqueo cuando el ticket está CERRADO -->
              @if (ticket.estado === 'CERRADO') {
                <div class="ticket-closed-notice">
                  <span class="icon">🔒</span>
                  <div>
                    <strong>Ticket Cerrado</strong>
                    <p>Esta solicitud ha sido finalizada y cerrada. No es posible enviar más mensajes ni archivos.</p>
                  </div>
                  <button type="button" class="btn-create-sub" (click)="vistaSoporte.set('NUEVO')">
                    ➕ Nueva Solicitud
                  </button>
                </div>
              } @else {
                <!-- Preview de imagen seleccionada por cliente -->
                @if (imagenClienteBase64()) {
                  <div class="client-preview-img-bar">
                    <img [src]="imagenClienteBase64()" alt="Captura a enviar" />
                    <div class="info">
                      <strong>Captura lista</strong>
                      <span>{{ imagenClienteNombre() }} ({{ calcularTamanioBase64(imagenClienteBase64()) }})</span>
                    </div>
                    <button type="button" class="btn-del" (click)="quitarImagenChat()">✕</button>
                  </div>
                }

                <!-- Input de chat del cliente -->
                <form (ngSubmit)="enviarMensajeClienteChat($event)" class="client-chat-input-bar">
                  <input
                    type="file"
                    #fileInputClientChat
                    (change)="onSeleccionarImagenChat($event)"
                    accept="image/*"
                    style="display: none;"
                  />
                  <button
                    type="button"
                    class="btn-icon-attach"
                    (click)="fileInputClientChat.click()"
                    [disabled]="procesandoImagenCliente() || enviandoMensajeCliente()"
                    title="Adjuntar captura de pantalla o foto"
                  >
                    {{ procesandoImagenCliente() ? '⏳' : '📷' }}
                  </button>
                  <input
                    type="text"
                    [(ngModel)]="nuevoMensajeCliente"
                    name="nuevoMensajeCliente"
                    class="client-chat-input"
                    placeholder="Escribe tu mensaje o respuesta para soporte..."
                    [disabled]="enviandoMensajeCliente()"
                  />
                  <button
                    type="submit"
                    class="btn-client-send"
                    [disabled]="enviandoMensajeCliente() || (!nuevoMensajeCliente.trim() && !imagenClienteBase64())"
                  >
                    {{ enviandoMensajeCliente() ? '...' : 'Enviar 🚀' }}
                  </button>
                </form>
              }
            </div>
          }

          <!-- Vista 3: Formulario Nueva Solicitud -->
          @else if (vistaSoporte() === 'NUEVO') {
            <form (ngSubmit)="enviarTicket()" class="support-form-wrapper">
              <div class="modal-support-body">
                <div class="support-client-info">
                  <div class="info-badge">
                    <span class="lbl">Empresa:</span>
                    <strong>{{ suscripcionService.suscripcion()?.nombreNegocio || 'Mi Negocio' }}</strong>
                  </div>
                  <div class="info-badge">
                    <span class="lbl">Usuario:</span>
                    <strong>{{ authService.nombreUsuario() }}</strong>
                  </div>
                </div>

                <div class="form-row-2">
                  <div class="form-field">
                    <label for="catTicket">Categoría / Asunto *</label>
                    <select id="catTicket" [(ngModel)]="categoriaTicket" name="categoriaTicket" required>
                      <option value="DUDA">❓ Duda sobre el sistema</option>
                      <option value="FALLA">⚠️ Falla o error en pantalla</option>
                      <option value="VENTAS_INVENTARIO">📦 Ventas o Inventario</option>
                      <option value="IMPRESION">🖨️ Impresión / Hardware</option>
                      <option value="PLAN_PAGO">💳 Planes o Suscripción</option>
                      <option value="SUGERENCIA">💡 Sugerencia o Mejora</option>
                      <option value="OTRO">💬 Otro asunto</option>
                    </select>
                  </div>

                  <div class="form-field">
                    <label for="prioTicket">Prioridad *</label>
                    <select id="prioTicket" [(ngModel)]="prioridadTicket" name="prioridadTicket" required>
                      <option value="BAJA">🟢 Normal (Consulta general)</option>
                      <option value="MEDIA">🟡 Media (Afecta una operación)</option>
                      <option value="ALTA">🔴 Urgente (Bloquea ventas)</option>
                    </select>
                  </div>
                </div>

                <div class="form-field">
                  <label for="telTicket">Teléfono o WhatsApp de contacto (Opcional)</label>
                  <input
                    id="telTicket"
                    type="tel"
                    [(ngModel)]="telefonoTicket"
                    name="telefonoTicket"
                    placeholder="Ej: 55 1234 5678"
                  />
                </div>

                <div class="form-field">
                  <label for="descTicket">Descripción del problema o solicitud *</label>
                  <textarea
                    id="descTicket"
                    [(ngModel)]="descripcionTicket"
                    name="descripcionTicket"
                    rows="3"
                    placeholder="Describe en qué podemos ayudarte o qué mensaje de error apareció..."
                    required
                  ></textarea>
                </div>

                <!-- Adjuntar Imagen Inicial -->
                <div class="form-field">
                  <label>Captura de pantalla o fotografía (Opcional):</label>
                  <input
                    type="file"
                    #fileInputNuevoTicket
                    (change)="onSeleccionarImagenNuevoTicket($event)"
                    accept="image/*"
                    style="display: none;"
                  />

                  @if (imagenNuevoTicketBase64()) {
                    <div class="client-preview-img-bar" style="margin-top: 4px;">
                      <img [src]="imagenNuevoTicketBase64()" alt="Captura adjunta" />
                      <div class="info">
                        <strong>{{ imagenNuevoTicketNombre() }}</strong>
                        <span>{{ calcularTamanioBase64(imagenNuevoTicketBase64()) }}</span>
                      </div>
                      <button type="button" class="btn-del" (click)="quitarImagenNuevoTicket()">✕</button>
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="btn-attach-client-form"
                      (click)="fileInputNuevoTicket.click()"
                      [disabled]="procesandoImagenNuevoTicket()"
                    >
                      {{ procesandoImagenNuevoTicket() ? '⏳ Optimizando imagen...' : '📷 Adjuntar Captura de Pantalla' }}
                    </button>
                  }
                </div>

                @if (errorTicket()) {
                  <div class="support-error-msg">⚠️ {{ errorTicket() }}</div>
                }
              </div>

              <!-- Footer FIJO con botones de acción -->
              <div class="modal-support-footer">
                <button type="button" class="btn-modal-secondary" (click)="cerrarModalSoporte()">
                  Cancelar
                </button>
                <button type="submit" class="btn-modal-primary" [disabled]="enviandoTicket() || !descripcionTicket.trim()">
                  {{ enviandoTicket() ? 'Guardando...' : '🚀 Crear Solicitud y Chatear' }}
                </button>
              </div>
            </form>
          }

        </div>
      </div>
    }

    <!-- Modal Lightbox Cliente -->
    @if (modalImagenZoom(); as zoomUrl) {
      <div class="img-lightbox-backdrop" (click)="cerrarImagenZoom()">
        <div class="lightbox-content" (click)="$event.stopPropagation()">
          <button type="button" class="btn-close-lightbox" (click)="cerrarImagenZoom()">✕</button>
          <img [src]="zoomUrl" alt="Captura ampliada" />
        </div>
      </div>
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

      &.saas-highlight {
        color: #34d399;
        font-weight: 700;
        background: rgba(16, 185, 129, 0.1);
        border: 1px solid rgba(52, 211, 153, 0.25);
        &:hover {
          background: rgba(16, 185, 129, 0.2);
          color: #6ee7b7;
        }
        &.active {
          background: #059669;
          color: #ffffff;
          box-shadow: 0 4px 12px rgba(5, 150, 105, 0.4);
        }
      }

      &.nav-sub {
        padding: 8px 12px 8px 24px;
        font-size: 0.85rem;
        color: #94a3b8;
        &:hover {
          color: #f1f5f9;
          background: rgba(255, 255, 255, 0.05);
        }
      }

      .nav-icon {
        font-size: 1.15rem;
      }
    }

    .nav-dropdown-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 2px;

      .nav-dropdown-btn {
        width: 100%;
        background: transparent;
        border: 1px solid transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        text-align: left;
        font-family: inherit;

        .dropdown-label {
          flex: 1;
        }

        .dropdown-arrow {
          font-size: 0.65rem;
          color: #64748b;
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s ease;
          display: inline-block;

          &.rotated {
            transform: rotate(180deg);
            color: #38bdf8;
          }
        }

        &:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #f8fafc;
        }

        &.has-active {
          color: #f8fafc;
          background: rgba(2, 132, 199, 0.15);
          border-color: rgba(2, 132, 199, 0.3);
        }
      }

      .nav-dropdown-menu {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-left: 4px;
        border-left: 2px solid rgba(56, 189, 248, 0.25);
        margin-left: 18px;
        margin-top: 2px;
        margin-bottom: 4px;
        animation: fadeIn 0.2s ease;

        .nav-item.nav-sub {
          padding: 8px 12px;
          font-size: 0.84rem;
        }
      }
    }

    .nav-section-title {
      font-size: 0.68rem;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.6px;
      padding: 10px 14px 4px;
      text-transform: uppercase;
    }

    .badge-pulse-nav {
      margin-left: auto;
      background: #ef4444;
      color: white;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 999px;
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
    }

    .superadmin-toggle-box {
      margin: 12px 6px 6px;
      padding-top: 10px;
      border-top: 1px dashed rgba(255, 255, 255, 0.12);
    }

    .btn-toggle-pos {
      width: 100%;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 7px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #94a3b8;
      cursor: pointer;
      font-size: 0.78rem;
      font-weight: 700;
      transition: all 0.2s ease;

      .toggle-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #64748b;
        transition: background 0.2s;
      }

      &:hover {
        background: rgba(51, 65, 85, 0.8);
        color: #f1f5f9;
        border-color: #475569;
      }

      &.active {
        background: rgba(2, 132, 199, 0.15);
        border-color: #0284c7;
        color: #38bdf8;

        .toggle-indicator {
          background: #38bdf8;
          box-shadow: 0 0 6px #38bdf8;
        }
      }
    }

    .sidebar-support-box {
      padding: 10px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(15, 23, 42, 0.6);
    }

    .btn-support-link {
      width: 100%;
      background: rgba(2, 132, 199, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #f1f5f9;
      cursor: pointer;
      text-align: left;
      transition: all 0.25s ease;

      &:hover {
        background: rgba(2, 132, 199, 0.25);
        border-color: #38bdf8;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.2);

        .support-arrow {
          transform: translateX(3px);
          color: #38bdf8;
        }
      }

      .support-icon {
        font-size: 1.25rem;
      }

      .support-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        line-height: 1.2;

        .support-title {
          font-size: 0.7rem;
          color: #94a3b8;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .support-sub {
          font-size: 0.82rem;
          color: #38bdf8;
          font-weight: 700;
        }
      }

      .support-arrow {
        font-size: 0.85rem;
        color: #64748b;
        transition: transform 0.2s ease, color 0.2s ease;
      }
    }

    // Modal de Soporte
    .modal-overlay-support {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.8);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      padding: 12px;
      box-sizing: border-box;
      animation: fadeIn 0.2s ease;
    }

    .modal-support-card {
      background: #ffffff;
      color: #0f172a;
      width: 100%;
      max-width: 500px;
      max-height: min(92vh, 620px);
      border-radius: 14px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
      animation: zoomIn 0.2s ease;
      position: relative;

      * {
        box-sizing: border-box;
      }
    }

    .modal-support-header {
      flex-shrink: 0;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);

      .header-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;

        .header-icon {
          font-size: 1.4rem;
          background: rgba(56, 189, 248, 0.15);
          padding: 6px;
          border-radius: 8px;
          flex-shrink: 0;
        }

        h3 {
          margin: 0;
          font-size: 1rem;
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        p {
          margin: 2px 0 0;
          font-size: 0.73rem;
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      .btn-close-support {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
        border-radius: 6px;
        transition: all 0.2s;

        &:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }
      }
    }

    .support-form-wrapper {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .modal-support-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 11px;

      &::-webkit-scrollbar {
        width: 5px;
      }
      &::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }
    }

    .support-client-info {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 7px 11px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 0.78rem;
      color: #334155;

      .info-badge {
        display: flex;
        align-items: center;
        gap: 5px;

        .lbl {
          color: #64748b;
        }
        strong {
          color: #0f172a;
        }
      }
    }

    .form-row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;

      @media (max-width: 480px) {
        grid-template-columns: 1fr;
      }
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: 4px;

      label {
        font-size: 0.78rem;
        font-weight: 700;
        color: #334155;
      }

      input, select, textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1.5px solid #cbd5e1;
        border-radius: 8px;
        font-size: 0.86rem;
        color: #0f172a;
        background: #ffffff;
        font-family: inherit;
        line-height: 1.4;
        transition: border-color 0.2s, box-shadow 0.2s;

        &:focus {
          outline: none;
          border-color: #0284c7;
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
        }
      }

      textarea {
        resize: vertical;
        min-height: 65px;
        max-height: 130px;
      }
    }

    .support-error-msg {
      background: #fef2f2;
      border: 1px solid #fecdd3;
      color: #991b1b;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 600;
    }

    .modal-support-footer {
      flex-shrink: 0;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 11px 18px;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;

      .btn-modal-primary {
        background: #0284c7;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 9px 18px;
        font-weight: 800;
        font-size: 0.88rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 2px 6px rgba(2, 132, 199, 0.25);
        transition: all 0.2s;

        &:hover:not(:disabled) {
          background: #0369a1;
          transform: translateY(-1px);
        }
        &:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      }

      .btn-modal-secondary {
        background: #ffffff;
        color: #475569;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 9px 15px;
        font-weight: 700;
        font-size: 0.88rem;
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
          background: #f1f5f9;
          border-color: #94a3b8;
        }
      }
    }

    /* Pestañas de Soporte Cliente */
    .support-subtabs {
      display: flex;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      padding: 0 16px;

      .subtab-btn {
        background: transparent;
        border: none;
        padding: 10px 14px;
        font-size: 0.82rem;
        font-weight: 700;
        color: #64748b;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.15s;

        &:hover { color: #0284c7; }
        &.active {
          color: #0284c7;
          border-bottom-color: #0284c7;
          background: #ffffff;
        }
      }
    }

    /* Lista de Tickets del Cliente */
    .ticket-client-item {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.15s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);

      &:hover {
        border-color: #0284c7;
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(2, 132, 199, 0.1);
      }

      .t-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;

        .t-folio {
          font-family: monospace;
          color: #0284c7;
          font-size: 0.92rem;
        }

        .t-badge {
          font-size: 0.72rem;
          font-weight: 800;
          padding: 2px 7px;
          border-radius: 999px;
        }
      }

      .t-desc {
        font-size: 0.86rem;
        color: #334155;
        line-height: 1.4;
        margin-bottom: 8px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .t-meta {
        display: flex;
        gap: 12px;
        font-size: 0.75rem;
        color: #64748b;
        flex-wrap: wrap;

        .t-replies {
          color: #0284c7;
          font-weight: 700;
        }
      }
    }

    .empty-tickets-view {
      padding: 30px 16px;
      text-align: center;
      .empty-icon { font-size: 2.5rem; margin-bottom: 8px; }
      h4 { margin: 0 0 6px; color: #0f172a; font-size: 1rem; }
      p { color: #64748b; font-size: 0.84rem; margin: 0 0 16px; }
      .btn-create-first {
        background: #0284c7;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 8px;
        font-weight: 700;
        font-size: 0.85rem;
        cursor: pointer;
      }
    }

    /* Chat del Cliente */
    .btn-back-chat {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      color: #334155;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      &:hover { background: #e2e8f0; }
    }

    .status-pill-sub {
      color: white;
      font-size: 0.7rem;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 999px;
    }

    .client-chat-container {
      display: flex;
      flex-direction: column;
      height: 480px;
      max-height: 60vh;
      background: #f8fafc;

      .client-chat-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;

        .client-orig-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-left: 3px solid #0284c7;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 0.85rem;

          .card-head {
            display: flex;
            justify-content: space-between;
            color: #64748b;
            font-size: 0.72rem;
            margin-bottom: 4px;
            font-weight: 600;
          }

          .card-body-txt {
            color: #1e293b;
            white-space: pre-wrap;
          }
        }

        .client-chat-row {
          display: flex;
          align-items: flex-end;

          &.is-admin {
            justify-content: flex-start;
            .bubble {
              background: #0f172a;
              color: white;
              border-radius: 14px 14px 14px 4px;
              .bubble-meta { strong { color: #38bdf8; } small { color: #94a3b8; } }
            }
          }

          &.is-client {
            justify-content: flex-end;
            .bubble {
              background: #0284c7;
              color: white;
              border-radius: 14px 14px 4px 14px;
              .bubble-meta { strong { color: #bae6fd; } small { color: #e0f2fe; } }
            }
          }

          .bubble {
            max-width: 80%;
            padding: 8px 12px;
            font-size: 0.85rem;
            line-height: 1.4;
            word-break: break-word;

            .bubble-meta {
              display: flex;
              justify-content: space-between;
              gap: 10px;
              font-size: 0.7rem;
              margin-bottom: 3px;
            }

            .bubble-txt {
              margin: 0;
              white-space: pre-wrap;
            }
          }
        }

        .thumb-img {
          max-width: 100% !important;
          width: auto !important;
          max-height: 240px !important;
          border-radius: 8px;
          cursor: pointer;
          object-fit: contain;
          background: #f1f5f9;
          display: block;
          border: 1px solid rgba(0,0,0,0.1);
          transition: transform 0.15s;
          box-sizing: border-box;
          &:hover { transform: scale(1.01); }
        }
      }

      .client-chat-input-bar {
        background: white;
        padding: 10px 12px;
        border-top: 1px solid #e2e8f0;
        display: flex;
        gap: 8px;
        align-items: center;

        .btn-icon-attach {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 1rem;
          cursor: pointer;
          &:hover { background: #e2e8f0; }
        }

        .client-chat-input {
          flex: 1;
          padding: 7px 10px;
          border: 1.5px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.85rem;
          outline: none;
          &:focus { border-color: #0284c7; }
        }

        .btn-client-send {
          background: #0284c7;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 7px 14px;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          &:disabled { opacity: 0.6; cursor: not-allowed; }
        }
      }
    }

    /* Barra de Previsualización de Imagen (válida tanto para Chat como para Nuevo Ticket) */
    .client-preview-img-bar {
      background: #e0f2fe;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 100%;
      box-sizing: border-box;
      overflow: hidden;
      margin-top: 6px;

      img {
        width: 44px;
        height: 44px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
        border: 1px solid #0284c7;
      }

      .info {
        flex: 1;
        min-width: 0;
        font-size: 0.75rem;
        color: #0369a1;
        overflow: hidden;

        strong {
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        span {
          display: block;
          font-size: 0.7rem;
          color: #0284c7;
        }
      }

      .btn-del {
        background: #fee2e2;
        color: #dc2626;
        border: 1px solid #fca5a5;
        padding: 3px 8px;
        border-radius: 4px;
        font-weight: 700;
        font-size: 0.75rem;
        cursor: pointer;
        flex-shrink: 0;
        &:hover { background: #fecdd3; }
      }
    }

    .btn-attach-client-form {
      background: #f1f5f9;
      color: #334155;
      border: 1.5px dashed #cbd5e1;
      padding: 9px 14px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      justify-content: center;
      transition: all 0.15s;

      &:hover:not(:disabled) {
        background: #e0f2fe;
        border-color: #0284c7;
        color: #0284c7;
      }
    }

    .ticket-closed-notice {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #64748b;
      font-size: 0.82rem;

      .icon { font-size: 1.4rem; }
      strong { display: block; color: #334155; font-size: 0.88rem; }
      p { margin: 2px 0 0; }
      .btn-create-sub {
        margin-left: auto;
        background: #0284c7;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        font-weight: 700;
        font-size: 0.78rem;
        cursor: pointer;
        white-space: nowrap;
        &:hover { background: #0369a1; }
      }
    }

    /* Modal Lightbox para Ampliar Imagen del Cliente */
    .img-lightbox-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.88);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      padding: 20px;
      backdrop-filter: blur(4px);
      box-sizing: border-box;

      .lightbox-content {
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;

        img {
          max-width: 85vw !important;
          max-height: 80vh !important;
          width: auto !important;
          height: auto !important;
          object-fit: contain !important;
          border-radius: 10px;
          box-shadow: 0 12px 35px rgba(0, 0, 0, 0.6);
          display: block;
        }

        .btn-close-lightbox {
          position: absolute;
          top: -15px;
          right: -15px;
          background: #ef4444;
          color: white;
          border: 2px solid #ffffff;
          border-radius: 999px;
          width: 34px;
          height: 34px;
          font-size: 1.1rem;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
          transition: transform 0.15s, background 0.15s;

          &:hover {
            background: #dc2626;
            transform: scale(1.1);
          }
        }
      }
    }

    @media (max-width: 600px) {
      .modal-support-card {
        max-height: 94vh;
        border-radius: 12px;
      }

      .modal-support-header {
        padding: 10px 14px;
        h3 { font-size: 0.95rem; }
      }

      .modal-support-body {
        padding: 12px 14px;
      }

      .modal-support-footer {
        padding: 10px 14px;
        .btn-modal-primary, .btn-modal-secondary {
          flex: 1;
          justify-content: center;
        }
      }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes zoomIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
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
  public authService = inject(AuthService);
  public suscripcionService = inject(SuscripcionService);
  public soporteService = inject(SoporteService);
  private fb = inject(FirebaseService);
  private router = inject(Router);

  // Menú Desplegable de Ajustes & Gestión
  public menuAdminDesplegado = signal<boolean>(false);
  public esRutaAdminActiva = computed(() => {
    const url = this.router.url;
    return (
      url.startsWith('/socios') ||
      url.startsWith('/administracion') ||
      url.startsWith('/bitacora') ||
      url.startsWith('/configuracion')
    );
  });

  constructor() {
    // Si la ruta actual al inicializar es una de las opciones de administración, abrir desplegable
    if (this.esRutaAdminActiva()) {
      this.menuAdminDesplegado.set(true);
    }
  }

  alternarMenuAdmin(): void {
    this.menuAdminDesplegado.update((v) => !v);
  }

  // Estado del Modal de Soporte
  public modalSoporteAbierto = signal<boolean>(false);
  public vistaSoporte = signal<'NUEVO' | 'LISTA' | 'CHAT'>('LISTA');
  public enviandoTicket = signal<boolean>(false);
  public ticketGenerado = signal<string | null>(null);
  public errorTicket = signal<string>('');

  // Ticket Seleccionado para Chat
  public ticketSeleccionado = signal<TicketSoporte | null>(null);
  public ticketActivo = computed<TicketSoporte | null>(() => {
    const sel = this.ticketSeleccionado();
    if (!sel) return null;
    return this.soporteService.ticketsEmpresa().find(t => t.folio === sel.folio) || sel;
  });

  // Mensaje en Chat del Cliente
  public nuevoMensajeCliente = '';
  public imagenClienteBase64 = signal<string>('');
  public imagenClienteNombre = signal<string>('');
  public enviandoMensajeCliente = signal<boolean>(false);
  public procesandoImagenCliente = signal<boolean>(false);
  public modalImagenZoom = signal<string | null>(null);

  // Adjunto en Nueva Solicitud
  public imagenNuevoTicketBase64 = signal<string>('');
  public imagenNuevoTicketNombre = signal<string>('');
  public procesandoImagenNuevoTicket = signal<boolean>(false);

  // Formulario del Ticket
  public categoriaTicket = 'DUDA';
  public prioridadTicket = 'MEDIA';
  public telefonoTicket = '';
  public descripcionTicket = '';
  public calcularTamanioBase64 = calcularTamanioBase64;

  closeNav() {
    this.closeSidebar.emit();
  }

  abrirModalSoporte(): void {
    this.closeNav();
    this.modalSoporteAbierto.set(true);
    this.ticketGenerado.set(null);
    this.errorTicket.set('');
    this.descripcionTicket = '';
    const sub = this.suscripcionService.suscripcion();
    this.telefonoTicket = sub?.contactoTelefono || '';

    // Si ya tiene tickets registrados, mostrar la lista. Si no, ir directo a crear nuevo ticket
    if (this.soporteService.ticketsEmpresa().length > 0) {
      this.vistaSoporte.set('LISTA');
    } else {
      this.vistaSoporte.set('NUEVO');
    }
  }

  cerrarModalSoporte(): void {
    this.modalSoporteAbierto.set(false);
    this.ticketSeleccionado.set(null);
    this.nuevoMensajeCliente = '';
    this.imagenClienteBase64.set('');
    this.imagenNuevoTicketBase64.set('');
  }

  abrirChatTicket(ticket: TicketSoporte): void {
    this.ticketSeleccionado.set(ticket);
    this.vistaSoporte.set('CHAT');
    this.nuevoMensajeCliente = '';
    this.imagenClienteBase64.set('');
    this.imagenClienteNombre.set('');
    setTimeout(() => this.scrollClientChat(), 100);
  }

  volverAListaTickets(): void {
    this.vistaSoporte.set('LISTA');
    this.ticketSeleccionado.set(null);
  }

  async onSeleccionarImagenNuevoTicket(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.procesandoImagenNuevoTicket.set(true);
    try {
      const base64 = await comprimirImagen(file, { maxAncho: 1200, calidad: 0.75 });
      this.imagenNuevoTicketBase64.set(base64);
      this.imagenNuevoTicketNombre.set(file.name);
    } catch (e: any) {
      alert('Error al procesar la imagen: ' + (e.message || e));
    } finally {
      this.procesandoImagenNuevoTicket.set(false);
      input.value = '';
    }
  }

  quitarImagenNuevoTicket(): void {
    this.imagenNuevoTicketBase64.set('');
    this.imagenNuevoTicketNombre.set('');
  }

  async onSeleccionarImagenChat(event: Event): Promise<void> {
    const t = this.ticketActivo();
    if (t?.estado === 'CERRADO') {
      alert('Este ticket se encuentra cerrado. No es posible adjuntar imágenes.');
      return;
    }

    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.procesandoImagenCliente.set(true);
    try {
      const base64 = await comprimirImagen(file, { maxAncho: 1200, calidad: 0.75 });
      this.imagenClienteBase64.set(base64);
      this.imagenClienteNombre.set(file.name);
      setTimeout(() => this.scrollClientChat(), 60);
    } catch (e: any) {
      alert('Error al procesar la imagen: ' + (e.message || e));
    } finally {
      this.procesandoImagenCliente.set(false);
      input.value = '';
    }
  }

  quitarImagenChat(): void {
    this.imagenClienteBase64.set('');
    this.imagenClienteNombre.set('');
  }

  async enviarMensajeClienteChat(event?: Event): Promise<void> {
    if (event) event.preventDefault();

    const t = this.ticketActivo();
    if (!t) return;

    if (t.estado === 'CERRADO') {
      alert('Este ticket se encuentra cerrado. No es posible enviar más mensajes o archivos.');
      return;
    }

    const texto = this.nuevoMensajeCliente.trim();
    const imagen = this.imagenClienteBase64();

    if (!texto && !imagen) return;

    this.enviandoMensajeCliente.set(true);
    try {
      const user = this.authService.currentUser();
      const nombre = this.authService.nombreUsuario() || 'Cliente';

      await this.soporteService.enviarMensajeTicket(
        t.folio,
        {
          texto,
          imagenUrl: imagen,
          remitenteRol: 'CLIENTE',
          remitenteNombre: `👤 ${nombre}`,
          remitenteUid: user?.uid || 'CLIENTE'
        },
        t.estado === 'RESUELTO' ? 'EN_PROCESO' : undefined
      );

      this.nuevoMensajeCliente = '';
      this.imagenClienteBase64.set('');
      this.imagenClienteNombre.set('');
      setTimeout(() => this.scrollClientChat(), 80);
    } catch (e: any) {
      alert('Error al enviar mensaje: ' + (e.message || e));
    } finally {
      this.enviandoMensajeCliente.set(false);
    }
  }

  async enviarTicket(): Promise<void> {
    if (!this.descripcionTicket.trim()) {
      this.errorTicket.set('Por favor ingresa una descripción para tu solicitud.');
      return;
    }

    this.enviandoTicket.set(true);
    this.errorTicket.set('');

    try {
      const folio = 'TCK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const ticketRef = doc(this.fb.firestore, 'tickets_soporte', folio);

      const sub = this.suscripcionService.suscripcion();
      const user = this.authService.currentUser();

      const ticketData: TicketSoporte = {
        folio,
        empresaId: this.authService.getTenantId(),
        nombreNegocio: sub?.nombreNegocio || 'Mi Negocio',
        plan: sub?.plan || 'TRIAL',
        usuarioUid: user?.uid || '',
        usuarioEmail: user?.email || '',
        usuarioNombre: this.authService.nombreUsuario(),
        categoria: this.categoriaTicket,
        prioridad: this.prioridadTicket,
        telefono: this.telefonoTicket.trim() || sub?.contactoTelefono || '',
        descripcion: this.descripcionTicket.trim(),
        imagenAdjunta: this.imagenNuevoTicketBase64() || '',
        estado: 'ABIERTO',
        fechaCreacion: new Date().toISOString()
      };

      await setDoc(ticketRef, ticketData as any);
      this.ticketGenerado.set(folio);

      // Limpiar formulario y pasar directamente al chat del ticket creado
      this.descripcionTicket = '';
      this.imagenNuevoTicketBase64.set('');
      this.imagenNuevoTicketNombre.set('');

      this.ticketSeleccionado.set(ticketData);
      this.vistaSoporte.set('CHAT');
      setTimeout(() => this.scrollClientChat(), 100);
    } catch (e: any) {
      console.error('Error al enviar ticket:', e);
      this.errorTicket.set(e.message || 'No se pudo registrar el ticket. Intenta de nuevo.');
    } finally {
      this.enviandoTicket.set(false);
    }
  }

  verImagenGrande(url: string): void {
    this.modalImagenZoom.set(url);
  }

  cerrarImagenZoom(): void {
    this.modalImagenZoom.set(null);
  }

  scrollClientChat(): void {
    const el = document.getElementById('clientChatScroll');
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  abrirWhatsAppTicket(): void {
    const folio = this.ticketGenerado();
    const sub = this.suscripcionService.suscripcion();
    const negocio = sub?.nombreNegocio || 'Mi Negocio';
    const msg = `Hola Soporte Stockup, acabo de registrar el Ticket *#${folio}* para mi negocio *${negocio}*.\n\n*Categoría:* ${this.categoriaTicket}\n*Prioridad:* ${this.prioridadTicket}\n*Detalle:* ${this.descripcionTicket}`;
    const url = `https://wa.me/525563682544?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }
}
