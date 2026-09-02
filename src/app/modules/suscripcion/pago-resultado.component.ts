import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SuscripcionService } from '../../core/services/suscripcion.service';

@Component({
  selector: 'app-pago-resultado',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="result-container">
      <div class="result-card">
        @if (status === 'success') {
          <div class="icon-result success">🎉</div>
          <h2>¡Pago Aprobado con Éxito!</h2>
          <p class="desc">Tu suscripción ha sido actualizada y tu acceso está completamente activo.</p>
          <div class="info-tag">
            <span>Plan: <strong>{{ plan }}</strong></span>
            <span>Vigencia: <strong>+{{ meses }} mes(es)</strong></span>
          </div>
          <a routerLink="/dashboard" class="btn btn-primary">🚀 Ir al Punto de Venta</a>
        } @else if (status === 'pending') {
          <div class="icon-result pending">⏳</div>
          <h2>Pago Pendiente de Acreditación</h2>
          <p class="desc">Si pagaste por Oxxo o Transferencia SPEI, tu acceso se activará en cuanto Mercado Pago confirme la recepción del depósito.</p>
          <a routerLink="/dashboard" class="btn btn-secondary">Regresar al Inicio</a>
        } @else {
          <div class="icon-result failure">❌</div>
          <h2>El Pago no pudo procesarse</h2>
          <p class="desc">La transacción fue declinada o cancelada. Puedes intentar nuevamente con otro método de pago.</p>
          <a routerLink="/planes" class="btn btn-primary">Reintentar Pago</a>
        }
      </div>
    </div>
  `,
  styles: [`
    .result-container {
      min-height: 80vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .result-card {
      background: white;
      border-radius: 16px;
      padding: 36px 28px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.08);
      border: 1px solid #e2e8f0;

      .icon-result {
        font-size: 3.5rem;
        margin-bottom: 14px;
      }
      h2 { color: #0f172a; margin: 0 0 8px; font-weight: 800; }
      .desc { color: #64748b; font-size: 0.92rem; margin: 0 0 20px; line-height: 1.5; }
      .info-tag {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px;
        display: flex;
        justify-content: space-around;
        font-size: 0.88rem;
        margin-bottom: 24px;
      }
      .btn {
        display: inline-block;
        padding: 12px 24px;
        border-radius: 10px;
        font-weight: 700;
        text-decoration: none;
        width: 100%;
      }
      .btn-primary { background: #0284c7; color: white; }
      .btn-secondary { background: #e2e8f0; color: #334155; }
    }
  `]
})
export class PagoResultadoComponent implements OnInit {
  private route = inject(ActivatedRoute);
  public suscripcionService = inject(SuscripcionService);

  public status = 'success';
  public plan = 'PRO';
  public meses = '1';

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      this.status = params['status'] || 'success';
      this.plan = params['plan'] || 'PRO';
      this.meses = params['meses'] || '1';
    });
  }
}
