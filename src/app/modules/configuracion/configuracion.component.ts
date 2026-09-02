import { Component, signal, inject, effect, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfiguracionService } from '../../core/services/configuracion.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { SyncService } from '../../core/services/sync.service';
import { AuthService } from '../../core/services/auth.service';
import { MovimientosService } from '../../core/services/movimientos.service';
import { VentasService } from '../../core/services/ventas.service';
import { PedidosService, AnalisisConsolidacion } from '../../core/services/pedidos.service';
import { Sucursal } from '../../core/models/models';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.scss'
})
export class ConfiguracionComponent implements AfterViewInit {
  @ViewChild('bizNameInputRef') bizNameInputRef?: ElementRef<HTMLInputElement>;

  public configuracionService = inject(ConfiguracionService);
  public sucursalesService = inject(SucursalesService);
  public syncService = inject(SyncService);
  public movimientosService = inject(MovimientosService);
  public ventasService = inject(VentasService);
  public pedidosService = inject(PedidosService);
  private authService = inject(AuthService);

  // Form Negocio (sincronizado reactivamente)
  public bizName = '';
  public bizPhone = '';
  public fiscalLegend = '';

  ngAfterViewInit(): void {
    setTimeout(() => this.bizNameInputRef?.nativeElement.focus(), 100);
  }

  constructor() {
    effect(() => {
      const conf = this.configuracionService.config();
      this.bizName = conf.businessName || '';
      this.bizPhone = conf.businessPhone || '';
      this.fiscalLegend = conf.fiscalLegend || '';
    });
  }

  // Dispositivo
  public nombreDispositivo = this.syncService.getNombreDispositivoLocal();

  // Password
  public passActual = '';
  public passNueva = '';
  public passConfirmar = '';

  // Modal Sucursal
  public modalSucursalAbierto = signal<boolean>(false);
  public sucursalEditando = signal<Sucursal | null>(null);
  public sucursalNombre = '';
  public sucursalDireccion = '';
  public sucursalTelefono = '';

  // Modal Restauración Granular de Backup
  public modalRestaurarAbierto = signal<boolean>(false);
  public resumenBackup = signal<{
    fileName: string;
    data: any;
    fecha?: string;
    appVersion?: string;
    productosCount: number;
    ventasCount: number;
    movimientosCount: number;
    gastosCount: number;
    cortesCount: number;
    pedidosCount: number;
    sucursalesCount: number;
    bitacoraCount: number;
    hasConfig: boolean;
  } | null>(null);

  public optProductos = signal<boolean>(true);
  public optVentas = signal<boolean>(true);
  public optMovimientos = signal<boolean>(true);
  public optGastos = signal<boolean>(true);
  public optCortes = signal<boolean>(true);
  public optPedidos = signal<boolean>(true);
  public optSucursales = signal<boolean>(true);
  public optConfiguracion = signal<boolean>(true);
  public optBitacora = signal<boolean>(true);
  public restaurandoBackup = signal<boolean>(false);

  async guardarNegocio(): Promise<void> {
    await this.configuracionService.guardarConfiguracion({
      businessName: this.bizName,
      businessPhone: this.bizPhone,
      fiscalLegend: this.fiscalLegend
    });
    alert('Configuración comercial actualizada.');
  }

  guardarNombreDispositivo(): void {
    this.syncService.setNombreDispositivoLocal(this.nombreDispositivo);
    alert(`Nombre de dispositivo guardado: ${this.nombreDispositivo}`);
  }

