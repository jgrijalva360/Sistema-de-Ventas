import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  output,
  signal,
  ElementRef,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Html5Qrcode, Html5QrcodeSupportedFormats, CameraDevice } from 'html5-qrcode';

@Component({
  selector: 'app-scanner-camara-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="scanner-backdrop" (click)="onBackdropClick($event)">
      <div class="scanner-modal-card">
        <!-- Encabezado -->
        <div class="scanner-header">
          <div class="scanner-title-group">
            <span class="icon-camera">📷</span>
            <div>
              <h3 class="scanner-title" style="display: flex; align-items: center; gap: 8px;">
                <span>Escanear Código</span>
                @if (contadorEscaneos() > 0) {
                  <span class="badge-count">{{ contadorEscaneos() }} escaneado(s)</span>
                }
              </h3>
              <p class="scanner-subtitle">Códigos de barras (EAN, UPC, Code 128) o QR</p>
            </div>
          </div>
          <button type="button" class="btn-close" (click)="cerrarModal()" title="Cerrar escáner">&times;</button>
        </div>

        <!-- Área de la Cámara y Visor -->
        <div class="scanner-body">
          @if (cargando()) {
            <div class="scanner-loading">
              <div class="spinner"></div>
              <span>Iniciando cámara...</span>
            </div>
          }

          @if (errorMensaje()) {
            <div class="scanner-error">
              <span class="error-icon">⚠️</span>
              <p class="error-text">{{ errorMensaje() }}</p>
              <button type="button" class="btn-retry" (click)="iniciarCamara()">
                🔄 Reintentar
              </button>
            </div>
          }

          <!-- Contenedor del video html5-qrcode -->
          <div [id]="elementId" class="scanner-viewport" [class.hidden]="!!errorMensaje() || cargando()"></div>

          <!-- Toast Flotante de Producto Detectado (Modo Continuo) -->
          @if (ultimoProductoEscaneado()) {
            <div class="scanner-toast-badge">
              ✓ Detectado: {{ ultimoProductoEscaneado() }}
            </div>
          }

          <!-- Guía visual superpuesta estilo visor láser -->
          @if (!errorMensaje() && !cargando()) {
            <div class="scanner-overlay-guide">
              <div class="reticle-box">
                <div class="corner corner-tl"></div>
                <div class="corner corner-tr"></div>
                <div class="corner corner-bl"></div>
                <div class="corner corner-br"></div>
                <div class="laser-line"></div>
              </div>
              <span class="guide-caption">Centra el código dentro del recuadro</span>
            </div>
          }
        </div>

        <!-- Barra de Controles Inferior -->
        <div class="scanner-footer">
          <!-- Toggle Modo Continuo / Ráfaga -->
          <button
            type="button"
            class="btn-control btn-modo-continuo"
            [class.active]="modoContinuo()"
            (click)="toggleModoContinuo()"
            title="Escanear múltiples productos sin cerrar la cámara entre cada uno"
          >
            {{ modoContinuo() ? '⚡ Continuo: ACTIVO' : '🔄 Modo Continuo' }}
          </button>

          <!-- Botón Linterna (si el hardware lo soporta) -->
          @if (soportaLinterna()) {
            <button
              type="button"
              class="btn-control"
              [class.active]="linternaActiva()"
              (click)="toggleLinterna()"
              title="Encender / Apagar linterna"
            >
              {{ linternaActiva() ? '🔦 Apagar Luz' : '💡 Linterna' }}
            </button>
          }

          <!-- Selector / Cambio de cámara si hay más de 1 -->
          @if (camaras().length > 1) {
            <button
              type="button"
              class="btn-control"
              (click)="cambiarCamara()"
              title="Cambiar de cámara"
            >
              🔄 Cambiar ({{ indiceCamaraActual() + 1 }}/{{ camaras().length }})
            </button>
          }

          @if (modoContinuo()) {
            <button type="button" class="btn-listo" (click)="cerrarModal()">
              ✓ Listo {{ contadorEscaneos() > 0 ? '(' + contadorEscaneos() + ')' : '' }}
            </button>
          } @else {
            <button type="button" class="btn-cancelar" (click)="cerrarModal()">
              Cancelar
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .scanner-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 16px;
      animation: fadeIn 0.2s ease-out;
    }

    .scanner-modal-card {
      background: #0f172a;
      color: white;
      width: 100%;
      max-width: 480px;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      flex-direction: column;
    }

    .scanner-header {
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      background: #1e293b;

      .scanner-title-group {
        display: flex;
        align-items: center;
        gap: 12px;

        .icon-camera {
          font-size: 1.5rem;
        }

        .scanner-title {
          margin: 0;
          font-size: 1.1rem;
          font-weight: 800;
          color: white;
          letter-spacing: -0.3px;
        }

        .scanner-subtitle {
          margin: 2px 0 0;
          font-size: 0.78rem;
          color: #94a3b8;
        }
      }

      .btn-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 1.8rem;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 8px;
        transition: all 0.15s;

        &:hover {
          color: white;
          background: rgba(255, 255, 255, 0.1);
        }
      }
    }

    .scanner-body {
      position: relative;
      background: #000;
      min-height: 320px;
      max-height: 60vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;

      .scanner-viewport {
        width: 100%;
        height: 100%;
        min-height: 320px;

        &.hidden {
          display: none;
        }

        /* Ocultar elementos generados por html5-qrcode que no sean el video */
        ::ng-deep img {
          display: none !important;
        }
        ::ng-deep video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          border-radius: 0 !important;
        }
      }

      .scanner-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        color: #94a3b8;
        font-size: 0.9rem;
        font-weight: 600;
        padding: 40px;

        .spinner {
          width: 44px;
          height: 44px;
          border: 4px solid rgba(255, 255, 255, 0.15);
          border-top-color: #0284c7;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      }

      .scanner-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 30px 20px;
        gap: 12px;

        .error-icon {
          font-size: 2.5rem;
        }

        .error-text {
          margin: 0;
          font-size: 0.88rem;
          color: #fca5a5;
          line-height: 1.4;
        }

        .btn-retry {
          margin-top: 8px;
          background: #0284c7;
          color: white;
          border: none;
          padding: 8px 18px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 700;
          cursor: pointer;

          &:hover {
            background: #0369a1;
          }
        }
      }

      /* Superposición de guía con esquinas y láser */
      .scanner-overlay-guide {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;

        .reticle-box {
          position: relative;
          width: 240px;
          height: 190px;
          border-radius: 14px;
          box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.4);

          .corner {
            position: absolute;
            width: 24px;
            height: 24px;
            border-color: #38bdf8;
            border-style: solid;
          }

          .corner-tl { top: -2px; left: -2px; border-width: 4px 0 0 4px; border-top-left-radius: 12px; }
          .corner-tr { top: -2px; right: -2px; border-width: 4px 4px 0 0; border-top-right-radius: 12px; }
          .corner-bl { bottom: -2px; left: -2px; border-width: 0 0 4px 4px; border-bottom-left-radius: 12px; }
          .corner-br { bottom: -2px; right: -2px; border-width: 0 4px 4px 0; border-bottom-right-radius: 12px; }

          .laser-line {
            position: absolute;
            left: 8px;
            right: 8px;
            height: 2px;
            background: linear-gradient(90deg, transparent, #38bdf8, #ef4444, #38bdf8, transparent);
            box-shadow: 0 0 8px #38bdf8, 0 0 12px #ef4444;
            animation: laserScan 2s ease-in-out infinite;
          }
        }

        .guide-caption {
          font-size: 0.78rem;
          font-weight: 700;
          color: white;
          background: rgba(15, 23, 42, 0.75);
          padding: 4px 12px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          letter-spacing: 0.2px;
        }
      }
    }

    .scanner-footer {
      padding: 14px 20px;
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: flex-end;
      background: #1e293b;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      flex-wrap: wrap;

      .btn-control {
        background: rgba(255, 255, 255, 0.08);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 0.84rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;

        &:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        &.active {
          background: #f59e0b;
          color: #000;
          border-color: #f59e0b;
        }
      }

      .btn-cancelar {
        background: transparent;
        color: #94a3b8;
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 0.84rem;
        font-weight: 700;
        cursor: pointer;
        margin-left: auto;

        &:hover {
          color: white;
          background: rgba(255, 255, 255, 0.08);
        }
      }

      .btn-listo {
        background: #10b981;
        color: white;
        border: 1px solid #059669;
        padding: 8px 18px;
        border-radius: 8px;
        font-size: 0.84rem;
        font-weight: 800;
        cursor: pointer;
        margin-left: auto;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        transition: all 0.15s;

        &:hover {
          background: #059669;
          transform: translateY(-1px);
        }
      }

      .btn-control.btn-modo-continuo.active {
        background: #10b981;
        color: white;
        border-color: #059669;
        box-shadow: 0 0 10px rgba(16, 185, 129, 0.45);
      }
    }

    .badge-count {
      background: #10b981;
      color: white;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 12px;
      display: inline-block;
      vertical-align: middle;
    }

    .scanner-toast-badge {
      position: absolute;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(16, 185, 129, 0.95);
      color: #fff;
      padding: 6px 18px;
      border-radius: 20px;
      font-size: 0.88rem;
      font-weight: 800;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      z-index: 50;
      animation: popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      white-space: nowrap;
      pointer-events: none;
    }

    @keyframes popIn {
      from { transform: translate(-50%, -10px) scale(0.9); opacity: 0; }
      to { transform: translate(-50%, 0) scale(1); opacity: 1; }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes laserScan {
      0%, 100% { top: 10%; opacity: 0.4; }
      50% { top: 85%; opacity: 1; }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `]
})
export class ScannerCamaraModalComponent implements OnInit, AfterViewInit, OnDestroy {
  public codigoEscaneado = output<string>();
  public cerrar = output<void>();

  public elementId = 'scanner-reader-' + Math.random().toString(36).substring(2, 9);

  public cargando = signal<boolean>(true);
  public errorMensaje = signal<string | null>(null);
  public camaras = signal<CameraDevice[]>([]);
  public indiceCamaraActual = signal<number>(0);
  public linternaActiva = signal<boolean>(false);
  public soportaLinterna = signal<boolean>(false);

  // Modo Continuo / Ráfaga para ventas de alta velocidad
  public modoContinuo = signal<boolean>(false);
  public contadorEscaneos = signal<number>(0);
  public ultimoProductoEscaneado = signal<string | null>(null);

  private html5QrCode: Html5Qrcode | null = null;
  private yaEscaneado = false;
  private ultimoCodigo = '';
  private ultimoTiempoEscaneo = 0;

  public toggleModoContinuo(): void {
    this.modoContinuo.update(v => !v);
  }

  ngOnInit(): void {}

  async ngAfterViewInit(): Promise<void> {
    await this.iniciarCamara();
  }

  async ngOnDestroy(): Promise<void> {
    await this.detenerScanner();
  }

  public async iniciarCamara(): Promise<void> {
    this.cargando.set(true);
    this.errorMensaje.set(null);
    this.yaEscaneado = false;

    // Los navegadores móviles bloquean la cámara en orígenes HTTP no locales
    if (
      typeof window !== 'undefined' &&
      !window.isSecureContext &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      this.cargando.set(false);
      this.errorMensaje.set(
        'Por seguridad web, los celulares bloquean la cámara en conexiones HTTP (sin SSL). Inicia el servidor con "ng serve --host 0.0.0.0 --ssl" para acceder por HTTPS.'
      );
      return;
    }

    try {
      // 1. Obtener lista de cámaras si es posible
      const dispositivos = await Html5Qrcode.getCameras();
      this.camaras.set(dispositivos || []);

      if (dispositivos && dispositivos.length > 0) {
        // Buscar cámara trasera por defecto
        const traseraIdx = dispositivos.findIndex(c =>
          c.label.toLowerCase().includes('back') ||
          c.label.toLowerCase().includes('trasera') ||
          c.label.toLowerCase().includes('rear') ||
          c.label.toLowerCase().includes('environment')
        );
        this.indiceCamaraActual.set(traseraIdx >= 0 ? traseraIdx : 0);
      }

      // 2. Instanciar Html5Qrcode
      if (!this.html5QrCode) {
        this.html5QrCode = new Html5Qrcode(this.elementId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF
          ],
          verbose: false,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          }
        });
      }

      // 3. Iniciar escaneo usando facingMode 'environment' o la cámara seleccionada
      const camId = this.camaras()[this.indiceCamaraActual()]?.id;
      const cameraConfig = camId ? camId : { facingMode: 'environment' };

      await this.html5QrCode.start(
        cameraConfig,
        {
          fps: 20,
          qrbox: (w, h) => {
            const minEdge = Math.min(w, h);
            return {
              width: Math.floor(Math.min(w * 0.88, minEdge * 0.95)),
              height: Math.floor(minEdge * 0.6)
            };
          },
          aspectRatio: undefined
        },
        (decodedText) => {
          this.procesarCodigoDetectado(decodedText);
        },
        () => {
          // Frame sin código, ciclo normal
        }
      );

      // Comprobar soporte de linterna / flash
      try {
        const capabilities = (this.html5QrCode as any).getRunningTrackCameraCapabilities?.();
        if (capabilities && capabilities.torchFeature) {
          this.soportaLinterna.set(capabilities.torchFeature().isSupported());
        }
      } catch {
        this.soportaLinterna.set(false);
      }

      this.cargando.set(false);
    } catch (err: any) {
      console.error('Error al inicializar cámara:', err);
      this.cargando.set(false);
      const msg = err?.message || String(err);
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        this.errorMensaje.set('Acceso a la cámara denegado. Concede permiso de cámara en tu navegador móvil para escanear.');
      } else if (msg.includes('NotFoundError') || msg.includes('DevicesNotFoundError')) {
        this.errorMensaje.set('No se encontró ninguna cámara disponible en este dispositivo.');
      } else {
        this.errorMensaje.set('No se pudo acceder a la cámara. Revisa los permisos y vuelve a intentar.');
      }
    }
  }

  public async cambiarCamara(): Promise<void> {
    const total = this.camaras().length;
    if (total <= 1) return;

    const proxIdx = (this.indiceCamaraActual() + 1) % total;
    this.indiceCamaraActual.set(proxIdx);

    await this.detenerScanner();
    await this.iniciarCamara();
  }

  public async toggleLinterna(): Promise<void> {
    if (!this.html5QrCode) return;
    try {
      const nuevoEstado = !this.linternaActiva();
      await (this.html5QrCode as any).applyVideoConstraints({
        advanced: [{ torch: nuevoEstado }]
      });
      this.linternaActiva.set(nuevoEstado);
    } catch (e) {
      console.warn('Linterna no soportada o falló:', e);
    }
  }

  private procesarCodigoDetectado(codigo: string): void {
    const codLimpio = (codigo || '').trim();
    if (!codLimpio) return;

    if (this.modoContinuo()) {
      const now = Date.now();
      // Debounce: evitar lecturas duplicadas en ráfaga del mismo código en menos de 1.8 segundos
      if (this.ultimoCodigo === codLimpio && (now - this.ultimoTiempoEscaneo) < 1800) {
        return;
      }
      this.ultimoCodigo = codLimpio;
      this.ultimoTiempoEscaneo = now;
      this.contadorEscaneos.update((c) => c + 1);

      this.ultimoProductoEscaneado.set(codLimpio);
      setTimeout(() => {
        if (this.ultimoProductoEscaneado() === codLimpio) {
          this.ultimoProductoEscaneado.set(null);
        }
      }, 2200);

      this.reproducirBeep();
      this.vibrar();

      // Emitir el código al componente sin detener el visor de la cámara
      this.codigoEscaneado.emit(codLimpio);
    } else {
      if (this.yaEscaneado) return;
      this.yaEscaneado = true;

      this.reproducirBeep();
      this.vibrar();

      // Detener escáner y emitir código y cierre
      this.detenerScanner().finally(() => {
        this.codigoEscaneado.emit(codLimpio);
        this.cerrar.emit();
      });
    }
  }

  public async detenerScanner(): Promise<void> {
    if (this.html5QrCode) {
      try {
        if (this.html5QrCode.isScanning) {
          await this.html5QrCode.stop();
        }
        this.html5QrCode.clear();
      } catch (e) {
        console.warn('Error al detener scanner:', e);
      }
    }
  }

  public cerrarModal(): void {
    this.detenerScanner().finally(() => {
      this.cerrar.emit();
    });
  }

  public onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('scanner-backdrop')) {
      this.cerrarModal();
    }
  }

  private reproducirBeep(): void {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, audioCtx.currentTime); // C6
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch {}
  }

  private vibrar(): void {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([100]);
      }
    } catch {}
  }
}
