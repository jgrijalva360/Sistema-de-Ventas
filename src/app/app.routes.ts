import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { subscriptionGuard } from './core/guards/subscription.guard';
import { roleGuard } from './core/guards/role.guard';
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
import { SuscripcionVencidaComponent } from './modules/suscripcion/suscripcion-vencida.component';
import { PlanesSuscripcionComponent } from './modules/suscripcion/planes-suscripcion.component';
import { PagoResultadoComponent } from './modules/suscripcion/pago-resultado.component';
import { UsuariosAdminComponent } from './modules/administracion/usuarios-admin.component';
import { LandingPageComponent } from './modules/landing/landing-page.component';

export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent,
    pathMatch: 'full'
  },
  {
    path: 'inicio',
    component: LandingPageComponent
  },
  {
    path: 'login',
    component: LoginComponent
  },
  {
    path: 'suscripcion-vencida',
    component: SuscripcionVencidaComponent
  },
  {
    path: 'planes',
    component: PlanesSuscripcionComponent,
    canActivate: [authGuard]
  },
  {
    path: 'suscripcion/pago-resultado',
    component: PagoResultadoComponent,
    canActivate: [authGuard]
  },
  {
    path: 'app',
    component: MainLayoutComponent,
    canActivate: [authGuard, subscriptionGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'ventas', component: VentasComponent },
      { path: 'inventario', component: InventarioComponent, canActivate: [roleGuard(['ADMIN', 'ENCARGADO'])] },
      { path: 'productos', redirectTo: 'inventario', pathMatch: 'full' },
      { path: 'movimientos', component: MovimientosComponent, canActivate: [roleGuard(['ADMIN', 'ENCARGADO'])] },
      { path: 'gastos', component: GastosComponent, canActivate: [roleGuard(['ADMIN', 'ENCARGADO'])] },
      { path: 'pedidos', component: PedidosComponent },
      { path: 'cortes', component: CortesComponent },
      { path: 'reportes', component: ReportesComponent, canActivate: [roleGuard(['ADMIN', 'ENCARGADO'])] },
      { path: 'bitacora', component: BitacoraComponent, canActivate: [roleGuard(['ADMIN'])] },
      { path: 'configuracion', component: ConfiguracionComponent, canActivate: [roleGuard(['ADMIN'])] },
      { path: 'administracion', component: UsuariosAdminComponent, canActivate: [roleGuard(['ADMIN'])] },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },
  {
    path: 'dashboard',
    redirectTo: 'app/dashboard',
    pathMatch: 'full'
  },
  {
    path: 'ventas',
    redirectTo: 'app/ventas',
    pathMatch: 'full'
  },
  {
    path: 'inventario',
    redirectTo: 'app/inventario',
    pathMatch: 'full'
  },
  {
    path: 'pedidos',
    redirectTo: 'app/pedidos',
    pathMatch: 'full'
  },
  {
    path: 'cortes',
    redirectTo: 'app/cortes',
    pathMatch: 'full'
  },
  {
    path: 'reportes',
    redirectTo: 'app/reportes',
    pathMatch: 'full'
  },
  {
    path: 'configuracion',
    redirectTo: 'app/configuracion',
    pathMatch: 'full'
  },
  {
    path: 'administracion',
    redirectTo: 'app/administracion',
    pathMatch: 'full'
  },
  {
    path: 'bitacora',
    redirectTo: 'app/bitacora',
    pathMatch: 'full'
  },
  {
    path: 'movimientos',
    redirectTo: 'app/movimientos',
    pathMatch: 'full'
  },
  {
    path: 'gastos',
    redirectTo: 'app/gastos',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
