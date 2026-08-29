import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { LoginComponent } from './modules/auth/login.component';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { DashboardComponent } from './modules/dashboard/dashboard.component';
import { VentasComponent } from './modules/ventas/ventas.component';
import { InventarioComponent } from './modules/inventario/inventario.component';
import { MovimientosComponent } from './modules/movimientos/movimientos.component';
import { GastosComponent } from './modules/gastos/gastos.component';
import { PedidosComponent } from './modules/pedidos/pedidos.component';
import { CortesComponent } from './modules/cortes/cortes.component';
import { ReportesComponent } from './modules/reportes/reportes.component';
import { ConfiguracionComponent } from './modules/configuracion/configuracion.component';
import { BitacoraComponent } from './modules/bitacora/bitacora.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'ventas', component: VentasComponent },
      { path: 'inventario', component: InventarioComponent },
      { path: 'productos', redirectTo: 'inventario', pathMatch: 'full' },
      { path: 'movimientos', component: MovimientosComponent },
      { path: 'gastos', component: GastosComponent },
      { path: 'pedidos', component: PedidosComponent },
      { path: 'cortes', component: CortesComponent },
      { path: 'reportes', component: ReportesComponent },
      { path: 'bitacora', component: BitacoraComponent },
      { path: 'configuracion', component: ConfiguracionComponent },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