  async cambiarPassword(): Promise<void> {
    if (!this.passActual || !this.passNueva || !this.passConfirmar) {
      alert('Por favor completa todos los campos de contraseña.');
      return;
    }
    if (this.passNueva.length < 6) {
      alert('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (this.passNueva !== this.passConfirmar) {
      alert('Las contraseñas no coinciden. Por favor verifica que la nueva contraseña y su confirmación sean idénticas.');
      return;
    }

    try {
      await this.authService.changePassword(this.passActual, this.passNueva);
      alert('✅ Contraseña actualizada correctamente.');
      this.passActual = '';
      this.passNueva = '';
      this.passConfirmar = '';
    } catch (e: any) {
      alert('❌ Error al cambiar contraseña: ' + (e.message || e));
    }
  }

  abrirModalSucursal(): void {
    this.sucursalEditando.set(null);
    this.sucursalNombre = '';
    this.sucursalDireccion = '';
    this.sucursalTelefono = '';
    this.modalSucursalAbierto.set(true);
  }

  editarSucursal(suc: Sucursal): void {
    this.sucursalEditando.set(suc);
    this.sucursalNombre = suc.nombre;
    this.sucursalDireccion = suc.direccion;
    this.sucursalTelefono = suc.telefono;
    this.modalSucursalAbierto.set(true);
  }

  async guardarSucursalModal(): Promise<void> {
    if (!this.sucursalNombre) return;

    const editando = this.sucursalEditando();
    const nueva: Sucursal = {
      id: editando ? editando.id : `SUC-${Date.now()}`,
      nombre: this.sucursalNombre,
      direccion: this.sucursalDireccion,
      telefono: this.sucursalTelefono,
      esMatriz: editando ? editando.esMatriz : false
    };

    await this.sucursalesService.agregarOEditarSucursal(nueva);
    this.modalSucursalAbierto.set(false);
  }

  async eliminarSucursal(id: string): Promise<void> {
    if (confirm('¿Eliminar esta sucursal?')) {
      await this.sucursalesService.eliminarSucursal(id);
    }
  }

  // ── Restauración de Respaldo ────────────────────────────────
  async onRestaurarFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const archivo = input.files[0];
      try {
        const resumen = await this.configuracionService.analizarArchivoBackup(archivo);
        this.resumenBackup.set(resumen);

        // Preseleccionar todo por defecto
        this.optProductos.set(resumen.productosCount > 0);
        this.optVentas.set(resumen.ventasCount > 0);
        this.optMovimientos.set(resumen.movimientosCount > 0);
        this.optGastos.set(resumen.gastosCount > 0);
        this.optCortes.set(resumen.cortesCount > 0);
        this.optPedidos.set(resumen.pedidosCount > 0);
        this.optSucursales.set(resumen.sucursalesCount > 0);
        this.optConfiguracion.set(resumen.hasConfig);

        this.modalRestaurarAbierto.set(true);
        input.value = '';
      } catch (e: any) {
        console.error('Error al analizar archivo de respaldo:', e);
        alert('❌ El archivo seleccionado no es un respaldo JSON válido: ' + (e.message || e));
        input.value = '';
      }
    }
  }

  seleccionarTodoBackup(): void {
    const res = this.resumenBackup();
    if (!res) return;
    this.optProductos.set(res.productosCount > 0);
    this.optVentas.set(res.ventasCount > 0);
    this.optMovimientos.set(res.movimientosCount > 0);
    this.optGastos.set(res.gastosCount > 0);
    this.optCortes.set(res.cortesCount > 0);
    this.optPedidos.set(res.pedidosCount > 0);
    this.optSucursales.set(res.sucursalesCount > 0);
    this.optConfiguracion.set(res.hasConfig);
    this.optBitacora.set((res.bitacoraCount || 0) > 0);
  }

  deseleccionarTodoBackup(): void {
    this.optProductos.set(false);
    this.optVentas.set(false);
    this.optMovimientos.set(false);
    this.optGastos.set(false);
    this.optCortes.set(false);
    this.optPedidos.set(false);
    this.optSucursales.set(false);
    this.optConfiguracion.set(false);
    this.optBitacora.set(false);
  }

  seleccionarSoloProductosBackup(): void {
    this.deseleccionarTodoBackup();
    this.optProductos.set(true);
  }

  seleccionarSoloOperacionesBackup(): void {
    const res = this.resumenBackup();
    if (!res) return;
    this.deseleccionarTodoBackup();
    this.optVentas.set(res.ventasCount > 0);
    this.optGastos.set(res.gastosCount > 0);
    this.optCortes.set(res.cortesCount > 0);
    this.optPedidos.set(res.pedidosCount > 0);
    this.optMovimientos.set(res.movimientosCount > 0);
    this.optBitacora.set((res.bitacoraCount || 0) > 0);
  }

  hayModulosSeleccionados(): boolean {
    return (
      this.optProductos() ||
      this.optVentas() ||
      this.optMovimientos() ||
      this.optGastos() ||
      this.optCortes() ||
      this.optPedidos() ||
      this.optSucursales() ||
      this.optConfiguracion() ||
      this.optBitacora()
    );
  }

  async ejecutarRestauracion(): Promise<void> {
    const res = this.resumenBackup();
    if (!res || !this.hayModulosSeleccionados() || this.restaurandoBackup()) return;

    this.restaurandoBackup.set(true);
    try {
      const opciones = {
        restaurarProductos: this.optProductos(),
        restaurarVentas: this.optVentas(),
        restaurarMovimientos: this.optMovimientos(),
        restaurarGastos: this.optGastos(),
        restaurarCortes: this.optCortes(),
        restaurarPedidos: this.optPedidos(),
        restaurarSucursales: this.optSucursales(),
        restaurarConfiguracion: this.optConfiguracion(),
        restaurarBitacora: this.optBitacora()
      };

      const resultado = await this.configuracionService.restaurarBackupSeleccionado(res.data, opciones);

      let mensaje = '✅ Respaldo restaurado con éxito:\n\n';
      if (opciones.restaurarProductos) mensaje += `• Productos: ${resultado.productosCount}\n`;
      if (opciones.restaurarVentas) mensaje += `• Ventas: ${resultado.ventasCount}\n`;
      if (opciones.restaurarMovimientos) mensaje += `• Movimientos: ${resultado.movimientosCount}\n`;
      if (opciones.restaurarGastos) mensaje += `• Gastos: ${resultado.gastosCount}\n`;
      if (opciones.restaurarCortes) mensaje += `• Cortes: ${resultado.cortesCount}\n`;
      if (opciones.restaurarPedidos) mensaje += `• Pedidos: ${resultado.pedidosCount}\n`;
      if (opciones.restaurarSucursales) mensaje += `• Sucursales: ${resultado.sucursalesCount}\n`;
      if (opciones.restaurarBitacora) mensaje += `• Bitácora: ${resultado.bitacoraCount}\n`;
      if (opciones.restaurarConfiguracion) mensaje += `• Configuración: Actualizada\n`;

      alert(mensaje);
      this.modalRestaurarAbierto.set(false);
      window.location.reload();
    } catch (e: any) {
      console.error('Error al restaurar respaldo:', e);
      alert('❌ Error al procesar el archivo de respaldo: ' + (e.message || e));
    } finally {
      this.restaurandoBackup.set(false);
    }
  }

  async resetPeriodico(tipo: 'simplificar_movimientos' | 'reset_operativo' | 'reset_total'): Promise<void> {
    let msg = 'Se descargará un respaldo automático y se ejecutará la acción. ¿Desea continuar?';
    if (tipo === 'reset_total') {
      msg = '⚠️ ATENCIÓN: Se descargará un respaldo de seguridad previo y se ELIMINARÁN PERMANENTEMENTE todos los datos de Firestore asociados a este usuario (Productos, Ventas, Gastos, Movimientos, Cortes y Pedidos).\n\n¿Estás seguro de realizar el Reset Total de Fábrica?';
    } else if (tipo === 'reset_operativo') {
      msg = '⚠️ RESET OPERATIVO:\n\n' +
        'Se descargará un respaldo automático y se realizarán los siguientes ajustes:\n\n' +
        '• Se ELIMINARÁN todas las ventas (historial y en espera), gastos y cortes de caja.\n' +
        '• Se CONSERVARÁN únicamente los Pedidos que se encuentren PENDIENTES o en proceso.\n' +
        '• Se limpiará el historial de movimientos de inventario sin afectar el stock actual.\n' +
        '• Tu catálogo de productos, existencias y precios se mantendrán intactos.\n\n' +
        '¿Estás seguro de continuar con el Reset Operativo?';
    }

    if (confirm(msg)) {
      await this.configuracionService.realizarResetPeriodico(tipo);
    }
  }

  async depurarMovimientosDuplicados(): Promise<void> {
    if (confirm('¿Deseas validar y eliminar los movimientos duplicados en la base de datos basándose en la fecha e identificadores?')) {
      try {
        const res = await this.movimientosService.depurarMovimientosDuplicados();
        if (res.duplicadosEliminados > 0) {
          alert(`✅ Se eliminaron ${res.duplicadosEliminados} movimiento(s) duplicado(s) de la base de datos.\nTotal actual de movimientos limpios: ${res.totalLimpios}`);
        } else {
          alert('✨ No se encontraron movimientos duplicados. La base de datos está limpia.');
        }
      } catch (e: any) {
        alert('❌ Error al depurar movimientos: ' + (e.message || e));
      }
    }
  }

  async depurarVentasDuplicadas(): Promise<void> {
    if (confirm('¿Deseas validar y eliminar ventas duplicadas en la base de datos basándote en ID y datos idénticos?')) {
      try {
        const res = await this.ventasService.depurarVentasDuplicadas();
        if (res.duplicadosEliminados > 0) {
          alert(`✅ Se eliminaron ${res.duplicadosEliminados} venta(s) duplicada(s) de la base de datos.\nTotal actual de ventas limpias: ${res.totalLimpios}`);
        } else {
          alert('✨ No se encontraron ventas duplicadas. La base de datos está limpia.');
        }
      } catch (e: any) {
        alert('❌ Error al depurar ventas: ' + (e.message || e));
      }
    }
  }

  // Modal de Previsualización y Consolidación de Abonos en Ventas
  public modalConsolidarAbierto = signal<boolean>(false);
  public analisisConsolidacion = signal<AnalisisConsolidacion | null>(null);
  public aplicandoConsolidacion = signal<boolean>(false);

  abrirModalConsolidar(): void {
    const analisis = this.pedidosService.analizarAbonosPendientesDeConsolidar();
    this.analisisConsolidacion.set(analisis);
    this.modalConsolidarAbierto.set(true);
  }

  async confirmarConsolidacion(): Promise<void> {
    const analisis = this.analisisConsolidacion();
    if (!analisis || analisis.ventasNuevas.length === 0) {
      this.modalConsolidarAbierto.set(false);
      return;
    }

    try {
      this.aplicandoConsolidacion.set(true);
      const agregadas = await this.pedidosService.aplicarConsolidacionVentas(
        analisis.ventasNuevas.map((v) => v.ventaCompleta)
      );

      alert(
        `✅ Consolidación aplicada exitosamente:\n\n` +
        `• Se registraron ${agregadas} venta(s) correspondientes a abonos y anticipos.\n` +
        `• Monto total consolidado: $${analisis.montoTotalNuevas.toFixed(2)} MXN\n\n` +
        `El dinero ya se encuentra reflejado en tus ingresos y balances.`
      );
      this.modalConsolidarAbierto.set(false);
    } catch (e: any) {
      alert('❌ Error al aplicar consolidación: ' + (e.message || e));
    } finally {
      this.aplicandoConsolidacion.set(false);
    }
  }

  consolidarAbonosPedidos(): void {
    this.abrirModalConsolidar();
  }
}
