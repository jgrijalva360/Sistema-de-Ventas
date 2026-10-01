import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { VentasService } from '../../core/services/ventas.service';
import { GastosService } from '../../core/services/gastos.service';
import { ProductosService } from '../../core/services/productos.service';
import { CortesService } from '../../core/services/cortes.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { PedidosService } from '../../core/services/pedidos.service';
import { SociosService } from '../../core/services/socios.service';
import { PedidoPersonalizado, Gasto } from '../../core/models/models';
import { getFechaLocalString } from '../../shared/utils/date.util';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, CurrencyMxnPipe, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  public ventasService = inject(VentasService);
  public gastosService = inject(GastosService);
  public productosService = inject(ProductosService);
  public cortesService = inject(CortesService);
  public sucursalesService = inject(SucursalesService);
  public pedidosService = inject(PedidosService);
  public sociosService = inject(SociosService);

  public mostrarValores = signal<boolean>(true);

  // Filtros de fecha / periodo
  public periodo = signal<'HOY' | 'AYER' | 'ESTA_SEMANA' | 'ESTE_MES' | 'MES_ANTERIOR' | 'PERSONALIZADO' | 'TODO'>('HOY');
  public fechaDesde = signal<string>(getFechaLocalString());
  public fechaHasta = signal<string>(getFechaLocalString());

  ngOnInit(): void {
    this.sociosService.cargarDatos();
  }

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

  public esGastoDeSocio(g: Gasto): boolean {
    if (g.socioId && g.socioId !== 'CAJA' && g.socioId !== 'EMPRESA') {
      return true;
    }
    const met = (g.metodoPago || '').toUpperCase();
    if (met === 'BOLSILLO_SOCIO') {
      return true;
    }
    const persona = (g.persona || '').trim().toLowerCase();
    if (persona && !persona.includes('caja') && !persona.includes('empresa') && persona !== 'local' && persona !== '-') {
      const socios = this.sociosService.sociosActivos();
      const esSocio = socios.some(
        (s) => s.id === g.socioId || s.nombre.trim().toLowerCase() === persona || persona.includes(s.nombre.trim().toLowerCase())
      );
      if (esSocio) return true;
    }
    return false;
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

    // 2. Gastos (Los egresos pagados por socios NO afectan las salidas ni la caja del negocio)
    let totalGastosEfectivo = 0;
    let totalGastosTarjeta = 0;
    let totalGastosTransferencia = 0;
    let totalGastosSocios = 0;

    gastos.forEach((g) => {
      const monto = Number(g.monto) || 0;
      if (this.esGastoDeSocio(g)) {
        totalGastosSocios += monto;
        return; // Excluido del flujo de egresos y caja del negocio
      }

      const met = (g.metodoPago || '').toUpperCase();
      if (met === 'TARJETA') {
        totalGastosTarjeta += monto;
      } else if (met === 'TRANSFERENCIA') {
        totalGastosTransferencia += monto;
      } else {
        totalGastosEfectivo += monto;
      }
    });

    const totalGastos = totalGastosEfectivo + totalGastosTarjeta + totalGastosTransferencia;

    // 3. Detalle Caja Actual y Movimientos de Socios
    const corteActivo = this.cortesService.corteActivo();
    let dineroEnCaja = 0;
    let cajaEstadoLabel = 'CERRADO (Sin cortes cerrados)';

    const resguardosActivo = (corteActivo && (!corteActivo.sucursalId || corteActivo.sucursalId === sucursalId || sucursalId === 'TODAS'))
      ? (corteActivo.resguardos || [])
      : [];

    const retirosPurosActivo = resguardosActivo
      .filter((r) => !r.tipo || r.tipo === 'RETIRO')
      .reduce((acc, r) => acc + (Number(r.monto) || 0), 0);

    const pagosSociosEfecActivo = resguardosActivo
      .filter((r) => r.tipo === 'PAGO_REPARTO' && (!r.metodoPago || r.metodoPago === 'EFECTIVO'))
      .reduce((acc, r) => acc + (Number(r.monto) || 0), 0);

    const ingresosActivo = resguardosActivo
      .filter((r) => r.tipo === 'DEVOLUCION')
      .reduce((acc, r) => acc + (Number(r.monto) || 0), 0);

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
          if (this.esGastoDeSocio(g)) return false;
          const met = (g.metodoPago || '').toUpperCase();
          return new Date(g.fecha).getTime() >= fechaInicio && met !== 'TARJETA' && met !== 'TRANSFERENCIA';
        })
        .reduce((acc, g) => acc + (Number(g.monto) || 0), 0);

      const cajaInicial = corteActivo.cajaInicial || 0;
      dineroEnCaja = Math.round((cajaInicial + pagosEfecTurno - gastosEfecTurno - retirosPurosActivo - pagosSociosEfecActivo + ingresosActivo) * 100) / 100;

      const partesLabel: string[] = [`Fondo: $${cajaInicial.toFixed(2)}`];
      if (retirosPurosActivo > 0) partesLabel.push(`-$${retirosPurosActivo.toFixed(2)} retiros`);
      if (pagosSociosEfecActivo > 0) partesLabel.push(`-$${pagosSociosEfecActivo.toFixed(2)} socios`);
      if (ingresosActivo > 0) partesLabel.push(`+$${ingresosActivo.toFixed(2)} ingresos`);

      const labelExtra = partesLabel.length > 1 ? ` (${partesLabel.join(' | ')})` : ` (Fondo inicial: $${cajaInicial.toFixed(2)})`;
      cajaEstadoLabel = `ABIERTO${labelExtra}`;
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
          if (this.esGastoDeSocio(g)) return false;
          const met = (g.metodoPago || '').toUpperCase();
          return new Date(g.fecha).getTime() >= fechaInicioTime && met !== 'TARJETA' && met !== 'TRANSFERENCIA';
        })
        .reduce((acc, g) => acc + (Number(g.monto) || 0), 0);

      const pagosSociosEfecDesde = this.sociosService.liquidaciones()
        .filter((l) => {
          if (sucursalId !== 'TODAS' && l.sucursalId && l.sucursalId !== sucursalId) return false;
          const t = new Date(l.fechaCreacion).getTime();
          return !isNaN(t) && t >= fechaInicioTime;
        })
        .reduce((acc, l) => {
          const sum = (l.socios || [])
            .filter((s) => !s.metodoPagoSalida || s.metodoPagoSalida === 'EFECTIVO')
            .reduce((sAcc, s) => sAcc + (Number(s.montoPagado ?? s.montoNetoACobrar) || 0), 0);
          return acc + sum;
        }, 0);

      dineroEnCaja = Math.round((baseCash + pagosEfecDesde - gastosEfecDesde - pagosSociosEfecDesde) * 100) / 100;
    }

    // 4. Salidas de Dinero por Pagos a Socios en el Periodo
    const liquidacionesPeriodo = this.sociosService.liquidaciones().filter((l) => {
      if (sucursalId !== 'TODAS' && l.sucursalId && l.sucursalId !== sucursalId) return false;
      const t = new Date(l.fechaCreacion || `${l.fechaHasta}T23:59:59.999`).getTime();
      return !isNaN(t) && t >= desde && t <= hasta;
    });

    const foliosLiquidacionesContadas = new Set<string>();

    let totalPagosSociosEfectivo = 0;
    let totalPagosSociosTransferencia = 0;
    let totalPagosSociosTarjeta = 0;

    liquidacionesPeriodo.forEach((l) => {
      if (l.folio) foliosLiquidacionesContadas.add(String(l.folio));
      if (l.id) foliosLiquidacionesContadas.add(String(l.id));

      (l.socios || []).forEach((s) => {
        const monto = Number(s.montoPagado ?? s.montoNetoACobrar) || 0;
        if (monto <= 0) return;
        const met = (s.metodoPagoSalida || 'EFECTIVO').toUpperCase();
        if (met === 'TRANSFERENCIA') {
          totalPagosSociosTransferencia += monto;
        } else if (met === 'TARJETA') {
          totalPagosSociosTarjeta += monto;
        } else {
          totalPagosSociosEfectivo += monto;
        }
      });
    });

    // 5. Retiros y movimientos en cortes históricos
    let totalRetirosHistorialPuros = 0;
    let totalIngresosHistorial = 0;

    cortes.forEach((c) => {
      if (c.resguardosDetalle && c.resguardosDetalle.length > 0) {
        c.resguardosDetalle.forEach((r) => {
          const monto = Number(r.monto) || 0;
          if (r.tipo === 'DEVOLUCION') {
            totalIngresosHistorial += monto;
          } else if (r.tipo === 'PAGO_REPARTO') {
            if (!r.liquidacionFolio || !foliosLiquidacionesContadas.has(String(r.liquidacionFolio))) {
              const met = (r.metodoPago || 'EFECTIVO').toUpperCase();
              if (met === 'TRANSFERENCIA') {
                totalPagosSociosTransferencia += monto;
              } else if (met === 'TARJETA') {
                totalPagosSociosTarjeta += monto;
              } else {
                totalPagosSociosEfectivo += monto;
              }
            }
          } else {
            totalRetirosHistorialPuros += monto;
          }
        });
      } else {
        totalRetirosHistorialPuros += Number(c.retiros) || 0;
        totalIngresosHistorial += Number(c.ingresosCaja) || 0;
      }
    });

    const fechaAperturaActivo = corteActivo ? new Date(corteActivo.fechaApertura).getTime() : 0;
    const activoEnPeriodo = corteActivo && !isNaN(fechaAperturaActivo) && fechaAperturaActivo >= desde && fechaAperturaActivo <= hasta;

    if (activoEnPeriodo && corteActivo?.resguardos) {
      corteActivo.resguardos.forEach((r) => {
        if (r.tipo === 'PAGO_REPARTO') {
          if (!r.liquidacionFolio || !foliosLiquidacionesContadas.has(String(r.liquidacionFolio))) {
            const monto = Number(r.monto) || 0;
            const met = (r.metodoPago || 'EFECTIVO').toUpperCase();
            if (met === 'TRANSFERENCIA') {
              totalPagosSociosTransferencia += monto;
            } else if (met === 'TARJETA') {
              totalPagosSociosTarjeta += monto;
            } else {
              totalPagosSociosEfectivo += monto;
            }
          }
        }
      });
    }

    const totalRetiros = Math.round((totalRetirosHistorialPuros + (activoEnPeriodo ? retirosPurosActivo : 0)) * 100) / 100;
    const totalIngresosCaja = Math.round((totalIngresosHistorial + (activoEnPeriodo ? ingresosActivo : 0)) * 100) / 100;

    totalPagosSociosEfectivo = Math.round(totalPagosSociosEfectivo * 100) / 100;
    totalPagosSociosTransferencia = Math.round(totalPagosSociosTransferencia * 100) / 100;
    totalPagosSociosTarjeta = Math.round(totalPagosSociosTarjeta * 100) / 100;
    const totalPagosSociosBancos = Math.round((totalPagosSociosTransferencia + totalPagosSociosTarjeta) * 100) / 100;
    const totalPagosSocios = Math.round((totalPagosSociosEfectivo + totalPagosSociosBancos) * 100) / 100;

    const cajaEsperada = Math.round((totalEfectivoRecibido - totalGastosEfectivo - totalRetiros - totalPagosSociosEfectivo + totalIngresosCaja) * 100) / 100;
    const diferenciaCaja = Math.round((dineroEnCaja - cajaEsperada) * 100) / 100;
    const totalPagosBancarios = pagosVentasTarjeta + pagosVentasTransferencia;

    return {
      totalIngresos,
      totalVentas,
      cantidadVentas,
      totalGastos,
      totalGastosNegocio: totalGastos,
      totalGastosSocios,
      totalGastosEfectivo,
      totalGastosTarjeta,
      totalGastosTransferencia,
      totalRetiros,
      totalIngresosCaja,
      totalPagosSocios,
      totalPagosSociosEfectivo,
      totalPagosSociosTransferencia,
      totalPagosSociosTarjeta,
      totalPagosSociosBancos,
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
