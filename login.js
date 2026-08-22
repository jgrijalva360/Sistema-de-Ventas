// ── Inicialización de Firebase Auth para Login ──────────────────────

function obtenerConfigFirebase() {
  if (typeof firebaseEnvironment !== "undefined" && firebaseEnvironment.apiKey) {
    return firebaseEnvironment;
  }
  try {
    const raw = localStorage.getItem("firebase_config_v1");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

const config = obtenerConfigFirebase();
if (config && typeof firebase !== "undefined") {
  if (!firebase.apps.length) {
    firebase.initializeApp(config);
  }
}

// Redirigir a index.html si el usuario ya está autenticado
if (typeof firebase !== "undefined" && firebase.auth) {
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      window.location.href = "index.html";
    }
  });
}

// Control de Rate-Limiting local contra ataques de fuerza bruta
let _intentosFallidosLocal = 0;
let _bloqueoHasta = 0;

// Función para procesar el login con validaciones de seguridad
async function realizarLogin(event) {
  event.preventDefault();
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const errorDiv = document.getElementById("loginError");
  const btnSubmit = document.getElementById("btnLoginSubmit");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  errorDiv.style.display = "none";

  // 1. Verificar bloqueo por múltiples intentos fallidos locales
  const ahora = Date.now();
  if (ahora < _bloqueoHasta) {
    const segundosRestantes = Math.ceil((_bloqueoHasta - ahora) / 1000);
    errorDiv.style.display = "block";
    errorDiv.innerText = `⛔ Demasiados intentos fallidos. Espera ${segundosRestantes} segundos antes de reintentar.`;
    return;
  }

  // 2. Validar formato de correo electrónico
  const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !regexEmail.test(email)) {
    errorDiv.style.display = "block";
    errorDiv.innerText = "⚠️ Por favor ingresa un correo electrónico válido.";
    return;
  }

  // 3. Validar longitud mínima de contraseña
  if (!password || password.length < 6) {
    errorDiv.style.display = "block";
    errorDiv.innerText = "⚠️ La contraseña debe tener al menos 6 caracteres.";
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.innerText = "Verificando...";

  try {
    // Establecer persistencia explícita en SESSION/LOCAL
    await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await firebase.auth().signInWithEmailAndPassword(email, password);

    _intentosFallidosLocal = 0;
    window.location.href = "index.html";
  } catch (error) {
    console.error("Error al iniciar sesión:", error.code);
    _intentosFallidosLocal++;

    // Si supera 5 intentos en la misma sesión, bloquear por 30 segundos
    if (_intentosFallidosLocal >= 5) {
      _bloqueoHasta = Date.now() + 30000;
      _intentosFallidosLocal = 0;
    }

    errorDiv.style.display = "block";

    switch (error.code) {
      case "auth/invalid-email":
        errorDiv.innerText = "❌ El correo electrónico ingresado no es válido.";
        break;
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        errorDiv.innerText = "❌ Correo electrónico o contraseña incorrectos.";
        break;
      case "auth/too-many-requests":
        errorDiv.innerText = "⚠️ Acceso temporalmente bloqueado por demasiados intentos. Intenta más tarde.";
        break;
      case "auth/network-request-failed":
        errorDiv.innerText = "🌐 Error de conexión. Revisa tu conexión a internet.";
        break;
      default:
        errorDiv.innerText = "❌ Error al iniciar sesión. Inténtalo nuevamente.";
    }
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = "Ingresar";
  }
}
