import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { FirebaseService } from '../../../core/services/firebase.service';
import { PedidoPublicoRastreo } from '../../../core/models/models';
import { CurrencyMxnPipe } from '../../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../../shared/pipes/fecha-local.pipe';

@Component({
  selector: 'app-rastreo-pedido',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './rastreo-pedido.component.html',
  styleUrls: ['./rastreo-pedido.component.scss']
})
export class RastreoPedidoComponent implements OnInit, OnDestroy {
  public cargando = signal<boolean>(true);
  public pedido = signal<PedidoPublicoRastreo | null>(null);
  public pedidoFinalizadoOInexistente = signal<boolean>(false);
  public errorMsg = signal<string>('');

  public empresaId = signal<string>('');
  public folio = signal<string>('');
  public folioInput = signal<string>('');

  private unsubscribe?: Unsubscribe;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private firebaseService: FirebaseService
  ) {}

  ngOnInit(): void {
    // 1. Escuchar parámetros de ruta
    this.route.paramMap.subscribe((params) => {
      // Prioridad 1: Token seguro opaco (/rastreo-pedido/:token)
      const token = params.get('token');
      if (token && token.trim()) {
        this.iniciarEscuchaPorClave(token.trim());
        return;
      }

      // Prioridad 2: Ruta legacy (/rastreo-pedido/:empresaId/:pedidoId)
      const emp = params.get('empresaId');
      const fol = params.get('pedidoId');
      if (emp && fol) {
        this.iniciarEscuchaPorClave(`${emp.trim()}_${fol.trim().toUpperCase()}`);
        return;
      }

      // Prioridad 3: Query params (?token=xxx o ?t=xxx o ?negocio=xxx&folio=yyy)
      this.route.queryParamMap.subscribe((qParams) => {
        const qToken = qParams.get('token') || qParams.get('t');
        if (qToken && qToken.trim()) {
          this.iniciarEscuchaPorClave(qToken.trim());
          return;
        }

        const qEmp = qParams.get('negocio') || qParams.get('empresa') || qParams.get('n') || '';
        const qFol = qParams.get('folio') || qParams.get('id') || qParams.get('f') || '';
        if (qEmp && qFol) {
          this.iniciarEscuchaPorClave(`${qEmp.trim()}_${qFol.trim().toUpperCase()}`);
        } else {
          this.cargando.set(false);
          this.pedidoFinalizadoOInexistente.set(true);
        }
      });
    });
  }

  ngOnDestroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  iniciarEscuchaPorClave(claveDoc: string): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    this.cargando.set(true);
    this.errorMsg.set('');
    this.pedidoFinalizadoOInexistente.set(false);

    const docRef = doc(this.firebaseService.firestore, 'pedidos_publicos', claveDoc);

    this.unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        this.cargando.set(false);
        if (docSnap.exists()) {
          const data = docSnap.data() as PedidoPublicoRastreo;
          this.pedido.set(data);
          this.folio.set(data.id);
          this.empresaId.set(data.empresaId);
          this.pedidoFinalizadoOInexistente.set(false);
        } else {
          // Si no existe, significa que ya fue ENTREGADO (auto-eliminado) o el token expiró
          this.pedido.set(null);
          this.pedidoFinalizadoOInexistente.set(true);
        }
      },
      (error) => {
        console.error('Error al consultar rastreo de pedido:', error);
        this.cargando.set(false);
        this.errorMsg.set('No fue posible conectar con el servidor para consultar el pedido.');
      }
    );
  }

  // Helpers de estado para Stepper
  getEtapaActual(estado: string | undefined): number {
    switch (estado) {
      case 'PENDIENTE':
        return 1;
      case 'EN_PROCESO':
        return 2;
      case 'TERMINADO':
      case 'LISTO':
        return 3;
      case 'ENTREGADO':
        return 4;
      case 'CANCELADO':
        return -1;
      default:
        return 1;
    }
  }

  getWhatsAppUrl(): string {
    const p = this.pedido();
    if (!p || !p.negocioTelefono) return '';
    const cleanPhone = p.negocioTelefono.replace(/\D/g, '');
    const msg = encodeURIComponent(
      `Hola ${p.negocioNombre || 'buenas tardes'}, tengo una duda sobre el estado de mi pedido #${p.id} a nombre de ${p.clienteNombre}.`
    );
    return `https://wa.me/${cleanPhone}?text=${msg}`;
  }

  getLlamarUrl(): string {
    const p = this.pedido();
    if (!p || !p.negocioTelefono) return '';
    const cleanPhone = p.negocioTelefono.replace(/\D/g, '');
    return `tel:${cleanPhone}`;
  }
}
