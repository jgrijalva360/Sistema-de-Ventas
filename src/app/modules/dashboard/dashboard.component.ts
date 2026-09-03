import { Component, inject, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { VentasService } from '../../core/services/ventas.service';
import { GastosService } from '../../core/services/gastos.service';
import { ProductosService } from '../../core/services/productos.service';
import { CortesService } from '../../core/services/cortes.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { PedidosService } from '../../core/services/pedidos.service';
import { PedidoPersonalizado } from '../../core/models/models';
import { getFechaLocalString } from '../../shared/utils/date.util';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, CurrencyMxnPipe, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  public ventasService = inject(VentasService);
  public gastosService = inject(GastosService);
  public productosService = inject(ProductosService);
  public cortesService = inject(CortesService);
  public sucursalesService = inject(SucursalesService);
  public pedidosService = inject(PedidosService);

  public mostrarValores = signal<boolean>(true);

  // Filtros de fecha / periodo
  public periodo = signal<'HOY' | 'AYER' | 'ESTA_SEMANA' | 'ESTE_MES' | 'MES_ANTERIOR' | 'PERSONALIZADO' | 'TODO'>('HOY');
  public fechaDesde = signal<string>(getFechaLocalString());
  public fechaHasta = signal<string>(getFechaLocalString());

  public toggleMostrarValores(): void {
    this.mostrarValores.update((v) => !v);
  }

  public setPeriodo(tipo: 'HOY' | 'AYER' | 'ESTA_SEMANA' | 'ESTE_MES' | 'MES_ANTERIOR' | 'PERSONALIZADO' | 'TODO'): void {
    this.periodo.set(tipo);
    const ahora = new Date();
    const hoy = getFechaLocalString(ahora);

    if (tipo === 'HOY') {
      this.fechaDesde.set(hoy);
      this.fechaHasta.set(hoy);
    } else if (tipo === 'AYER') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const ayer = getFechaLocalString(d);
      this.fechaDesde.set(ayer);
      this.fechaHasta.set(ayer);
    } else if (tipo === 'ESTA_SEMANA') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      this.fechaDesde.set(getFechaLocalString(d));
      this.fechaHasta.set(hoy);
    } else if (tipo === 'ESTE_MES') {
      const primerDia = getFechaLocalString(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
      this.fechaDesde.set(primerDia);
      this.fechaHasta.set(hoy);
    } else if (tipo === 'MES_ANTERIOR') {
      const primerDia = getFechaLocalString(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));
      const ultimoDia = getFechaLocalString(new Date(ahora.getFullYear(), ahora.getMonth(), 0));
      this.fechaDesde.set(primerDia);
      this.fechaHasta.set(ultimoDia);
    } else if (tipo === 'TODO') {
      this.fechaDesde.set('2020-01-01');
      this.fechaHasta.set(hoy);
    }
  }

  public resumenVentasCaja = computed(() => {
    const sucursalId = this.sucursalesService.activaId();
    const dStr = this.fechaDesde();
    const hStr = this.fechaHasta();
    const desde = new Date(`${dStr}T00:00:00`).getTime();
    const hasta = new Date(`${hStr}T23:59:59.999`).getTime();

    const ventas = this.ventasService.ventas().filter((v) => {
      if (v.estado === 'CANCELADA') return false;
      if (sucursalId !== 'TODAS' && v.sucursalId && v.sucursalId !== sucursalId) return false;
      const t = new Date(v.fecha).getTime();
      return !isNaN(t) && t >= desde && t <= hasta;
    });

    const gastos = this.gastosService.gastos().filter((g) => {
      if (sucursalId !== 'TODAS' && g.sucursalId && g.sucursalId !== sucursalId) return false;
      const t = new Date(g.fecha).getTime();
      return !isNaN(t) && t >= desde && t <= hasta;
    });

    const cortes = this.cortesService.cortesHistorial().filter((c) => {
      if (sucursalId !== 'TODAS' && c.sucursalId && c.sucursalId !== sucursalId) return false;
      const t = new Date(c.fechaCierre || c.fechaApertura).getTime();
      return !isNaN(t) && t >= desde && t <= hasta;
    });

    // 1. Pagos de Ventas (Incluye todas las transacciones, anticipos y abonos registrados)
    let pagosVentasEfectivo = 0;
    let pagosVentasTarjeta = 0;
    let pagosVentasTransferencia = 0;

    ventas.forEach((v) => {
      const cambio = Number(v.cambio) || 0;
      const pagoEfecBruto = Number(v.pagos?.efectivo) || 0;
      const efecNeto = Math.max(0, pagoEfecBruto - cambio);

      pagosVentasEfectivo += efecNeto;
      pagosVentasTarjeta += Number(v.pagos?.tarjeta) || 0;
      pagosVentasTransferencia += Number(v.pagos?.transferencia) || 0;
    });

    const totalVentas = ventas.reduce((acc, v) => acc + (Number(v.total) || 0), 0);
    const cantidadVentas = ventas.length;
    const totalIngresos = totalVentas;
    const totalEfectivoRecibido = pagosVentasEfectivo;

    // 2. Gastos
    let totalGastosEfectivo = 0;
    let totalGastosTarjeta = 0;
    let totalGastosTransferencia = 0;

    gastos.forEach((g) => {
      const met = (g.metodoPago || '').toUpperCase();
      const monto = g.monto || 0;
      if (met === 'TARJETA') {
        totalGastosTarjeta += monto;
      } else if (met === 'TRANSFERENCIA') {
        totalGastosTransferencia += monto;
      } else {
        totalGastosEfectivo += monto;
      }
    });

    const totalGastos = totalGastosEfectivo + totalGastosTarjeta + totalGastosTransferencia;
    const totalRetiros = cortes.reduce((acc, c) => acc + (c.retiros || 0), 0);

    // 3. Detalle Caja Actual
    const corteActivo = this.cortesService.corteActivo();
    let dineroEnCaja = 0;
    let cajaEstadoLabel = 'CERRADO (Sin cortes cerrados)';

    if (corteActivo && (!corteActivo.sucursalId || corteActivo.sucursalId === sucursalId || sucursalId === 'TODAS')) {
      const fechaInicio = new Date(corteActivo.fechaApertura).getTime();
      const pagosEfecTurno = ventas
        .filter((v) => new Date(v.fecha).getTime() >= fechaInicio)
        .reduce((acc, v) => {
          const cambio = Number(v.cambio) || 0;
          const pagoEfecBruto = Number(v.pagos?.efectivo) || 0;
          return acc + Math.max(0, pagoEfecBruto - cambio);
        }, 0);

      const gastosEfecTurno = gastos
        .filter((g) => {
          const met = (g.metodoPago || '').toUpperCase();
          return new Date(g.fecha).getTime() >= fechaInicio && met !== 'TARJETA' && met !== 'TRANSFERENCIA';
        })
        .reduce((acc, g) => acc + (g.monto || 0), 0);

      const cajaInicial = corteActivo.cajaInicial || 0;
      dineroEnCaja = cajaInicial + pagosEfecTurno - gastosEfecTurno;
      cajaEstadoLabel = `ABIERTO (Caja inicial: $${cajaInicial.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    } else {
      const cortesOrdenados = [...cortes]
        .filter((c) => c.estado === 'CERRADO' && c.fechaCierre)
        .sort((a, b) => new Date(b.fechaCierre!).getTime() - new Date(a.fechaCierre!).getTime());

      let baseCash = 0;
      let fechaInicioTime = 0;

      if (cortesOrdenados.length > 0) {
        const ultimoCorte = cortesOrdenados[0];
        baseCash = ultimoCorte.cajaContada || 0;
        fechaInicioTime = new Date(ultimoCorte.fechaCierre!).getTime();
        cajaEstadoLabel = `CERRADO (Último cierre: $${baseCash.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      }

      const pagosEfecDesde = ventas
        .filter((v) => new Date(v.fecha).getTime() >= fechaInicioTime)
        .reduce((acc, v) => {
          const cambio = Number(v.cambio) || 0;
          const pagoEfecBruto = Number(v.pagos?.efectivo) || 0;
          return acc + Math.max(0, pagoEfecBruto - cambio);
        }, 0);

      const gastosEfecDesde = gastos
        .filter((g) => {
          const met = (g.metodoPago || '').toUpperCase();
          return new Date(g.fecha).getTime() >= fechaInicioTime && met !== 'TARJETA' && met !== 'TRANSFERENCIA';
        })
        .reduce((acc, g) => acc + (g.monto || 0), 0);

      dineroEnCaja = baseCash + pagosEfecDesde - gastosEfecDesde;
    }

    const cajaEsperada = totalEfectivoRecibido - totalGastosEfectivo - totalRetiros;
    const diferenciaCaja = dineroEnCaja - cajaEsperada;
    const totalPagosBancarios = pagosVentasTarjeta + pagosVentasTransferencia;

    return {
      totalIngresos,
      totalVentas,
      cantidadVentas,
      totalGastos,
      totalGastosEfectivo,
      totalRetiros,
      pagosEfectivo: totalEfectivoRecibido,
      pagosTarjeta: pagosVentasTarjeta,
      pagosTransferencia: pagosVentasTransferencia,
      pagosBancarios: totalPagosBancarios,
      dineroEnCaja,
      cajaEstadoLabel,
      cajaEsperada,
      diferenciaCaja,
      diferenciaAbsoluta: Math.abs(diferenciaCaja)
    };
  });

  public desgloseMetodos = computed(() => {
    const r = this.resumenVentasCaja();
    const tot = r.totalIngresos > 0 ? r.totalIngresos : 1;
    const efec = r.pagosEfectivo;
    const tarj = r.pagosTarjeta;
    const trans = r.pagosTransferencia;

    return {
      efectivo: efec,
      tarjeta: tarj,
      transferencia: trans,
      pctEfectivo: Math.round((efec / tot) * 100),
      pctTarjeta: Math.round((tarj / tot) * 100),
      pctTransferencia: Math.round((trans / tot) * 100),
      ticketPromedio: r.cantidadVentas > 0 ? r.totalIngresos / r.cantidadVentas : 0
    };
  });

  public esPedidoVencido(ped?: PedidoPersonalizado | null): boolean {
    if (!ped || !ped.fechaEntrega) return false;
    if (
      ped.estado === 'ENTREGADO' ||
      ped.estado === 'TERMINADO' ||
      ped.estado === 'LISTO' ||
      ped.estado === 'CANCELADO'
    ) {
      return false;
    }

    try {
      if (ped.fechaEntrega.includes('T')) {
        const entregaDate = new Date(ped.fechaEntrega).getTime();
        return !isNaN(entregaDate) && entregaDate < Date.now();
      }
      const hoyLocal = new Date().toLocaleDateString('en-CA');
      return ped.fechaEntrega < hoyLocal;
    } catch {
      return false;
    }
  }

  public resumenPedidosDashboard = computed(() => {
    const sucursalId = this.sucursalesService.activaId();
    const dStr = this.fechaDesde();
    const hStr = this.fechaHasta();
    const desde = new Date(`${dStr}T00:00:00`).getTime();
    const hasta = new Date(`${hStr}T23:59:59.999`).getTime();

    const pedidos = this.pedidosService.pedidos().filter((p) => {
      if (sucursalId !== 'TODAS' && p.sucursalId && p.sucursalId !== sucursalId) return false;
      if (p.estado === 'CANCELADO') return false;
      const t = new Date(p.fechaRegistro).getTime();
      return !isNaN(t) && t >= desde && t <= hasta;
    });

    const vencidos = pedidos.filter((p) => this.esPedidoVencido(p)).length;
    const pendientes = pedidos.filter((p) => p.estado === 'PENDIENTE').length;
    const enProceso = pedidos.filter((p) => p.estado === 'EN_PROCESO').length;
    const entregados = pedidos.filter((p) => p.estado === 'ENTREGADO').length;
    const terminados = pedidos.filter((p) => p.estado === 'TERMINADO' || p.estado === 'LISTO').length;

    const activos = pedidos.filter((p) => p.estado === 'PENDIENTE' || p.estado === 'EN_PROCESO' || p.estado === 'LISTO');
    const saldoPorCobrar = activos.reduce((acc, p) => acc + (p.saldoRestante || 0), 0);

    return {
      total: pedidos.length,
      vencidos,
      pendientes,
      enProceso,
      entregados,
      terminados,
      totalActivos: activos.length,
      saldoPorCobrar
    };
  });
}
