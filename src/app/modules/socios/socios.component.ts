import { Component, signal, inject, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { SociosService } from '../../core/services/socios.service';
import { ReportesService } from '../../core/services/reportes.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { AuthService } from '../../core/services/auth.service';
import { SocioConfig, DetalleLiquidacionSocio, GastoBolsilloItem, LiquidacionSocios, Gasto, Venta } from '../../core/models/models';
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
  public sucursalesService = inject(SucursalesService);
  private authService = inject(AuthService);

  // Pestañas
  public tabActiva = signal<'CALCULADORA' | 'HISTORIAL' | 'CONFIG'>('CALCULADORA');

  // Filtros de Fecha
  public fechaDesde = signal<string>(getFechaLocalString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  public fechaHasta = signal<string>(getFechaLocalString());
  public sucursalSeleccionada = signal<string>('TODAS');

  // Base de Cálculo: Flujo Operativo vs Utilidad FIFO
  public baseCalculo = signal<'FLUJO_EFECTIVO' | 'UTILIDAD_FIFO'>('FLUJO_EFECTIVO');

  // Mapeo local de gastos asignados a socios (idGasto -> idSocio)
  // 'EMPRESA' significa que lo pagó el negocio/caja
  public asignacionesGastos = signal<Record<string, string>>({});

  // Gastos de bolsillo adicionales agregados manualmente para esta liquidación
  public gastosManuales = signal<GastoBolsilloItem[]>([]);

  // Formulario para nuevo gasto de bolsillo manual
  public nuevoGastoConcepto = signal<string>('');
  public nuevoGastoMonto = signal<number | null>(null);
  public nuevoGastoSocioId = signal<string>('');

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
    this.autoAsignarGastosPorNombre();
  }

  sincronizarSociosEditables(): void {
    const list = this.sociosService.socios().map((s) => ({ ...s }));
    this.sociosEditables.set(list);
    if (list.length > 0 && !this.nuevoGastoSocioId()) {
      this.nuevoGastoSocioId.set(list[0].id);
    }
  }

  // Auto-detectar si el campo `persona` del gasto coincide con algún socio
  autoAsignarGastosPorNombre(): void {
    const gastos = this.gastosFiltrados();
    const socios = this.sociosService.sociosActivos();
    const map: Record<string, string> = { ...this.asignacionesGastos() };

    gastos.forEach((g) => {
      if (!map[g.id]) {
        if (g.socioId && socios.some((s) => s.id === g.socioId)) {
          map[g.id] = g.socioId;
        } else {
          const persona = (g.persona || '').trim().toLowerCase();
          if (persona && !persona.includes('caja') && !persona.includes('empresa')) {
            const socioEncontrado = socios.find(
              (s) => s.nombre.trim().toLowerCase() === persona || persona.includes(s.nombre.trim().toLowerCase())
            );
            if (socioEncontrado) {
              map[g.id] = socioEncontrado.id;
            } else {
              map[g.id] = 'EMPRESA';
            }
          } else {
            map[g.id] = 'EMPRESA';
          }
        }
      }
    });

    this.asignacionesGastos.set(map);
  }

  // --- FILTRADOS DEL PERIODO ---
  public ventasFiltradas = computed(() => {
    return this.reportesService.filtrarVentas(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public cobrosPedidosFiltrados = computed(() => {
    return this.reportesService.obtenerCobrosPedidos(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
  });

  public gastosFiltrados = computed(() => {
    return this.reportesService.filtrarGastos(this.fechaDesde(), this.fechaHasta(), this.sucursalSeleccionada());
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
    const asignaciones = this.asignacionesGastos();
    const socios = this.sociosService.sociosActivos();
    const sociosMap = new Map(socios.map((s) => [s.id, s.nombre]));

    // 1. Gastos del sistema asignados a un socio
    this.gastosFiltrados().forEach((g) => {
      const socioId = asignaciones[g.id];
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
    const asignaciones = this.asignacionesGastos();
    return this.gastosFiltrados()
      .filter((g) => !asignaciones[g.id] || asignaciones[g.id] === 'EMPRESA')
      .reduce((sum, g) => sum + (Number(g.monto) || 0), 0);
  });

  public totalGastosGlobales = computed(() => {
    return this.totalGastosNegocio() + this.totalGastosSocios();
  });

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

  // --- LIQUIDACIÓN DETALLADA POR SOCIO ---
  public liquidacionCalculada = computed<DetalleLiquidacionSocio[]>(() => {
    const socios = this.sociosService.sociosActivos();
    const gananciaNeta = this.gananciaNetaBaseSeleccionada();
    const gastosSocios = this.listaGastosBolsillo();
    const totalGastosBolsillo = this.totalGastosSocios();

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

      // Monto Neto que se le debe entregar:
      // Ganancia Neta Asignada + Reembolso Íntegro de su gasto de bolsillo
      const montoNetoACobrar = Math.round((gananciaAsignada + gastosBolsilloAportados) * 100) / 100;

      return {
        socioId: socio.id,
        nombre: socio.nombre,
        porcentaje: porc,
        gananciaAsignada,
        gastosBolsilloAportados,
        cuotaGastosBolsillo,
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

    setTimeout(() => this.autoAsignarGastosPorNombre(), 50);
  }

  // --- GUARDAR LIQUIDACIÓN EN FIRESTORE ---
  public guardandoLiquidacion = signal<boolean>(false);

  async onGuardarLiquidacion(): Promise<void> {
    if (!this.sociosService.porcentajesValidos()) {
      alert('La suma de los porcentajes de los socios debe ser exactamente 100% para poder guardar la liquidación.');
      return;
    }

    if (!confirm(`¿Confirmas guardar el cierre de liquidación del periodo ${this.fechaDesde()} al ${this.fechaHasta()} en Firestore?`)) {
      return;
    }

    this.guardandoLiquidacion.set(true);
    try {
      const sucursal = this.sucursalesService.sucursalActiva();
      await this.sociosService.guardarLiquidacion({
        fechaDesde: this.fechaDesde(),
        fechaHasta: this.fechaHasta(),
        baseCalculo: this.baseCalculo(),
        totalIngresos: this.totalIngresosCobrados(),
        totalCostoFifo: this.totalCostoMercanciaFifo(),
        totalGastosNegocio: this.totalGastosNegocio(),
        totalGastosSocios: this.totalGastosSocios(),
        utilidadBaseReparto: this.gananciaNetaBaseSeleccionada(),
        socios: this.liquidacionCalculada(),
        gastosBolsilloDetalle: this.listaGastosBolsillo(),
        usuarioRegistro: this.authService.nombreOperadorActual(),
        sucursalId: sucursal.id,
        sucursalNombre: sucursal.nombre
      });

      this.mostrarMensajeFeedback('✅ Liquidación registrada con éxito en Firestore.');
      this.tabActiva.set('HISTORIAL');
    } catch (err) {
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
      txt += `   👉 *TOTAL A RECIBIR: $${neto}*\n\n`;
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
    if (confirm('¿Deseas eliminar este registro histórico de liquidación?')) {
      await this.sociosService.eliminarLiquidacion(id);
      if (this.liquidacionSeleccionada()?.id === id) {
        this.liquidacionSeleccionada.set(null);
      }
      this.mostrarMensajeFeedback('🗑️ Liquidación eliminada.');
    }
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
      txt += `👤 *${s.nombre}* (${s.porcentaje}%): 👉 *$${neto}*\n`;
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
