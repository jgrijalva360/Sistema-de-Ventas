import { Component, signal, inject, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { SociosService } from '../../core/services/socios.service';
import { ReportesService } from '../../core/services/reportes.service';
import { GastosService } from '../../core/services/gastos.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { AuthService } from '../../core/services/auth.service';
import { SocioConfig, DetalleLiquidacionSocio, GastoBolsilloItem, LiquidacionSocios, AjusteEntreSocios, Gasto, Venta, Corte } from '../../core/models/models';
import { getFechaLocalString } from '../../shared/utils/date.util';

@Component({
  selector: 'app-socios',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './socios.component.html',
  styleUrl: './socios.component.scss'
})
export class SociosComponent implements OnInit {
  public Math = Math;
  public sociosService = inject(SociosService);
  private reportesService = inject(ReportesService);
  private gastosService = inject(GastosService);
  public sucursalesService = inject(SucursalesService);
  private authService = inject(AuthService);

  constructor() {
    effect(() => {
      const socios = this.sociosService.socios();
      if (socios && socios.length > 0) {
        this.sincronizarSociosEditables();
      }
    });

    effect(() => {
      const prestamos = this.sociosService.prestamosPendientes();
      this.ajustesEntreSocios.set([...prestamos]);
    }, { allowSignalWrites: true });
  }

  // Pestañas
  public tabActiva = signal<'CALCULADORA' | 'HISTORIAL' | 'CONFIG'>('CALCULADORA');

  // Filtros de Fecha
  public fechaDesde = signal<string>(getFechaLocalString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  public fechaHasta = signal<string>(getFechaLocalString());
  public sucursalSeleccionada = signal<string>('TODAS');

  // Descontar automáticamente de caja al liquidar
  public descontarDeCajaAutomatico = signal<boolean>(true);
  public metodoPagoSalida = signal<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');

  // Base de Cálculo: Flujo Operativo vs Utilidad FIFO
  public baseCalculo = signal<'FLUJO_EFECTIVO' | 'UTILIDAD_FIFO'>('FLUJO_EFECTIVO');

  // Mapeo local de gastos asignados a socios (idGasto -> idSocio)
  // 'EMPRESA' significa que lo pagó el negocio/caja
  public asignacionesGastos = signal<Record<string, string>>({});

  // Mapeo local de transferencias asignadas a socios (idVenta -> idSocio)
  public asignacionesTransferencias = signal<Record<string, string>>({});

  // Mapeo local de pagos con tarjeta asignados a socios (idVenta -> idSocio)
  public asignacionesTarjetas = signal<Record<string, string>>({});

  // Mapeo local de retiros/resguardos de caja asignados a socios (idCorte -> idSocio)
  public asignacionesResguardos = signal<Record<string, string>>({});

  // Gastos de bolsillo adicionales agregados manualmente para esta liquidación
  public gastosManuales = signal<GastoBolsilloItem[]>([]);

  // Formulario para nuevo gasto de bolsillo manual
  public nuevoGastoConcepto = signal<string>('');
  public nuevoGastoMonto = signal<number | null>(null);
  public nuevoGastoSocioId = signal<string>('');

  // Préstamos y ajustes directos entre socios (suma cero)
  public ajustesEntreSocios = signal<AjusteEntreSocios[]>([]);
  public mostrarFormAjuste = signal<boolean>(false);
  public nuevoAjusteDeudorId = signal<string>('');
  public nuevoAjusteAcreedorId = signal<string>('');
  public nuevoAjusteMonto = signal<number | null>(null);
  public nuevoAjusteConcepto = signal<string>('');

  // Edición temporal de configuración de socios
  public sociosEditables = signal<SocioConfig[]>([]);
  public nuevoSocioNombre = signal<string>('');
  public nuevoSocioPorcentaje = signal<number | null>(null);
  public guardandoConfig = signal<boolean>(false);
  public mensajeFeedback = signal<string | null>(null);

  // Modal para ver liquidación histórica
  public liquidacionSeleccionada = signal<LiquidacionSocios | null>(null);

  ngOnInit(): void {
    this.sincronizarSociosEditables();
    this.sociosService.cargarPrestamos();
  }

  sincronizarSociosEditables(): void {
    const list = this.sociosService.socios().map((s) => ({ ...s }));
    this.sociosEditables.set(list);
    if (list.length > 0 && !this.nuevoGastoSocioId()) {
      this.nuevoGastoSocioId.set(list[0].id);
    }
  }

  // --- MÉTODOS REACTIVOS DE RESOLUCIÓN DE SOCIO POR CONCEPTO/ITEM ---

  /**
   * Resuelve a qué socio le pertenece un gasto de forma totalmente reactiva y dinámica.
   * Evita problemas de condiciones de carrera cuando Firestore carga de forma asíncrona.
   */
  public obtenerSocioAsignadoGasto(g: Gasto): string {
    const manual = this.asignacionesGastos()[g.id];
    if (manual !== undefined) {
      return manual;
    }

    const socios = this.sociosService.sociosActivos();
    if (!socios || socios.length === 0) {
      return 'EMPRESA';
    }

    // 1. Si el gasto ya tiene socioId guardado en Firestore
    if (g.socioId && socios.some((s) => s.id === g.socioId)) {
      return g.socioId;
    }

    // 2. Si el campo persona coincide con el nombre de algún socio (búsqueda bidireccional)
    const persona = (g.persona || '').trim().toLowerCase();
    if (persona && !persona.includes('caja') && !persona.includes('empresa') && persona !== '-') {
      const socioEncontrado = socios.find((s) => {
        const sNom = s.nombre.trim().toLowerCase();
        return sNom === persona || persona.includes(sNom) || sNom.includes(persona);
      });
      if (socioEncontrado) {
        return socioEncontrado.id;
      }
    }

    return 'EMPRESA';
  }

  /**
   * Resuelve a qué socio le corresponde una transferencia de forma reactiva y dinámica.
   */
  public obtenerSocioTransferencia(v: Venta): string {
    const manual = this.asignacionesTransferencias()[v.id];
    if (manual !== undefined) {
      return manual;
    }

    const socios = this.sociosService.sociosActivos();
    if (v.socioTransferenciaId && socios.some((s) => s.id === v.socioTransferenciaId)) {
      return v.socioTransferenciaId;
    }

    const def = this.sociosService.socioTransferenciasDefault();
    return def ? def.id : (socios[0]?.id || '');
  }

  /**
   * Resuelve a qué socio le corresponde un cobro con tarjeta de forma reactiva y dinámica.
   */
  public obtenerSocioTarjeta(v: Venta): string {
    const manual = this.asignacionesTarjetas()[v.id];
    if (manual !== undefined) {
      return manual;
    }

    const socios = this.sociosService.sociosActivos();
    if (v.socioTarjetaId && socios.some((s) => s.id === v.socioTarjetaId)) {
      return v.socioTarjetaId;
    }

    const def = this.sociosService.socioTarjetasDefault();
    return def ? def.id : (socios[0]?.id || '');
  }

  /**
   * Resuelve a qué socio le corresponde un retiro/resguardo de caja de forma reactiva y dinámica.
   */
  public obtenerSocioResguardo(c: Corte): string {
    const manual = this.asignacionesResguardos()[c.id];
    if (manual !== undefined) {
      return manual;
    }

    const socios = this.sociosService.sociosActivos();
    if (c.socioRetiroId && socios.some((s) => s.id === c.socioRetiroId)) {
      return c.socioRetiroId;
    }

    const def = this.sociosService.socioResguardosDefault();
    return def ? def.id : (socios[0]?.id || '');
  }

  // Métodos retrocompatibles
  autoAsignarGastosPorNombre(): void {}
  autoAsignarTransferencias(): void {}
  autoAsignarTarjetas(): void {}
  autoAsignarResguardos(): void {}

  // --- FILTRADOS DEL PERIODO ---
  public ventasFiltradas = computed(() => {
    return this.reportesService.filtrarVentas(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public cobrosPedidosFiltrados = computed(() => {
    return this.reportesService.obtenerCobrosPedidos(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public gastosFiltrados = computed(() => {
    return this.reportesService
      .filtrarGastos(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada())
      .filter((g) => g.categoria !== 'REPARTO_SOCIOS');
  });

  // Determinar si una venta registrada proviene del cobro de un pedido personalizado
  public esVentaDePedido(v: Venta): boolean {
    if (!v.items || v.items.length === 0) return false;
    return v.items.some((it) => {
      const cod = (it.codigo || '').toUpperCase();
      const nom = (it.nombre || '').toUpperCase();
      return (
        cod.startsWith('PED') ||
        cod.includes('PED-') ||
        nom.includes('(PED') ||
        nom.includes('PED-') ||
        nom.includes('ANTICIPO') ||
        nom.includes('ABONO A CUENTA') ||
        nom.includes('LIQUIDACIÓN') ||
        nom.includes('LIQUIDACION')
      );
    });
  }

  // Ventas exclusivas de mostrador (excluyendo cobros/anticipos de pedidos ya registrados en ventas)
  public ventasMostradorFiltradas = computed(() => {
    return this.ventasFiltradas().filter((v) => !this.esVentaDePedido(v));
  });

  // Ventas que corresponden a abonos/pedidos registrados dentro de la colección 'ventas'
  public ventasPedidosFiltradas = computed(() => {
    return this.ventasFiltradas().filter((v) => this.esVentaDePedido(v));
  });

  // --- INGRESOS Y COSTOS ---
  // Total únicamente de ventas de mostrador
  public totalVentasMostrador = computed(() => {
    return this.ventasMostradorFiltradas().reduce((acc, v) => acc + (v.total || 0), 0);
  });

  // Alias para mantener compatibilidad en plantillas
  public totalVentas = this.totalVentasMostrador;

  // Total cobrado de pedidos (anticipos, abonos y liquidaciones)
  public totalCobrosPedidos = computed(() => {
    const directos = this.cobrosPedidosFiltrados().reduce((acc, c) => acc + (c.monto || 0), 0);
    const enVentas = this.ventasPedidosFiltradas().reduce((acc, v) => acc + (v.total || 0), 0);
    return directos > 0 ? directos : enVentas;
  });

  // Total real de ingresos consolidados en el periodo (Mostrador + Pedidos)
  public totalIngresosCobrados = computed(() => {
    return this.totalVentasMostrador() + this.totalCobrosPedidos();
  });

  public totalCostoMercanciaFifo = computed(() => {
    return this.ventasFiltradas().reduce((acc, v) => {
      const costoTicket = (v.items || []).reduce((sum, it) => sum + (it.costoTotalFifo || 0), 0);
      return acc + costoTicket;
    }, 0);
  });

  // --- DESGLOSE DE GASTOS: EMPRESA VS BOLSILLO DE SOCIOS ---
  public listaGastosBolsillo = computed<GastoBolsilloItem[]>(() => {
    const list: GastoBolsilloItem[] = [];
    const socios = this.sociosService.sociosActivos();
    const sociosMap = new Map(socios.map((s) => [s.id, s.nombre]));

    // 1. Gastos del sistema asignados a un socio
    this.gastosFiltrados().forEach((g) => {
      const socioId = this.obtenerSocioAsignadoGasto(g);
      if (socioId && socioId !== 'EMPRESA' && sociosMap.has(socioId)) {
        list.push({
          id: `gasto-sys-${g.id}`,
          concepto: g.concepto,
          monto: Number(g.monto) || 0,
          fecha: g.fecha,
          socioId,
          socioNombre: sociosMap.get(socioId) || 'Socio',
          origen: 'SISTEMA_GASTOS',
          gastoOriginalId: g.id
        });
      }
    });

    // 2. Gastos manuales adicionales
    this.gastosManuales().forEach((gm) => {
      if (sociosMap.has(gm.socioId)) {
        list.push({
          ...gm,
          socioNombre: sociosMap.get(gm.socioId) || 'Socio'
        });
      }
    });

    return list;
  });

  public totalGastosSocios = computed(() => {
    return this.listaGastosBolsillo().reduce((sum, g) => sum + g.monto, 0);
  });

  public totalGastosNegocio = computed(() => {
    return this.gastosFiltrados()
      .filter((g) => this.obtenerSocioAsignadoGasto(g) === 'EMPRESA')
      .reduce((sum, g) => sum + (Number(g.monto) || 0), 0);
  });

  public totalGastosGlobales = computed(() => {
    return this.totalGastosNegocio() + this.totalGastosSocios();
  });

  // --- TRANSFERENCIAS BANCARIAS DEL PERIODO ---
  public ventasConTransferencia = computed(() => {
    return this.ventasFiltradas().filter((v) => (v.pagos?.transferencia || 0) > 0);
  });

  public totalTransferenciasPeriodo = computed(() => {
    return this.ventasConTransferencia().reduce((sum, v) => sum + (v.pagos?.transferencia || 0), 0);
  });

  public transferenciasPorSocio = computed<Record<string, number>>(() => {
    const res: Record<string, number> = {};

    this.ventasConTransferencia().forEach((v) => {
      const monto = Number(v.pagos?.transferencia) || 0;
      const socioId = this.obtenerSocioTransferencia(v);
      if (socioId) {
        res[socioId] = Math.round(((res[socioId] || 0) + monto) * 100) / 100;
      }
    });

    return res;
  });

  onCambiarAsignacionTransferencia(ventaId: string, nuevoSocioId: string): void {
    const current = { ...this.asignacionesTransferencias() };
    current[ventaId] = nuevoSocioId;
    this.asignacionesTransferencias.set(current);
  }

  // --- PAGOS CON TARJETA DEL PERIODO ---
  public ventasConTarjeta = computed(() => {
    return this.ventasFiltradas().filter((v) => (v.pagos?.tarjeta || 0) > 0);
  });

  public totalTarjetasPeriodo = computed(() => {
    return this.ventasConTarjeta().reduce((sum, v) => sum + (v.pagos?.tarjeta || 0), 0);
  });

  public tarjetasPorSocio = computed<Record<string, number>>(() => {
    const res: Record<string, number> = {};

    this.ventasConTarjeta().forEach((v) => {
      const monto = Number(v.pagos?.tarjeta) || 0;
      const socioId = this.obtenerSocioTarjeta(v);
      if (socioId) {
        res[socioId] = Math.round(((res[socioId] || 0) + monto) * 100) / 100;
      }
    });

    return res;
  });

  onCambiarAsignacionTarjeta(ventaId: string, nuevoSocioId: string): void {
    const current = { ...this.asignacionesTarjetas() };
    current[ventaId] = nuevoSocioId;
    this.asignacionesTarjetas.set(current);
  }

  // --- CORTES Y DINERO RESGUARDADO DEL PERIODO ---
  public cortesFiltrados = computed(() => {
    return this.reportesService.filtrarCortes(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public cortesConRetiros = computed(() => {
    return this.cortesFiltrados().filter((c) => (c.retiros || 0) > 0);
  });

  public totalResguardosPeriodo = computed(() => {
    return this.cortesConRetiros().reduce((sum, c) => sum + (c.retiros || 0), 0);
  });

  public resguardosPorSocio = computed<Record<string, number>>(() => {
    const res: Record<string, number> = {};

    this.cortesConRetiros().forEach((c) => {
      const monto = Number(c.retiros) || 0;
      const socioId = this.obtenerSocioResguardo(c);
      if (socioId) {
        res[socioId] = Math.round(((res[socioId] || 0) + monto) * 100) / 100;
      }
    });

    return res;
  });

  onCambiarAsignacionResguardo(corteId: string, nuevoSocioId: string): void {
    const current = { ...this.asignacionesResguardos() };
    current[corteId] = nuevoSocioId;
    this.asignacionesResguardos.set(current);
  }

  // --- COMPARATIVA DE GANANCIAS ---
  // Caso 1: Flujo Operativo
  public utilidadBrutaFlujo = computed(() => {
    return this.totalIngresosCobrados() - this.totalGastosNegocio();
  });
  public gananciaNetaFlujo = computed(() => {
    return this.utilidadBrutaFlujo() - this.totalGastosSocios();
  });

  // Caso 2: Utilidad Contable FIFO
  public utilidadBrutaFifo = computed(() => {
    return this.totalIngresosCobrados() - this.totalCostoMercanciaFifo() - this.totalGastosNegocio();
  });
  public gananciaNetaFifo = computed(() => {
    return this.utilidadBrutaFifo() - this.totalGastosSocios();
  });

  // Base seleccionada activa para la liquidación
  public utilidadBrutaBaseSeleccionada = computed(() => {
    return this.baseCalculo() === 'FLUJO_EFECTIVO' ? this.utilidadBrutaFlujo() : this.utilidadBrutaFifo();
  });

  public gananciaNetaBaseSeleccionada = computed(() => {
    return this.baseCalculo() === 'FLUJO_EFECTIVO' ? this.gananciaNetaFlujo() : this.gananciaNetaFifo();
  });

  // --- AJUSTES Y PRÉSTAMOS ENTRE SOCIOS ---
  public ajustesPorSocio = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    this.ajustesEntreSocios().forEach((aj) => {
      // Acreedor suma (+)
      map[aj.socioAcreedorId] = Math.round(((map[aj.socioAcreedorId] || 0) + aj.monto) * 100) / 100;
      // Deudor resta (-)
      map[aj.socioDeudorId] = Math.round(((map[aj.socioDeudorId] || 0) - aj.monto) * 100) / 100;
    });
    return map;
  });

  public hayAjustesEntreSocios = computed(() => {
    return this.ajustesEntreSocios().length > 0;
  });

  async agregarAjusteEntreSocios(): Promise<void> {
    const deudorId = this.nuevoAjusteDeudorId();
    const acreedorId = this.nuevoAjusteAcreedorId();
    const monto = Number(this.nuevoAjusteMonto());
    const concepto = this.nuevoAjusteConcepto().trim();

    if (!deudorId || !acreedorId || deudorId === acreedorId || isNaN(monto) || monto <= 0) {
      alert('Por favor selecciona a ambos socios (deudor y acreedor deben ser diferentes) e introduce un monto válido mayor a 0.');
      return;
    }

    const socios = this.sociosService.sociosActivos();
    const deudor = socios.find((s) => s.id === deudorId);
    const acreedor = socios.find((s) => s.id === acreedorId);

    const nuevoAjuste: AjusteEntreSocios = {
      id: `ajuste-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      socioDeudorId: deudorId,
      socioDeudorNombre: deudor?.nombre || 'Socio Deudor',
      socioAcreedorId: acreedorId,
      socioAcreedorNombre: acreedor?.nombre || 'Socio Acreedor',
      monto,
      concepto: concepto || 'Préstamo personal',
      fecha: new Date().toISOString(),
      liquidado: false,
      usuarioRegistro: this.authService.nombreOperadorActual()
    };

    try {
      await this.sociosService.guardarAjusteEntreSocios(nuevoAjuste);
      this.nuevoAjusteMonto.set(null);
      this.nuevoAjusteConcepto.set('');
      this.mostrarMensajeFeedback('✅ Préstamo guardado en Firestore y aplicado a la liquidación.');
    } catch (err) {
      alert('Error al guardar el préstamo en Firestore.');
    }
  }

  async eliminarAjusteEntreSocios(id: string): Promise<void> {
    if (!confirm('¿Deseas eliminar este préstamo de Firestore?')) {
      return;
    }

    try {
      await this.sociosService.eliminarAjusteEntreSocios(id);
      this.mostrarMensajeFeedback('🗑️ Préstamo eliminado de Firestore.');
    } catch (err) {
      alert('Error al eliminar el préstamo en Firestore.');
    }
  }

  // --- LIQUIDACIÓN DETALLADA POR SOCIO ---
  public liquidacionCalculada = computed<DetalleLiquidacionSocio[]>(() => {
    const socios = this.sociosService.sociosActivos();
    const gananciaNeta = this.gananciaNetaBaseSeleccionada();
    const gastosSocios = this.listaGastosBolsillo();
    const totalGastosBolsillo = this.totalGastosSocios();
    const transfPorSocio = this.transferenciasPorSocio();
    const tarjPorSocio = this.tarjetasPorSocio();
    const resgPorSocio = this.resguardosPorSocio();
    const ajustesMap = this.ajustesPorSocio();

    return socios.map((socio) => {
      const porc = Number(socio.porcentaje) || 0;
      const factor = porc / 100;

      // Ganancia neta proporcional asignada
      const gananciaAsignada = Math.round((gananciaNeta * factor) * 100) / 100;

      // Gastos que este socio puso de su bolsa
      const gastosBolsilloAportados = gastosSocios
        .filter((g) => g.socioId === socio.id)
        .reduce((sum, g) => sum + g.monto, 0);

      // Cuota de gastos de bolsillo que le correspondía absorber
      const cuotaGastosBolsillo = Math.round((totalGastosBolsillo * factor) * 100) / 100;

      // Transferencias bancarias recibidas directamente en su cuenta
      const transferenciasRecibidas = Math.round((transfPorSocio[socio.id] || 0) * 100) / 100;

      // Pagos con tarjeta recibidos directamente en su cuenta/terminal
      const tarjetasRecibidas = Math.round((tarjPorSocio[socio.id] || 0) * 100) / 100;

      // Dinero en efectivo retirado de caja y bajo su resguardo/custodia
      const resguardosRecibidos = Math.round((resgPorSocio[socio.id] || 0) * 100) / 100;

      // Ajuste directo entre socios (préstamos personales / suma cero)
      const ajusteDirecto = Math.round((ajustesMap[socio.id] || 0) * 100) / 100;

      // Monto Neto que se le debe entregar de caja:
      // Ganancia Neta Asignada + Reembolso Íntegro de su gasto de bolsillo - Transferencias - Tarjetas - Dinero Resguardado + Ajuste Directo
      const montoNetoACobrar = Math.round((gananciaAsignada + gastosBolsilloAportados - transferenciasRecibidas - tarjetasRecibidas - resguardosRecibidos + ajusteDirecto) * 100) / 100;

      return {
        socioId: socio.id,
        nombre: socio.nombre,
        porcentaje: porc,
        gananciaAsignada,
        gastosBolsilloAportados,
        cuotaGastosBolsillo,
        transferenciasRecibidas,
        tarjetasRecibidas,
        resguardosRecibidos,
        ajusteDirecto,
        montoNetoACobrar
      };
    });
  });

  public totalNetoRepartido = computed(() => {
    return this.liquidacionCalculada().reduce((sum, s) => sum + s.montoNetoACobrar, 0);
  });

  // --- ACCIONES DE GASTOS ---
  onCambiarAsignacionGasto(gastoId: string, nuevoSocioId: string): void {
    const current = { ...this.asignacionesGastos() };
    current[gastoId] = nuevoSocioId;
    this.asignacionesGastos.set(current);
  }

  agregarGastoManual(): void {
    const concepto = this.nuevoGastoConcepto().trim();
    const monto = Number(this.nuevoGastoMonto());
    const socioId = this.nuevoGastoSocioId();

    if (!concepto || !monto || monto <= 0 || !socioId) return;

    const socio = this.sociosService.sociosActivos().find((s) => s.id === socioId);
    const nuevoItem: GastoBolsilloItem = {
      id: `manual-${Date.now()}`,
      concepto,
      monto,
      fecha: new Date().toISOString(),
      socioId,
      socioNombre: socio?.nombre || 'Socio',
      origen: 'MANUAL'
    };

    this.gastosManuales.set([...this.gastosManuales(), nuevoItem]);
    this.nuevoGastoConcepto.set('');
    this.nuevoGastoMonto.set(null);
  }

  eliminarGastoManual(id: string): void {
    this.gastosManuales.set(this.gastosManuales().filter((g) => g.id !== id));
  }

  // --- FILTROS RÁPIDOS DE FECHA ---
  seleccionarRango(tipo: 'HOY' | 'ESTE_MES' | 'MES_ANTERIOR' | 'QUINCENA_ACTUAL'): void {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const d = hoy.getDate();

    if (tipo === 'HOY') {
      const hoyStr = getFechaLocalString(hoy);
      this.fechaDesde.set(hoyStr);
      this.fechaHasta.set(hoyStr);
    } else if (tipo === 'ESTE_MES') {
      this.fechaDesde.set(getFechaLocalString(new Date(y, m, 1)));
      this.fechaHasta.set(getFechaLocalString(hoy));
    } else if (tipo === 'MES_ANTERIOR') {
      const primerDiaMesAnt = new Date(y, m - 1, 1);
      const ultimoDiaMesAnt = new Date(y, m, 0);
      this.fechaDesde.set(getFechaLocalString(primerDiaMesAnt));
      this.fechaHasta.set(getFechaLocalString(ultimoDiaMesAnt));
    } else if (tipo === 'QUINCENA_ACTUAL') {
      if (d <= 15) {
        this.fechaDesde.set(getFechaLocalString(new Date(y, m, 1)));
        this.fechaHasta.set(getFechaLocalString(new Date(y, m, 15)));
      } else {
        this.fechaDesde.set(getFechaLocalString(new Date(y, m, 16)));
        this.fechaHasta.set(getFechaLocalString(hoy));
      }
    }

    setTimeout(() => {
      this.autoAsignarGastosPorNombre();
      this.autoAsignarTransferencias();
      this.autoAsignarTarjetas();
      this.autoAsignarResguardos();
    }, 50);
  }

  // --- GUARDAR LIQUIDACIÓN EN FIRESTORE ---
  public guardandoLiquidacion = signal<boolean>(false);

  async onGuardarLiquidacion(): Promise<void> {
    if (!this.sociosService.porcentajesValidos()) {
      alert('La suma de los porcentajes de los socios debe ser exactamente 100% para poder guardar la liquidación.');
      return;
    }

    const totalReparto = this.totalNetoRepartido();
    const salidaTxt = this.descontarDeCajaAutomatico()
      ? `\n\n💸 Se registrará un gasto por $${totalReparto.toFixed(2)} (${this.metodoPagoSalida() === 'EFECTIVO' ? 'Efectivo: saldará la caja' : 'Transferencia'})`
      : '';

    if (!confirm(`¿Confirmas guardar el cierre de liquidación del periodo ${this.fechaDesde()} al ${this.fechaHasta()} en Firestore?${salidaTxt}`)) {
      return;
    }

    this.guardandoLiquidacion.set(true);
    try {
      const sucursal = this.sucursalesService.sucursalActiva();
      const nuevaLiq = await this.sociosService.guardarLiquidacion({
        fechaDesde: this.fechaDesde(),
        fechaHasta: this.fechaHasta(),
        baseCalculo: this.baseCalculo(),
        totalIngresos: this.totalIngresosCobrados(),
        totalCostoFifo: this.totalCostoMercanciaFifo(),
        totalGastosNegocio: this.totalGastosNegocio(),
        totalGastosSocios: this.totalGastosSocios(),
        totalTransferencias: this.totalTransferenciasPeriodo(),
        totalTarjetas: this.totalTarjetasPeriodo(),
        totalResguardos: this.totalResguardosPeriodo(),
        utilidadBaseReparto: this.gananciaNetaBaseSeleccionada(),
        socios: this.liquidacionCalculada(),
        gastosBolsilloDetalle: this.listaGastosBolsillo(),
        ajustesEntreSocios: this.ajustesEntreSocios(),
        usuarioRegistro: this.authService.nombreOperadorActual(),
        sucursalId: sucursal.id,
        sucursalNombre: sucursal.nombre
      });

      // Si está habilitado el descuento automático de caja como gasto
      if (this.descontarDeCajaAutomatico()) {
        const metodo = this.metodoPagoSalida();
        for (const s of nuevaLiq.socios) {
          if (s.montoNetoACobrar > 0) {
            await this.gastosService.registrarGasto({
              concepto: `Liquidación #${nuevaLiq.folio} - Pago a ${s.nombre} (${s.porcentaje}%)`,
              monto: s.montoNetoACobrar,
              categoria: 'REPARTO_SOCIOS',
              metodoPago: metodo,
              persona: s.nombre,
              socioId: s.socioId,
              observaciones: `Liquidación #${nuevaLiq.folio} (${nuevaLiq.fechaDesde} al ${nuevaLiq.fechaHasta}). Ganancia: $${s.gananciaAsignada.toFixed(2)} + Reembolso: $${s.gastosBolsilloAportados.toFixed(2)}${s.transferenciasRecibidas ? ` - Transf: $${s.transferenciasRecibidas.toFixed(2)}` : ''}${s.tarjetasRecibidas ? ` - Tarjeta: $${s.tarjetasRecibidas.toFixed(2)}` : ''}${s.resguardosRecibidos ? ` - Resguardo Caja: $${s.resguardosRecibidos.toFixed(2)}` : ''}${s.ajusteDirecto ? ` ${s.ajusteDirecto > 0 ? '+' : ''}$${s.ajusteDirecto.toFixed(2)} (Ajuste)` : ''}`
            });
          }
        }
      }

      // Marcar los préstamos aplicados como liquidados en Firestore
      const idsAjustes = (nuevaLiq.ajustesEntreSocios || []).map((a) => a.id);
      if (idsAjustes.length > 0) {
        await this.sociosService.liquidarAjustes(idsAjustes, nuevaLiq.folio || nuevaLiq.id);
      }

      this.mostrarMensajeFeedback(`✅ Liquidación #${nuevaLiq.folio} guardada con éxito${this.descontarDeCajaAutomatico() ? ' y registrada en gastos para saldar la caja' : ''}.`);
      this.tabActiva.set('HISTORIAL');
    } catch (err) {
      console.error('Error al guardar liquidación:', err);
      alert('Hubo un error al guardar la liquidación en Firestore.');
    } finally {
      this.guardandoLiquidacion.set(false);
    }
  }

  // --- COPIAR RESUMEN PARA WHATSAPP ---
  copiarParaWhatsApp(): void {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const baseTexto = this.baseCalculo() === 'FLUJO_EFECTIVO' ? 'Flujo de Caja Operativo' : 'Utilidad Real (Costo FIFO)';
    const ingresos = this.totalIngresosCobrados().toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const gastosNegocio = this.totalGastosNegocio().toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const gastosSocios = this.totalGastosSocios().toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const gananciaNeta = this.gananciaNetaBaseSeleccionada().toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let txt = `📊 *LIQUIDACIÓN Y REPARTO DE UTILIDADES*\n`;
    txt += `📅 *Periodo:* ${desde} al ${hasta}\n`;
    txt += `⚖️ *Cálculo Base:* ${baseTexto}\n\n`;
    txt += `💰 *Ingresos Cobrados:* $${ingresos}\n`;
    if (this.baseCalculo() === 'UTILIDAD_FIFO') {
      const costo = this.totalCostoMercanciaFifo().toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      txt += `📦 *Costo Mercancía (FIFO):* -$${costo}\n`;
    }
    txt += `🏢 *Gastos Operativos Negocio:* -$${gastosNegocio}\n`;
    txt += `👛 *Gastos de Bolsillo de Socios:* -$${gastosSocios}\n`;
    txt += `✨ *Ganancia Neta a Repartir:* $${gananciaNeta}\n\n`;
    txt += `🤝 *DESGLOSE POR SOCIO:*\n`;
    txt += `------------------------------------\n`;

    this.liquidacionCalculada().forEach((s) => {
      const neto = s.montoNetoACobrar.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const ganancia = s.gananciaAsignada.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const aportado = s.gastosBolsilloAportados.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      txt += `👤 *${s.nombre}* (${s.porcentaje}%):\n`;
      txt += `   • Ganancia: $${ganancia}\n`;
      if (s.gastosBolsilloAportados > 0) {
        txt += `   • Reembolso Gastos: +$${aportado}\n`;
      }
      if (s.transferenciasRecibidas && s.transferenciasRecibidas > 0) {
        const transf = s.transferenciasRecibidas.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        txt += `   • Transf. Recibidas en su cuenta: -$${transf}\n`;
      }
      if (s.tarjetasRecibidas && s.tarjetasRecibidas > 0) {
        const tarj = s.tarjetasRecibidas.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        txt += `   • Tarjetas Recibidas en su terminal/cuenta: -$${tarj}\n`;
      }
      if (s.resguardosRecibidos && s.resguardosRecibidos > 0) {
        const resg = s.resguardosRecibidos.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        txt += `   • Dinero de caja resguardado: -$${resg}\n`;
      }
      if (s.ajusteDirecto && s.ajusteDirecto !== 0) {
        const signo = s.ajusteDirecto > 0 ? '+' : '';
        const ajTxt = s.ajusteDirecto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        txt += `   • Ajuste / Préstamo directo: ${signo}$${ajTxt}\n`;
      }
      txt += `   👉 *TOTAL A ENTREGAR EN CAJA: $${neto}*\n\n`;
    });

    txt += `*Generado por Stockup POS*`;

    navigator.clipboard.writeText(txt).then(() => {
      this.mostrarMensajeFeedback('📋 ¡Resumen copiado al portapapeles listo para enviar por WhatsApp!');
    }).catch(() => {
      alert('No se pudo copiar automáticamente. Por favor copia el texto manualmente.');
    });
  }

  // --- ADMINISTRACIÓN DE SOCIOS (CONFIG) ---
  agregarNuevoSocio(): void {
    const nom = this.nuevoSocioNombre().trim();
    const porc = Number(this.nuevoSocioPorcentaje());

    if (!nom || isNaN(porc) || porc <= 0 || porc > 100) {
      alert('Ingresa un nombre válido y un porcentaje entre 1 y 100.');
      return;
    }

    const nuevo: SocioConfig = {
      id: `socio-${Date.now()}`,
      nombre: nom,
      porcentaje: porc,
      activo: true
    };

    this.sociosEditables.set([...this.sociosEditables(), nuevo]);
    this.nuevoSocioNombre.set('');
    this.nuevoSocioPorcentaje.set(null);
  }

  marcarSocioTransferenciasDefault(id: string): void {
    const list = this.sociosEditables().map((s) => ({
      ...s,
      recibeTransferenciasDefault: s.id === id
    }));
    this.sociosEditables.set(list);
  }

  marcarSocioTarjetasDefault(id: string): void {
    const list = this.sociosEditables().map((s) => ({
      ...s,
      recibeTarjetasDefault: s.id === id
    }));
    this.sociosEditables.set(list);
  }

  marcarSocioResguardosDefault(id: string): void {
    const list = this.sociosEditables().map((s) => ({
      ...s,
      recibeResguardosDefault: s.id === id
    }));
    this.sociosEditables.set(list);
  }

  eliminarSocio(id: string): void {
    if (this.sociosEditables().length <= 1) {
      alert('Debe haber al menos 1 socio configurado.');
      return;
    }
    this.sociosEditables.set(this.sociosEditables().filter((s) => s.id !== id));
  }

  async guardarConfiguracionSocios(): Promise<void> {
    const list = this.sociosEditables();
    const total = list.filter((s) => s.activo !== false).reduce((sum, s) => sum + (Number(s.porcentaje) || 0), 0);

    if (Math.abs(total - 100) > 0.01) {
      if (!confirm(`La suma de los porcentajes es ${total}%. Lo ideal es que sume exactamente 100%. ¿Deseas guardar de todos modos?`)) {
        return;
      }
    }

    this.guardandoConfig.set(true);
    try {
      await this.sociosService.guardarSociosConfig(list);
      this.mostrarMensajeFeedback('✅ Configuración de socios guardada en Firestore.');
      this.autoAsignarGastosPorNombre();
    } catch (err) {
      alert('Error al guardar la configuración en Firestore.');
    } finally {
      this.guardandoConfig.set(false);
    }
  }

  // --- HISTORIAL ---
  verDetalleHistorico(liq: LiquidacionSocios): void {
    this.liquidacionSeleccionada.set(liq);
  }

  cerrarModalDetalle(): void {
    this.liquidacionSeleccionada.set(null);
  }

  async onEliminarLiquidacion(id: string): Promise<void> {
    const liqAEliminar = this.sociosService.liquidaciones().find((l) => l.id === id);
    if (!confirm('¿Deseas eliminar este registro histórico de liquidación?')) {
      return;
    }

    if (liqAEliminar?.folio) {
      const folioBuscado = liqAEliminar.folio;
      const gastosAsociados = this.gastosService
        .gastos()
        .filter((g) => g.categoria === 'REPARTO_SOCIOS' && (g.concepto.includes(folioBuscado) || (g.observaciones || '').includes(folioBuscado)));

      for (const ga of gastosAsociados) {
        try {
          await this.gastosService.eliminarGasto(ga.id);
        } catch (e) {
          console.warn('Error al eliminar gasto asociado a liquidación:', e);
        }
      }
    }

    await this.sociosService.eliminarLiquidacion(id);
    if (liqAEliminar?.folio) {
      await this.sociosService.reactivarAjustesLiquidados(liqAEliminar.folio);
    }
    if (this.liquidacionSeleccionada()?.id === id) {
      this.liquidacionSeleccionada.set(null);
    }
    this.mostrarMensajeFeedback('🗑️ Liquidación y sus gastos de salida eliminados.');
  }

  copiarHistoricoWhatsApp(liq: LiquidacionSocios): void {
    const baseTexto = liq.baseCalculo === 'FLUJO_EFECTIVO' ? 'Flujo de Caja Operativo' : 'Utilidad Real (Costo FIFO)';
    const total = liq.utilidadBaseReparto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let txt = `📊 *HISTÓRICO DE LIQUIDACIÓN #${liq.folio || liq.id}*\n`;
    txt += `📅 *Periodo:* ${liq.fechaDesde} al ${liq.fechaHasta}\n`;
    txt += `⚖️ *Base:* ${baseTexto}\n`;
    txt += `✨ *Ganancia Neta Repartida:* $${total}\n\n`;
    txt += `🤝 *ENTREGADO A CADA SOCIO:*\n`;

    liq.socios.forEach((s) => {
      const neto = s.montoNetoACobrar.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      let deduccionesTxt = '';
      if (s.transferenciasRecibidas && s.transferenciasRecibidas > 0) {
        deduccionesTxt += ` (Transf: -$${s.transferenciasRecibidas.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      }
      if (s.tarjetasRecibidas && s.tarjetasRecibidas > 0) {
        deduccionesTxt += ` (Tarjeta: -$${s.tarjetasRecibidas.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      }
      if (s.resguardosRecibidos && s.resguardosRecibidos > 0) {
        deduccionesTxt += ` (Resguardo Caja: -$${s.resguardosRecibidos.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      }
      if (s.ajusteDirecto && s.ajusteDirecto !== 0) {
        const signo = s.ajusteDirecto > 0 ? '+' : '';
        deduccionesTxt += ` (Ajuste: ${signo}$${s.ajusteDirecto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      }
      txt += `👤 *${s.nombre}* (${s.porcentaje}%): 👉 *$${neto}*${deduccionesTxt}\n`;
    });

    navigator.clipboard.writeText(txt).then(() => {
      this.mostrarMensajeFeedback('📋 ¡Resumen histórico copiado para WhatsApp!');
    });
  }

  private mostrarMensajeFeedback(msg: string): void {
    this.mensajeFeedback.set(msg);
    setTimeout(() => this.mensajeFeedback.set(null), 4000);
  }
}
