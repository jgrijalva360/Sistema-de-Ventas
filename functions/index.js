const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { MercadoPagoConfig, Payment, PreApproval, Preference } = require('mercadopago');

admin.initializeApp();
const db = admin.firestore();

// Token de Acceso de Mercado Pago (Leído de forma segura desde variables de entorno / .env)
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';

const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN
});

/**
 * Endpoint para crear la Preferencia de Pago oficial de Mercado Pago (Checkout Pro)
 */
exports.crearPreferenciaPago = functions.https.onRequest(async (req, res) => {
  // Configurar CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  try {
    const { empresaId, planId, meses, precio, titulo, email, nombreNegocio, returnUrl } = req.body;

    if (!empresaId || !precio) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (empresaId, precio).' });
    }

    const preferenceInstance = new Preference(client);
    // Mercado Pago requiere URLs HTTPS públicas para auto_return
    const isHttps = returnUrl && returnUrl.startsWith('https://');
    const origin = isHttps ? returnUrl : 'https://sistemadeventas-d7877.web.app';

    const preferenceBody = {
      items: [
        {
          id: `PLAN-${planId || 'PRO'}`,
          title: `Stockup POS: ${titulo || 'Membresía'}`,
          description: `Software Punto de Venta Stockup para ${nombreNegocio || 'Negocio'}`,
          quantity: 1,
          currency_id: 'MXN',
          unit_price: Number(precio)
        }
      ],
      payer: {
        email: email || 'cliente@stockup.com',
        name: nombreNegocio || 'Cliente'
      },
      external_reference: `${empresaId}|${planId || 'PRO'}|${meses || 1}`,
      back_urls: {
        success: `${origin}/suscripcion/pago-resultado?status=success&plan=${planId}&meses=${meses}`,
        pending: `${origin}/suscripcion/pago-resultado?status=pending&plan=${planId}&meses=${meses}`,
        failure: `${origin}/suscripcion/pago-resultado?status=failure`
      },
      auto_return: 'approved',
      statement_descriptor: 'STOCKUP POS'
    };

    const preference = await preferenceInstance.create({
      body: preferenceBody
    });

    console.log(`[Crear Preferencia] Preferencia generada: ${preference.id}`);
    return res.status(200).json({
      id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point
    });
  } catch (error) {
    console.error('[Crear Preferencia] Error:', error);
    return res.status(500).json({ error: error.message || 'Error al crear preferencia' });
  }
});

/**
 * Webhook Receptor de Eventos de Mercado Pago
 * Escucha pagos únicos (Checkout Pro) y suscripciones recurrentes (PreApproval)
 */
exports.webhookMercadoPago = functions.https.onRequest(async (req, res) => {
  try {
    const topic = req.query.topic || req.query.type || req.body?.type;
    const id = req.query.id || req.query['data.id'] || req.body?.data?.id;

    console.log(`[Webhook MP] Evento recibido: ${topic} con ID: ${id}`);

    if (!id) {
      return res.status(200).send('No ID provided');
    }

    // 1. Caso: Pago individual o cuota de suscripción (payment)
    if (topic === 'payment') {
      const paymentInstance = new Payment(client);
      const payment = await paymentInstance.get({ id });

      console.log(`[Webhook MP] Estado del pago ${id}: ${payment.status}`);

      if (payment.status === 'approved') {
        const externalRef = payment.external_reference; // Formato: "empresaId|planId|meses"
        if (externalRef) {
          const [empresaId, planId, mesesStr] = externalRef.split('|');
          const meses = parseInt(mesesStr, 10) || 1;

          await aplicarRenovacionSuscripcion(empresaId, planId || 'PRO', meses, {
            idPago: String(payment.id),
            monto: payment.transaction_amount,
            metodo: payment.payment_method_id,
            fecha: payment.date_approved
          });
        }
      }
    }

    // 2. Caso: Suscripción recurrente autorizada (subscription_preapproval)
    if (topic === 'subscription_preapproval' || topic === 'preapproval') {
      const preapprovalInstance = new PreApproval(client);
      const preapproval = await preapprovalInstance.get({ id });

      console.log(`[Webhook MP] Estado de Suscripción Recurrente ${id}: ${preapproval.status}`);

      if (preapproval.status === 'authorized') {
        const empresaId = preapproval.external_reference;
        if (empresaId) {
          await aplicarRenovacionSuscripcion(empresaId, 'PRO', 1, {
            idPago: `SUB-${id}`,
            monto: preapproval.auto_recurring?.transaction_amount,
            metodo: 'DEBITO_AUTOMATICO_MENSUAL',
            fecha: new Date().toISOString()
          });
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook MP] Error procesando webhook:', error);
    return res.status(500).send('Error');
  }
});

/**
 * Función auxiliar para extender la vigencia en Firestore
 */
async function aplicarRenovacionSuscripcion(empresaId, plan, meses, ultimoPago) {
  const subRef = db.collection('suscripciones').doc(empresaId);
  const snap = await subRef.get();

  let baseDate = new Date();

  if (snap.exists) {
    const data = snap.data();
    const actualVencimiento = new Date(data.fechaVencimiento || 0);
    // Si aún no vence, sumar a partir de la fecha de vencimiento actual
    if (actualVencimiento.getTime() > baseDate.getTime()) {
      baseDate = actualVencimiento;
    }
  }

  // Sumar los meses pagados
  baseDate.setMonth(baseDate.getMonth() + meses);

  const updateData = {
    plan: plan || 'PRO',
    estado: 'ACTIVA',
    fechaVencimiento: baseDate.toISOString(),
    ultimoPago: {
      ...ultimoPago,
      actualizadoEn: new Date().toISOString()
    },
    actualizadoEn: new Date().toISOString()
  };

  await subRef.set(updateData, { merge: true });
  console.log(`[Webhook MP] ✅ Suscripción de empresa ${empresaId} renovada hasta ${baseDate.toISOString()}`);
}
