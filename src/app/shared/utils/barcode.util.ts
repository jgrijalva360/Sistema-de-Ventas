/**
 * Utilidad para generación y renderizado de Código de Barras (Code 128B) en Canvas
 */

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", // 0-9
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", // 10-19
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", // 20-29
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", // 30-39
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", // 40-49
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", // 50-59
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", // 60-69
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", // 70-79
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", // 80-89
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", // 90-99
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112" // 100-106 (104=Start B, 106=Stop)
];

const START_CODE_B = 104;
const STOP_CODE = 106;

/**
 * Codifica una cadena de texto en código de barras Code 128B
 */
export function encodeCode128B(text: string): number[] {
  const codes: number[] = [START_CODE_B];
  let checkSum = START_CODE_B;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const codePoint = charCode - 32; // Code 128B mapea ASCII 32..126 a 0..94
    if (codePoint >= 0 && codePoint <= 95) {
      codes.push(codePoint);
      checkSum += codePoint * (i + 1);
    }
  }

  const checkDigit = checkSum % 103;
  codes.push(checkDigit);
  codes.push(STOP_CODE);

  return codes;
}

/**
 * Dibuja el código de barras en un elemento HTMLCanvasElement con alta calidad
 */
export function renderBarcodeToCanvas(
  canvas: HTMLCanvasElement,
  code: string,
  productTitle: string = '',
  options: { scale?: number; height?: number; includeText?: boolean } = {}
): void {
  const scale = options.scale || 2;
  const barHeight = (options.height || 70) * scale;
  const includeText = options.includeText !== false;
  const quietZone = 20 * scale;

  const codes = encodeCode128B(code);
  let totalModules = 0;

  for (const c of codes) {
    const pattern = CODE128_PATTERNS[c] || '212222';
    for (const char of pattern) {
      totalModules += parseInt(char, 10);
    }
  }

  const moduleWidth = 2 * scale;
  const barcodeWidth = totalModules * moduleWidth;
  const totalWidth = barcodeWidth + quietZone * 2;
  const textHeaderHeight = productTitle ? 26 * scale : 10 * scale;
  const textFooterHeight = includeText ? 30 * scale : 10 * scale;
  const totalHeight = barHeight + textHeaderHeight + textFooterHeight;

  canvas.width = totalWidth;
  canvas.height = totalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Fondo blanco nítido
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Título del producto opcional en la parte superior
  if (productTitle) {
    ctx.fillStyle = '#1e293b';
    ctx.font = `bold ${12 * scale}px "Inter", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(productTitle.length > 35 ? productTitle.substring(0, 32) + '...' : productTitle, totalWidth / 2, 18 * scale);
  }

  // Dibujar barras del código 128
  let currentX = quietZone;
  const startY = textHeaderHeight;

  ctx.fillStyle = '#000000';
  for (const c of codes) {
    const pattern = CODE128_PATTERNS[c] || '212222';
    let isBar = true;
    for (const char of pattern) {
      const width = parseInt(char, 10) * moduleWidth;
      if (isBar) {
        ctx.fillRect(currentX, startY, width, barHeight);
      }
      currentX += width;
      isBar = !isBar;
    }
  }

  // Texto del código numérico en la parte inferior
  if (includeText) {
    ctx.fillStyle = '#0f172a';
    ctx.font = `600 ${14 * scale}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(code, totalWidth / 2, startY + barHeight + 20 * scale);
  }
}
