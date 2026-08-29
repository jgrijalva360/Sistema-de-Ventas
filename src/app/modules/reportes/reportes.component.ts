import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { ReportesService } from '../../core/services/reportes.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { getFechaLocalString } from '../../shared/utils/date.util';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.scss'
})
export class ReportesComponent implements AfterViewInit {
  @ViewChild('repTipoRef') repTipoRef?: ElementRef<HTMLSelectElement>;

  public tipoReporte = signal<string>('GLOBAL');
  public fechaDesde = signal<string>(getFechaLocalString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  public fechaHasta = signal<string>(getFechaLocalString());
  public sucursalSeleccionada = signal<string>('TODAS');

  private reportesService = inject(ReportesService);
  public sucursalesService = inject(SucursalesService);

  ngAfterViewInit(): void {
    setTimeout(() => this.repTipoRef?.nativeElement.focus(), 100);
  }

  // 1. Filtrados principales
  public ventasFiltradas = computed(() => {
    return this.reportesService.filtrarVentas(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public pedidosFiltrados = computed(() => {
    return this.reportesService.filtrarPedidos(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public cobrosPedidosFiltrados = computed(() => {
    return this.reportesService.obtenerCobrosPedidos(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public gastosFiltrados = computed(() => {
    return this.reportesService.filtrarGastos(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public cortesFiltrados = computed(() => {
    return this.reportesService.filtrarCortes(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  // 2. Métricas de Ventas de Mostrador
  public totalVentasCalculado = computed(() => {
    return this.ventasFiltradas().reduce((acc, v) => acc + (v.total || 0), 0);
  });

  public totalVentasEfectivo = computed(() => {
    return this.ventasFiltradas().reduce((acc, v) => acc + (v.pagos?.efectivo || 0), 0);
  });

  public totalVentasTarjeta = computed(() => {
    return this.ventasFiltradas().reduce((acc, v) => acc + (v.pagos?.tarjeta || 0), 0);
  });

  public totalVentasTransferencia = computed(() => {
    return this.ventasFiltradas().reduce((acc, v) => acc + (v.pagos?.transferencia || 0), 0);
  });

  // 3. Métricas de Pedidos (Cobros en el periodo)
  public totalPedidosCobrado = computed(() => {
    return this.cobrosPedidosFiltrados().reduce((acc, c) => acc + (c.monto || 0), 0);
  });

  public totalPedidosEfectivo = computed(() => {
    return this.cobrosPedidosFiltrados()
      .filter((c) => c.metodoPago === 'EFECTIVO')
      .reduce((acc, c) => acc + c.monto, 0);
  });

  public totalPedidosTarjeta = computed(() => {
    return this.cobrosPedidosFiltrados()
      .filter((c) => c.metodoPago === 'TARJETA')
      .reduce((acc, c) => acc + c.monto, 0);
  });

  public totalPedidosTransferencia = computed(() => {
    return this.cobrosPedidosFiltrados()
      .filter((c) => c.metodoPago === 'TRANSFERENCIA')
      .reduce((acc, c) => acc + c.monto, 0);
  });

  public totalPedidosAcordado = computed(() => {
    return this.pedidosFiltrados().reduce((acc, p) => acc + (p.totalAcordado || 0), 0);
  });

  public totalPedidosSaldoPendiente = computed(() => {
    return this.pedidosFiltrados().reduce((acc, p) => acc + (p.saldoRestante || 0), 0);
  });

  // 4. Métricas de Gastos
  public totalGastosCalculado = computed(() => {
    return this.gastosFiltrados().reduce((acc, g) => acc + (g.monto || 0), 0);
  });

  public totalGastosEfectivo = computed(() => {
    return this.gastosFiltrados()
      .filter((g) => (g.metodoPago || '').toUpperCase() === 'EFECTIVO')
      .reduce((acc, g) => acc + g.monto, 0);
  });

  public totalGastosBanco = computed(() => {
    return this.gastosFiltrados()
      .filter((g) => ['TARJETA', 'TRANSFERENCIA'].includes((g.metodoPago || '').toUpperCase()))
      .reduce((acc, g) => acc + g.monto, 0);
  });

  // 5. Métricas Globales Consolidadas (Ventas vs Gastos)
  public totalGlobalIngresos = computed(() => {
    return this.totalVentasCalculado();
  });

  public totalGlobalEfectivo = computed(() => {
    return this.totalVentasEfectivo();
  });

  public totalGlobalTarjeta = computed(() => {
    return this.totalVentasTarjeta();
  });

  public totalGlobalTransferencia = computed(() => {
    return this.totalVentasTransferencia();
  });

  public balanceNetoCalculado = computed(() => {
    return this.totalGlobalIngresos() - this.totalGastosCalculado();
  });

  // 6. Lista unificada de transacciones / movimientos para el reporte global
  public movimientosGlobales = computed(() => {
    const movs: Array<{
      tipo: 'VENTA' | 'PEDIDO' | 'GASTO';
      id: string;
      fecha: string;
      descripcion: string;
      contacto: string;
      sucursalNombre: string;
      metodoPago: string;
      ingreso: number;
      egreso: number;
    }> = [];

    this.ventasFiltradas().forEach((v) => {
      const metodos: string[] = [];
      if (v.pagos?.efectivo) metodos.push('Efectivo');
      if (v.pagos?.tarjeta) metodos.push('Tarjeta');
      if (v.pagos?.transferencia) metodos.push('Transferencia');

      const itemsDesc = (v.items && v.items.length > 0)
        ? v.items.map((i) => `${i.cantidad}x ${i.nombre || 'Producto'}`).join(', ')
        : 'Venta Mostrador';

      movs.push({
        tipo: 'VENTA',
        id: v.id,
        fecha: v.fecha,
        descripcion: itemsDesc,
        contacto: v.usuario || 'Cajero',
        sucursalNombre: v.sucursalNombre || 'Principal',
        metodoPago: metodos.length > 0 ? metodos.join(' + ') : 'Efectivo',
        ingreso: v.total || 0,
        egreso: 0
      });
    });

    this.gastosFiltrados().forEach((g) => {
      let metodoCompleto = g.metodoPago || 'Efectivo';
      const mUpper = (g.metodoPago || '').toUpperCase();
      if (mUpper === 'EFECTIVO') metodoCompleto = 'Efectivo';
      else if (mUpper === 'TARJETA') metodoCompleto = 'Tarjeta';
      else if (mUpper === 'TRANSFERENCIA') metodoCompleto = 'Transferencia';

      movs.push({
        tipo: 'GASTO',
        id: g.id,
        fecha: g.fecha,
        descripcion: `${g.concepto} (${g.categoria})`,
        contacto: g.persona || '-',
        sucursalNombre: g.sucursalNombre || 'Principal',
        metodoPago: metodoCompleto,
        ingreso: 0,
        egreso: g.monto || 0
      });
    });

    return movs.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  });

  setRangoRapido(tipo: 'HOY' | '7_DIAS' | 'ESTE_MES' | 'TODO'): void {
    const ahora = new Date();
    const hoy = getFechaLocalString(ahora);
    this.fechaHasta.set(hoy);

    if (tipo === 'HOY') {
      this.fechaDesde.set(hoy);
    } else if (tipo === '7_DIAS') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      this.fechaDesde.set(getFechaLocalString(d));
    } else if (tipo === 'ESTE_MES') {
      this.fechaDesde.set(getFechaLocalString(new Date(ahora.getFullYear(), ahora.getMonth(), 1)));
    } else if (tipo === 'TODO') {
      this.fechaDesde.set('2020-01-01');
    }
  }

  formatearFechaLocal(isoDate: string | null | undefined): string {
    if (!isoDate) return '-';
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  exportarCSV(): void {
    const sufijoArchivo = `${this.fechaDesde()}_${this.fechaHasta()}`;

    if (this.tipoReporte() === 'GLOBAL') {
      const headers = ['Tipo', 'Folio / Ref', 'Fecha y Hora (Local)', 'Descripción / Productos', 'Cliente / Contacto', 'Sucursal', 'Método Pago', 'Ingreso (+)', 'Egreso (-)'];
      const rows = this.movimientosGlobales().map((m) => [
        m.tipo,
        m.id,
        this.formatearFechaLocal(m.fecha),
        m.descripcion,
        m.contacto,
        m.sucursalNombre,
        m.metodoPago,
        m.ingreso > 0 ? m.ingreso.toFixed(2) : '0.00',
        m.egreso > 0 ? m.egreso.toFixed(2) : '0.00'
      ]);
      this.reportesService.exportarCSV(`Reporte_Global_Consolidado_${sufijoArchivo}`, headers, rows);
    } else if (this.tipoReporte() === 'VENTAS') {
      const headers = ['Folio', 'Fecha y Hora (Local)', 'Sucursal', 'Cajero', 'Productos Vendidos', 'Cant. Ítems', 'Total', 'Efectivo', 'Tarjeta', 'Transferencia'];
      const rows = this.ventasFiltradas().map((v) => [
        v.id,
        this.formatearFechaLocal(v.fecha),
        v.sucursalNombre,
        v.usuario || '',
        (v.items || []).map((i) => `${i.cantidad}x ${i.nombre} ($${(i.subtotal || (i.cantidad * i.precioUnitario) || 0).toFixed(2)})`).join(' | ') || 'Sin detalle',
        String(v.items?.length || 0),
        (v.total || 0).toFixed(2),
        (v.pagos?.efectivo || 0).toFixed(2),
        (v.pagos?.tarjeta || 0).toFixed(2),
        (v.pagos?.transferencia || 0).toFixed(2)
      ]);
      this.reportesService.exportarCSV(`Reporte_Ventas_${sufijoArchivo}`, headers, rows);
    } else if (this.tipoReporte() === 'PEDIDOS') {
      const headers = ['Folio', 'Cliente', 'Teléfono', 'Fecha Registro (Local)', 'Fecha Entrega (Local)', 'Productos / Insumos', 'Estado', 'Sucursal', 'Total Acordado', 'Cobrado / Anticipo', 'Saldo Restante'];
      const rows = this.pedidosFiltrados().map((p) => [
        p.id,
        p.clienteNombre,
        p.clienteTelefono || '',
        this.formatearFechaLocal(p.fechaRegistro),
        p.fechaEntrega ? this.formatearFechaLocal(p.fechaEntrega) : 'Sin fecha',
        (p.materiasPrimas || []).map((m) => `${m.cantidad}x ${m.nombre}`).join(' | ') || p.especificaciones || 'Sin detalle',
        p.estado,
        p.sucursalNombre,
        (p.totalAcordado || 0).toFixed(2),
        (p.anticipo || 0).toFixed(2),
        (p.saldoRestante || 0).toFixed(2)
      ]);
      this.reportesService.exportarCSV(`Reporte_Pedidos_${sufijoArchivo}`, headers, rows);
    } else if (this.tipoReporte() === 'GASTOS') {
      const headers = ['ID', 'Fecha y Hora (Local)', 'Concepto', 'Categoría', 'Método Pago', 'Persona', 'Sucursal', 'Monto'];
      const rows = this.gastosFiltrados().map((g) => [
        g.id,
        this.formatearFechaLocal(g.fecha),
        g.concepto,
        g.categoria,
        g.metodoPago,
        g.persona || '',
        g.sucursalNombre,
        (g.monto || 0).toFixed(2)
      ]);
      this.reportesService.exportarCSV(`Reporte_Gastos_${sufijoArchivo}`, headers, rows);
    } else if (this.tipoReporte() === 'CORTES') {
      const headers = ['Folio', 'Fecha Apertura (Local)', 'Fecha Cierre (Local)', 'Usuario', 'Sucursal', 'Caja Inicial', 'Ventas Netas', 'Gastos', 'Caja Esperada', 'Caja Contada', 'Diferencia'];
      const rows = this.cortesFiltrados().map((c) => [
        c.id,
        this.formatearFechaLocal(c.fechaApertura),
        this.formatearFechaLocal(c.fechaCierre),
        c.usuario,
        c.sucursalNombre,
        (c.cajaInicial || 0).toFixed(2),
        (c.totalVentasNetas || 0).toFixed(2),
        (c.totalGastos || 0).toFixed(2),
        (c.cajaEsperada || 0).toFixed(2),
        (c.cajaContada || 0).toFixed(2),
        (c.diferencia || 0).toFixed(2)
      ]);
      this.reportesService.exportarCSV(`Reporte_Cortes_${sufijoArchivo}`, headers, rows);
    }
  }
}

