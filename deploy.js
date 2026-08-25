const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function generarTimestampVersion() {
  const ahora = new Date();
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, '0');
  const d = String(ahora.getDate()).padStart(2, '0');
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  return `v2.1.${y}${m}${d}.${hh}${mm}`;
}

const nuevaVersion = generarTimestampVersion();
const scriptPath = path.join(__dirname, 'script.js');

console.log('--------------------------------------------------');
console.log(`🚀 Generando nueva versión automática: ${nuevaVersion}`);
console.log('--------------------------------------------------');

try {
  let contenido = fs.readFileSync(scriptPath, 'utf8');
  
  // Reemplazar la constante APP_VERSION
  const regexVersion = /const APP_VERSION = ["'][^"']+["'];/;
  if (regexVersion.test(contenido)) {
    contenido = contenido.replace(regexVersion, `const APP_VERSION = "${nuevaVersion}";`);
    fs.writeFileSync(scriptPath, contenido, 'utf8');
    console.log(`✅ script.js actualizado con APP_VERSION = "${nuevaVersion}"`);
  } else {
    console.warn('⚠️ No se encontró la constante APP_VERSION en script.js');
  }

  console.log('\n📦 Ejecutando despliegue en Firebase Hosting...');
  execSync('firebase deploy', { stdio: 'inherit' });
  
  console.log('\n--------------------------------------------------');
  console.log(`🎉 Despliegue completado con éxito! Versión activa: ${nuevaVersion}`);
  console.log('--------------------------------------------------\n');
} catch (error) {
  console.error('❌ Error durante el despliegue:', error.message);
  process.exit(1);
}
