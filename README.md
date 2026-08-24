# Sistema de Ventas y Control de Inventario

Sistema web moderno e interactivo para la gestión de inventario, punto de venta (POS), control de gastos, cortes de caja y pedidos personalizados. Conectado a **Firebase Cloud Firestore** con arquitectura de colecciones optimizada, soporte **offline (IndexedDB)** y despliegue en **Firebase Hosting**.

🌐 **Demo / Producción:** [https://sistemadeventas-d7877.web.app](https://sistemadeventas-d7877.web.app)

---

## 🚀 Características Principales

- **📊 Dashboard Interactivo:** Métricas financieras en tiempo real, balance de caja actual (efectivo vs. pagos bancarios), resumen de inventario y tendencias.
- **💳 Punto de Venta (POS):**
  - Búsqueda y escaneo de productos por código de barras.
  - Pagos combinados y desglosados (Efectivo, Tarjeta, Transferencia).
  - Impresión de tickets de venta formateados.
  - Carritos pendientes y apartados de productos.
- **📦 Control de Inventario:**
  - Registro y edición de productos con margen de ganancia, stock mínimo y banderas de precio variable.
  - Generación e impresión/descarga de códigos de barras (Code 39).
  - Búsqueda en tiempo real e historial de productos.
- **📋 Movimientos de Stock:** Registro clasificado de entradas, salidas y ajustes de inventario.
- **💸 Control de Gastos:**
  - Registro clasificado por categoría y por **Método de Pago** (Efectivo, Tarjeta, Transferencia).
  - Registro opcional de **Realizado por** (responsable del gasto).
  - **Desvinculación inteligente:** Los gastos con tarjeta/banco no afectan el efectivo físico en caja y se computan al saldo bancario neto.
- **🧾 Sistema de Cortes de Caja:**
  - Apertura con caja inicial (precargada automáticamente con la caja contada anterior).
  - Seguimiento de ventas, efectivo neto, cobros bancarios y gastos en efectivo vs. tarjeta.
  - Control de ingresos/retiros de caja y cálculo de diferencias al cierre.
  - Historial completo de cortes con exportación a CSV.
- **🛍️ Pedidos Personalizados:** Gestión de estados (Pendiente, En Proceso, Terminado, Entregado) con abonos parciales.
- **☁️ Firebase Cloud Firestore + Caché Offline:**
  - Arquitectura de colecciones atomizadas (`productos`, `ventas`, `gastos`, `movimientos`, `cortes`, `config`).
  - Persistencia offline en IndexedDB (**0 lecturas consumidas** al recargar el navegador).
  - Consultas acotadas por fecha/corte y sincronización multi-dispositivo en tiempo real.
- **💾 Respaldo y Configuración:** Exportación e importación completa en JSON y sincronización de datos del negocio.

---

## 🛠️ Requisitos

- Navegador web moderno (Google Chrome, Microsoft Edge, Mozilla Firefox, Safari).
- Para desarrollo local / despliegue: [Node.js](https://nodejs.org) v18+ y Firebase CLI (`npm i -g firebase-tools`).

---

## 🚀 Uso y Despliegue

### Acceso Web (Producción)
Simplemente ingresa a la aplicación desplegada en Firebase Hosting:
👉 **[https://sistemadeventas-d7877.web.app](https://sistemadeventas-d7877.web.app)**

### Despliegue a Firebase Hosting
Si realizas cambios en el código y deseas desplegarlos:

```bash
firebase deploy
```

---

## 📁 Estructura del proyecto

```
├── index.html               # Interfaz principal de la aplicación
├── script.js                # Lógica de negocio y sincronización con Firebase Firestore
├── styles.css               # Estilos visuales del sistema
├── environment.js          # Credenciales de entorno de Firebase
├── firebase.json            # Configuración de Firebase Hosting y Firestore
├── .firebaserc              # Proyecto activo de Firebase
├── login.html               # Pantalla de inicio de sesión / autenticación
├── login.js                 # Manejo de usuarios y autenticación Firebase Auth
├── 404.html                 # Página de error 404 personalizada
├── assets/                  # Recursos multimedia (sonidos, etc.)
└── backend/                 # Backend opcional para red local HTTP fallback
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.