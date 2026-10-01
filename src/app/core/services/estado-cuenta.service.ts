import { Injectable, inject, computed } from '@angular/core';
import { VentasService } from './ventas.service';
import { GastosService } from './gastos.service';
import { CortesService } from './cortes.service';
import { PedidosService } from './pedidos.service';
import { SociosService } from './socios.service';
import { SucursalesService } from './sucursales.service';
import {
  MovimientoFinanciero,
  FiltrosEstadoCuenta,
  ResumenEstadoCuenta,
  TipoFlujoFinanciero
} from '../models/models';

@Injectable({
  providedIn: 'root'
})
export class EstadoCuentaService {
  private ventasService = inject(VentasService);
  private gastosService = inject(GastosService);
  private cortesService = inject(CortesService);
  private pedidosService = inject(PedidosService);
  private sociosService = inject(SociosService);
  private sucursalesService = inject(SucursalesService);

  /**
   * Computed reactivo que agrega y normaliza en tiempo real TODOS los movimientos
   * monetarios registrados en los diferentes módulos del sistema.
   */
  public todosLosMovimientos = computed<MovimientoFinanciero[]>(() => {
    const movimientos: MovimientoFinanciero[] = [];
    const socios = this.sociosService.sociosActivos();
    const defTransf = this.sociosService.socioTransferenciasDefault();
    const defTarj = this.sociosService.socioTarjetasDefault();

    // ─────────────────────────────────────────────────────────────
    // 1. VENTAS DE MOSTRADOR
    // ─────────────────────────────────────────────────────────────
    this.ventasService.ventas().forEach((v) => {
      if (v.estado === 'CANCELADA') return;

      const cambio = Number(v.cambio) || 0;
      const efecBruto = Number(v.pagos?.efectivo) || 0;
      const efecNeto = Math.max(0, efecBruto - cambio);

      // Cobro en Efectivo -> Ingresa a CAJA
      if (efecNeto > 0) {
        movimientos.push({
          id: `MOV-VTA-${v.id}-EFEC`,
          fecha: v.fecha,
          concepto: `Venta Mostrador #${v.id} (Efectivo)`,
          tipo: 'INGRESO',
          importe: Math.round(efecNeto * 100) / 100,
          cuenta: 'CAJA',
          titularSocioNombre: 'Caja Mostrador',
          contraparteNombre: 'Cliente Mostrador',
          metodoPago: 'EFECTIVO',
          moduloOrigen: 'VENTAS',
          referenciaId: v.id,
          sucursalId: v.sucursalId,
          sucursalNombre: v.sucursalNombre,
          usuario: v.usuario
        });
      }

      // Cobro con Tarjeta -> Ingresa a Cuenta del Socio / Terminal
      const tarjeta = Number(v.pagos?.tarjeta) || 0;
      if (tarjeta > 0) {
        const titularId = v.socioTarjetaId || defTarj?.id;
        const titularNombre = v.socioTarjetaNombre || defTarj?.nombre || 'Terminal Tarjeta';
        movimientos.push({
          id: `MOV-VTA-${v.id}-TARJ`,
          fecha: v.fecha,
          concepto: `Venta Mostrador #${v.id} (Tarjeta - ${titularNombre})`,
          tipo: 'INGRESO',
          importe: Math.round(tarjeta * 100) / 100,
          cuenta: 'SOCIO',
          titularSocioId: titularId,
          titularSocioNombre: titularNombre,
          contraparteNombre: 'Cliente Mostrador',
          metodoPago: 'TARJETA',
          moduloOrigen: 'VENTAS',
          referenciaId: v.id,
          sucursalId: v.sucursalId,
          sucursalNombre: v.sucursalNombre,
          usuario: v.usuario
        });
      }

      // Cobro con Transferencia -> Ingresa a Cuenta Bancaria del Socio
      const transferencia = Number(v.pagos?.transferencia) || 0;
      if (transferencia > 0) {
        const titularId = v.socioTransferenciaId || defTransf?.id;
        const titularNombre = v.socioTransferenciaNombre || defTransf?.nombre || 'Cuenta Transferencia';
        movimientos.push({
          id: `MOV-VTA-${v.id}-TRANS`,
          fecha: v.fecha,
          concepto: `Venta Mostrador #${v.id} (Transf. - ${titularNombre})`,
          tipo: 'INGRESO',
          importe: Math.round(transferencia * 100) / 100,
          cuenta: 'SOCIO',
          titularSocioId: titularId,
          titularSocioNombre: titularNombre,
          contraparteNombre: 'Cliente Mostrador',
          metodoPago: 'TRANSFERENCIA',
          moduloOrigen: 'VENTAS',
          referenciaId: v.id,
          sucursalId: v.sucursalId,
          sucursalNombre: v.sucursalNombre,
          usuario: v.usuario
        });
      }
    });

    // ─────────────────────────────────────────────────────────────
    // 2. PEDIDOS PERSONALIZADOS (Anticipos y Abonos)
    // ─────────────────────────────────────────────────────────────
    this.pedidosService.pedidos().forEach((p) => {
      if (p.estado === 'CANCELADO') return;

      const listaAbonos = (p.abonos && p.abonos.length > 0)
        ? p.abonos
        : ((p as any).pagos && (p as any).pagos.length > 0)
          ? (p as any).pagos
          : null;

      if (listaAbonos && listaAbonos.length > 0) {
        listaAbonos.forEach((a: any, idx: number) => {
          const monto = Number(a.monto) || 0;
          if (monto <= 0) return;

          const met = (a.metodoPago || a.metodo || 'EFECTIVO').toUpperCase();
          const esTransf = met === 'TRANSFERENCIA';
          const esTarj = met === 'TARJETA';

          let cuenta: 'CAJA' | 'SOCIO' = 'CAJA';
          let titularId: string | undefined;
          let titularNombre = 'Caja Mostrador';

          if (esTransf) {
            cuenta = 'SOCIO';
            titularId = a.socioTransferenciaId || p.socioTransferenciaId || defTransf?.id;
            titularNombre = a.socioTransferenciaNombre || p.socioTransferenciaNombre || defTransf?.nombre || 'Cuenta Transf.';
          } else if (esTarj) {
            cuenta = 'SOCIO';
            titularId = a.socioTarjetaId || p.socioTarjetaId || defTarj?.id;
            titularNombre = a.socioTarjetaNombre || p.socioTarjetaNombre || defTarj?.nombre || 'Terminal Tarjeta';
          }

          movimientos.push({
            id: `MOV-PED-${p.id}-ABN-${idx}`,
            fecha: a.fecha || p.fechaRegistro,
            concepto: `Abono Pedido #${p.id} - ${p.clienteNombre} (${a.concepto || met})`,
            tipo: 'INGRESO',
            importe: Math.round(monto * 100) / 100,
            cuenta,
            titularSocioId: titularId,
            titularSocioNombre: titularNombre,
            contraparteNombre: p.clienteNombre,
            metodoPago: met,
            moduloOrigen: 'PEDIDOS',
            referenciaId: p.id,
            sucursalId: p.sucursalId,
            sucursalNombre: p.sucursalNombre
          });
        });
      } else {
        const pagado = (p.saldoRestante === 0 && (p.totalAcordado || 0) > 0)
          ? (p.totalAcordado || 0)
          : (p.anticipo || 0);

        if (pagado > 0) {
          const met = (p.metodoPagoAnticipo || 'EFECTIVO').toUpperCase();
          const esTransf = met === 'TRANSFERENCIA';
          const esTarj = met === 'TARJETA';

          let cuenta: 'CAJA' | 'SOCIO' = 'CAJA';
          let titularId: string | undefined;
          let titularNombre = 'Caja Mostrador';

          if (esTransf) {
            cuenta = 'SOCIO';
            titularId = p.socioTransferenciaId || defTransf?.id;
            titularNombre = p.socioTransferenciaNombre || defTransf?.nombre || 'Cuenta Transf.';
          } else if (esTarj) {
            cuenta = 'SOCIO';
            titularId = p.socioTarjetaId || defTarj?.id;
            titularNombre = p.socioTarjetaNombre || defTarj?.nombre || 'Terminal Tarjeta';
          }

          movimientos.push({
            id: `MOV-PED-${p.id}-INIT`,
            fecha: p.fechaRegistro,
            concepto: `Anticipo Pedido #${p.id} - ${p.clienteNombre} (${met})`,
            tipo: 'INGRESO',
            importe: Math.round(pagado * 100) / 100,
            cuenta,
            titularSocioId: titularId,
            titularSocioNombre: titularNombre,
            contraparteNombre: p.clienteNombre,
            metodoPago: met,
            moduloOrigen: 'PEDIDOS',
            referenciaId: p.id,
            sucursalId: p.sucursalId,
            sucursalNombre: p.sucursalNombre
          });
        }
      }
    });

    // ─────────────────────────────────────────────────────────────
    // 3. GASTOS (Operativos de Negocio y Bolsillo de Socios)
    // ─────────────────────────────────────────────────────────────
    this.gastosService.gastos().forEach((g) => {
      const monto = Number(g.monto) || 0;
      if (monto <= 0) return;

      const met = (g.metodoPago || 'EFECTIVO').toUpperCase();
      const persona = (g.persona || '').trim();

      // Determinar si fue pagado por socio de su bolsillo o cuenta personal
      const socioAsociado = socios.find(
        (s) => s.id === g.socioId || (persona && (s.nombre.toLowerCase() === persona.toLowerCase() || persona.toLowerCase().includes(s.nombre.toLowerCase())))
      );

      let cuenta: 'CAJA' | 'SOCIO' | 'EMPRESA' = 'CAJA';
      let titularId: string | undefined;
      let titularNombre = 'Caja Mostrador';

      if (socioAsociado && (g.socioId || met === 'BOLSILLO_SOCIO' || met === 'TRANSFERENCIA' || met === 'TARJETA')) {
        cuenta = 'SOCIO';
        titularId = socioAsociado.id;
        titularNombre = socioAsociado.nombre;
      } else if (met === 'TARJETA' || met === 'TRANSFERENCIA') {
        cuenta = 'EMPRESA';
        titularNombre = 'Cuenta Empresa';
      } else {
        cuenta = 'CAJA';
        titularNombre = 'Caja Mostrador';
      }

      movimientos.push({
        id: `MOV-GAS-${g.id}`,
        fecha: g.fecha,
        concepto: `Gasto: ${g.concepto} [${g.categoria || 'General'}]`,
        tipo: 'EGRESO',
        importe: Math.round(monto * 100) / 100,
        cuenta,
        titularSocioId: titularId,
        titularSocioNombre: titularNombre,
        contraparteNombre: g.persona || 'Proveedor',
        metodoPago: met,
        moduloOrigen: 'GASTOS',
        referenciaId: g.id,
        sucursalId: g.sucursalId,
        sucursalNombre: g.sucursalNombre
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 4. CORTES DE CAJA (Resguardos, Devoluciones y Pagos en Turno)
    // ─────────────────────────────────────────────────────────────
    const foliosLiquidacionEnCortes = new Set<string>();

    const procesarResguardoItem = (r: any, corteId: string, sucursalId?: string, sucursalNombre?: string) => {
      const monto = Number(r.monto) || 0;
      if (monto <= 0) return;

      const met = (r.metodoPago || 'EFECTIVO').toUpperCase();

      if (r.tipo === 'DEVOLUCION') {
        // Pierna 1: Ingreso a Caja
        movimientos.push({
          id: `MOV-RESG-${r.id}-DEV`,
          fecha: r.fecha,
          concepto: `Devolución de resguardo a Caja por ${r.socioNombre || 'Socio'} (${r.concepto || 'Reintegro'})`,
          tipo: 'INGRESO',
          importe: Math.round(monto * 100) / 100,
          cuenta: 'CAJA',
          titularSocioNombre: 'Caja Mostrador',
          contraparteId: r.socioId,
          contraparteNombre: r.socioNombre || 'Socio',
          metodoPago: 'EFECTIVO',
          moduloOrigen: 'CORTES',
          referenciaId: corteId,
          sucursalId,
          sucursalNombre
        });

        // Pierna 2: Egreso de la custodia del socio
        if (r.socioId) {
          movimientos.push({
            id: `MOV-RESG-${r.id}-DEV-SOC`,
            fecha: r.fecha,
            concepto: `Devolución de resguardo reintegrado a Caja (${r.concepto || 'Reintegro'})`,
            tipo: 'EGRESO',
            importe: Math.round(monto * 100) / 100,
            cuenta: 'SOCIO',
            titularSocioId: r.socioId,
            titularSocioNombre: r.socioNombre || 'Socio',
            contraparteId: 'CAJA',
            contraparteNombre: 'Caja Mostrador',
            metodoPago: 'EFECTIVO',
            moduloOrigen: 'CORTES',
            referenciaId: corteId,
            sucursalId,
            sucursalNombre
          });
        }
      } else if (r.tipo === 'PAGO_REPARTO') {
        if (r.liquidacionFolio) foliosLiquidacionEnCortes.add(String(r.liquidacionFolio));

        // Pierna 1: Salida de Dinero (de Caja o de Socio Origen)
        const esEfectivo = !r.metodoPago || met === 'EFECTIVO';
        const cuentaSalida: 'CAJA' | 'SOCIO' = esEfectivo ? 'CAJA' : 'SOCIO';
        const titularSalidaNombre = esEfectivo ? 'Caja Mostrador' : (r.socioOrigenNombre || 'Socio Origen');

        movimientos.push({
          id: `MOV-REP-${r.id}-OUT`,
          fecha: r.fecha,
          concepto: `Salida Pago Reparto a ${r.socioNombre || 'Socio'} (${esEfectivo ? 'Efectivo Caja' : met + ' por ' + titularSalidaNombre})`,
          tipo: 'EGRESO',
          importe: Math.round(monto * 100) / 100,
          cuenta: cuentaSalida,
          titularSocioId: esEfectivo ? undefined : r.socioOrigenId,
          titularSocioNombre: titularSalidaNombre,
          contraparteId: r.socioId,
          contraparteNombre: r.socioNombre,
          metodoPago: met,
          moduloOrigen: 'SOCIOS',
          referenciaId: r.liquidacionFolio || corteId,
          sucursalId,
          sucursalNombre
        });

        // Pierna 2: Cobro de Utilidades por el socio beneficiario
        if (r.socioId) {
          movimientos.push({
            id: `MOV-REP-${r.id}-IN`,
            fecha: r.fecha,
            concepto: `Cobro de Reparto de Utilidades (${esEfectivo ? 'Efectivo Caja' : met + ' de ' + titularSalidaNombre})`,
            tipo: 'INGRESO',
            importe: Math.round(monto * 100) / 100,
            cuenta: 'SOCIO',
            titularSocioId: r.socioId,
            titularSocioNombre: r.socioNombre,
            contraparteId: esEfectivo ? 'CAJA' : r.socioOrigenId,
            contraparteNombre: titularSalidaNombre,
            metodoPago: met,
            moduloOrigen: 'SOCIOS',
            referenciaId: r.liquidacionFolio || corteId,
            sucursalId,
            sucursalNombre
          });
        }
      } else {
        // Pierna 1: Salida de Caja (Retiro de custodia)
        movimientos.push({
          id: `MOV-RESG-${r.id}-RET`,
          fecha: r.fecha,
          concepto: `Resguardo de efectivo entregado a ${r.socioNombre || 'Socio'} (${r.concepto || 'Custodia'})`,
          tipo: 'EGRESO',
          importe: Math.round(monto * 100) / 100,
          cuenta: 'CAJA',
          titularSocioNombre: 'Caja Mostrador',
          contraparteId: r.socioId,
          contraparteNombre: r.socioNombre || 'Socio',
          metodoPago: 'EFECTIVO',
          moduloOrigen: 'CORTES',
          referenciaId: corteId,
          sucursalId,
          sucursalNombre
        });

        // Pierna 2: Ingreso en custodia del socio
        if (r.socioId) {
          movimientos.push({
            id: `MOV-RESG-${r.id}-RET-SOC`,
            fecha: r.fecha,
            concepto: `Resguardo de efectivo recibido en custodia desde Caja (${r.concepto || 'Custodia'})`,
            tipo: 'INGRESO',
            importe: Math.round(monto * 100) / 100,
            cuenta: 'SOCIO',
            titularSocioId: r.socioId,
            titularSocioNombre: r.socioNombre || 'Socio',
            contraparteId: 'CAJA',
            contraparteNombre: 'Caja Mostrador',
            metodoPago: 'EFECTIVO',
            moduloOrigen: 'CORTES',
            referenciaId: corteId,
            sucursalId,
            sucursalNombre
          });
        }
      }
    };

    // Resguardos del corte activo
    const activo = this.cortesService.corteActivo();
    if (activo && activo.resguardos) {
      activo.resguardos.forEach((r) => procesarResguardoItem(r, activo.id, activo.sucursalId, activo.sucursalNombre));
    }

    // Resguardos de cortes cerrados
    this.cortesService.cortesHistorial().forEach((c) => {
      if (c.resguardosDetalle && c.resguardosDetalle.length > 0) {
        c.resguardosDetalle.forEach((r) => procesarResguardoItem(r, c.id, c.sucursalId, c.sucursalNombre));
      }
    });

    // ─────────────────────────────────────────────────────────────
    // 5. LIQUIDACIONES DE SOCIOS (Si no se registraron en cortes)
    // ─────────────────────────────────────────────────────────────
    this.sociosService.liquidaciones().forEach((l) => {
      const folio = l.folio ? String(l.folio) : l.id;
      if (foliosLiquidacionEnCortes.has(folio)) return; // Ya registrado en cortes para evitar duplicar

      (l.socios || []).forEach((s, idx) => {
        const monto = Number(s.montoPagado ?? s.montoNetoACobrar) || 0;
        if (monto <= 0) return;

        const met = (s.metodoPagoSalida || 'EFECTIVO').toUpperCase();
        const esEfectivo = met === 'EFECTIVO';
        const cuentaSalida: 'CAJA' | 'SOCIO' = esEfectivo ? 'CAJA' : 'SOCIO';
        const titularSalida = esEfectivo ? 'Caja Mostrador' : (s.socioOrigenNombre || 'Socio Origen');

        // Pierna 1: Salida de fondos
        movimientos.push({
          id: `MOV-LIQ-${l.id}-SOC-${idx}-OUT`,
          fecha: l.fechaCreacion,
          concepto: `Salida Pago Reparto #${folio} a ${s.nombre} (${esEfectivo ? 'Efectivo Caja' : met + ' por ' + titularSalida})`,
          tipo: 'EGRESO',
          importe: Math.round(monto * 100) / 100,
          cuenta: cuentaSalida,
          titularSocioId: esEfectivo ? undefined : s.socioOrigenId,
          titularSocioNombre: titularSalida,
          contraparteId: s.socioId,
          contraparteNombre: s.nombre,
          metodoPago: met,
          moduloOrigen: 'SOCIOS',
          referenciaId: folio,
          sucursalId: l.sucursalId,
          sucursalNombre: l.sucursalNombre
        });

        // Pierna 2: Cobro del socio beneficiario
        if (s.socioId) {
          movimientos.push({
            id: `MOV-LIQ-${l.id}-SOC-${idx}-IN`,
            fecha: l.fechaCreacion,
            concepto: `Cobro de Reparto de Utilidades #${folio} (${esEfectivo ? 'Efectivo Caja' : met + ' de ' + titularSalida})`,
            tipo: 'INGRESO',
            importe: Math.round(monto * 100) / 100,
            cuenta: 'SOCIO',
            titularSocioId: s.socioId,
            titularSocioNombre: s.nombre,
            contraparteId: esEfectivo ? 'CAJA' : s.socioOrigenId,
            contraparteNombre: titularSalida,
            metodoPago: met,
            moduloOrigen: 'SOCIOS',
            referenciaId: folio,
            sucursalId: l.sucursalId,
            sucursalNombre: l.sucursalNombre
          });
        }
      });
    });

    // Ordenar cronológicamente por defecto (fecha ascendente para cálculos progresivos)
    return movimientos.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  });

  /**
   * Genera el Estado de Cuenta estructurado aplicando los filtros dados,
   * calculando el saldo inicial pre-periodo, ingresos, egresos y saldos progresivos.
   */
  public generarEstadoCuenta(filtros: FiltrosEstadoCuenta): ResumenEstadoCuenta {
    const todos = this.todosLosMovimientos();
    const sucursalId = filtros.sucursalId || 'TODAS';
    const cuentaFiltro = filtros.cuenta || 'TODAS';
    const tipoFiltro = filtros.tipo || 'TODOS';
    const metodoFiltro = filtros.metodoPago || 'TODOS';
    const moduloFiltro = filtros.moduloOrigen || 'TODOS';
    const busqueda = (filtros.terminoBusqueda || '').trim().toLowerCase();

    const dStr = filtros.fechaDesde;
    const hStr = filtros.fechaHasta;
    const desde = new Date(`${dStr}T00:00:00`).getTime();
    const hasta = new Date(`${hStr}T23:59:59.999`).getTime();

    const sociosActivos = this.sociosService.sociosActivos();
    const socioBuscado = sociosActivos.find(
      (s) => s.id === cuentaFiltro || s.nombre.toLowerCase() === cuentaFiltro.toLowerCase()
    );

    // Función auxiliar para determinar si un movimiento pertenece a la cuenta seleccionada
    const coincideCuenta = (m: MovimientoFinanciero): boolean => {
      if (cuentaFiltro === 'TODAS') {
        // En vista consolidada del negocio no duplicamos las piernas de custodia interna
        if (m.id.endsWith('-RET-SOC') || m.id.endsWith('-DEV-SOC') || m.id.endsWith('-IN')) {
          return false;
        }
        return true;
      }
      if (cuentaFiltro === 'CAJA') return m.cuenta === 'CAJA';
      if (cuentaFiltro === 'EMPRESA') return m.cuenta === 'EMPRESA';

      // Si es un socio específico (buscamos por ID o por nombre)
      if (socioBuscado) {
        return (
          m.cuenta === 'SOCIO' &&
          (m.titularSocioId === socioBuscado.id ||
            m.titularSocioNombre?.toLowerCase() === socioBuscado.nombre.toLowerCase())
        );
      }
      return (
        m.cuenta === 'SOCIO' &&
        (m.titularSocioId === cuentaFiltro || m.titularSocioNombre?.toLowerCase() === cuentaFiltro.toLowerCase())
      );
    };

    // 1. Saldo Inicial: Suma de todos los movimientos anteriores a 'desde' que coinciden con la cuenta y sucursal
    let saldoInicial = 0;
    todos.forEach((m) => {
      if (sucursalId !== 'TODAS' && m.sucursalId && m.sucursalId !== sucursalId) return;
      if (!coincideCuenta(m)) return;

      const t = new Date(m.fecha).getTime();
      if (!isNaN(t) && t < desde) {
        if (m.tipo === 'INGRESO') {
          saldoInicial += m.importe;
        } else {
          saldoInicial -= m.importe;
        }
      }
    });

    saldoInicial = Math.round(saldoInicial * 100) / 100;

    // 2. Movimientos del Periodo Filtrado
    const movimientosEnPeriodo: MovimientoFinanciero[] = [];
    let saldoProgresivo = saldoInicial;
    let totalIngresos = 0;
    let totalEgresos = 0;

    todos.forEach((m) => {
      if (sucursalId !== 'TODAS' && m.sucursalId && m.sucursalId !== sucursalId) return;
      if (!coincideCuenta(m)) return;

      const t = new Date(m.fecha).getTime();
      if (isNaN(t) || t < desde || t > hasta) return;

      // Filtro de Tipo
      if (tipoFiltro !== 'TODOS' && m.tipo !== tipoFiltro) return;

      // Filtro de Método
      if (metodoFiltro !== 'TODOS' && m.metodoPago.toUpperCase() !== metodoFiltro) return;

      // Filtro de Módulo
      if (moduloFiltro !== 'TODOS' && m.moduloOrigen !== moduloFiltro) return;

      // Filtro de Búsqueda
      if (busqueda) {
        const conceptoMatch = (m.concepto || '').toLowerCase().includes(busqueda);
        const refMatch = (m.referenciaId || '').toLowerCase().includes(busqueda);
        const titularMatch = (m.titularSocioNombre || '').toLowerCase().includes(busqueda);
        const contraMatch = (m.contraparteNombre || '').toLowerCase().includes(busqueda);
        if (!conceptoMatch && !refMatch && !titularMatch && !contraMatch) return;
      }

      // Actualizar acumuladores
      if (m.tipo === 'INGRESO') {
        saldoProgresivo += m.importe;
        totalIngresos += m.importe;
      } else {
        saldoProgresivo -= m.importe;
        totalEgresos += m.importe;
      }

      movimientosEnPeriodo.push({
        ...m,
        saldoAcumulado: Math.round(saldoProgresivo * 100) / 100
      });
    });

    totalIngresos = Math.round(totalIngresos * 100) / 100;
    totalEgresos = Math.round(totalEgresos * 100) / 100;
    const flujoNeto = Math.round((totalIngresos - totalEgresos) * 100) / 100;
    const saldoFinal = Math.round(saldoProgresivo * 100) / 100;

    // Para la presentación visual, ordenar del más reciente al más antiguo
    const movimientosOrdenadosVista = [...movimientosEnPeriodo].reverse();

    return {
      saldoInicial,
      totalIngresos,
      totalEgresos,
      flujoNeto,
      saldoFinal,
      movimientos: movimientosOrdenadosVista
    };
  }
}
