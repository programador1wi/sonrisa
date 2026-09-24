# Sonrisa

Prototipo local de simulación visual estética de ortodoncia. Parte de una fotografía real, conserva su archivo original intacto, permite marcar los dientes y produce tres fotografías independientes mediante Gemini Image u OpenAI Images. La aprobación de cada candidato es humana. No ofrece diagnóstico ni predice movimientos o tiempos clínicos.

## Requisitos

- Node.js 24.13.0 (indicado en .node-version) y npm.
- Clave API del proveedor elegido, con acceso al modelo de imagen seleccionado. Iniciar sesión o suscribirse a ChatGPT no sustituye una clave API de la plataforma OpenAI.
- Microsoft Edge para la prueba E2E local; las pruebas E2E usan un proveedor sintético y no llaman Gemini ni OpenAI.

## Instalar y ejecutar

Desde C:\Users\X\Documents\GitHub\Sonrisa:

    npm ci
    Copy-Item .env.example .env.local

Edita .env.local (o .env si ya lo utilizas). Elige **una** de estas configuraciones:

- Gemini: `IMAGE_PROVIDER=gemini` y `GEMINI_API_KEY=...`; modelo inicial `gemini-3-pro-image`.
- OpenAI: `IMAGE_PROVIDER=openai` y `OPENAI_API_KEY=...`; modelo inicial `gpt-image-2.5-sunburst`.

Obtén la clave de OpenAI en la plataforma API, no en la interfaz de ChatGPT: [guía oficial para crear una clave](https://developers.openai.com/api/docs/quickstart). Las claves permanecen en el servidor y nunca deben llevar prefijo `VITE_`. No se cambia automáticamente de proveedor si falta una clave, hay un error o se agota la cuota. El proveedor y el modelo quedan fijados en cada simulación. Si todavía no hubo intentos de generación, puedes asignar el proveedor activo al estudio existente desde la interfaz y conservar su foto y máscara. Después del primer intento, para continuar una simulación debes volver a seleccionar su proveedor original; para usar el otro, crea una nueva.

    npm run dev

Abre http://127.0.0.1:5173. El comando espera a que la API responda en 127.0.0.1:3001 antes de iniciar Vite. Si la API se reinicia mientras la página está abierta, la interfaz vuelve a cargar salud, historial y estudio automáticamente. Para servir la compilación desde Fastify:

    npm run build
    npm start

Abre http://127.0.0.1:3001. Solo se escucha en loopback. La base SQLite, originales, máscaras, recortes y resultados residen en data/, excluido de Git. SONRISA_DATA_DIR permite otro directorio local. Una instancia a la vez puede usar ese directorio.

## Uso

1. Carga JPEG o PNG de hasta 20 MB. AHORA apunta al archivo original sin recomprimir.
2. Amplía la boca y marca dientes y espacios internos necesarios con pincel, borrador o rectángulo numérico. El pincel empieza fino según la resolución; el círculo muestra su diámetro y el zoom llega a 8× respecto al encuadre inicial. Ampliar una foto pequeña no recupera detalles perdidos. Confirma la región dental.
3. Abre **Editar prompts** para ajustar las instrucciones comunes y las de 6 meses, 18 meses y final. La vista previa muestra el texto completo. **Guardar prompts** persiste los cambios solo en este estudio; no cambia imágenes ya generadas. El historial conserva el prompt enviado en cada intento.
4. Pulsa **Generar las 3 imágenes**. Se solicitan 6 meses, 18 meses y final en paralelo, usando el mismo original y recorte sin editar. Hay un máximo global de tres llamadas simultáneas, incluso entre estudios; el resto espera un lugar. Cada candidata aparece al terminar. Al repetir la secuencia se reemplazan los resultados vigentes; los intentos anteriores quedan en el historial.
5. Revisa las tres fotografías generadas y acepta o rechaza cada una. Al aceptar una etapa no se inicia otra petición; puedes regenerar expresamente una etapa o volver a solicitar la secuencia.
6. Descarga 01_month_6.png, 02_month_18.png y 03_final.png desde las etapas aceptadas. Las etiquetas y el aviso son HTML y quedan fuera de las fotos.

El modelo puede cambiar dientes de forma no deseada dentro de la máscara. La composición local garantiza, mediante comparación de píxeles decodificados, que no cambien los píxeles exteriores a esa máscara. Antes de mostrar un candidato para aceptación, otra comprobación compara el recorte generado con el original dentro de la selección y en un borde estrecho alrededor de la boca. Si detecta un cambio fotográfico grande, aparta esa etapa, guarda el recorte y su medición en el historial y permite regenerarla individualmente. También revisa candidatos antiguos aún pendientes al iniciar. Los resultados ya aceptados permanecen en su lugar. Esta comparación no reconoce anatomía dental ni garantiza brackets perfectos; revisa dientes, labios y progresión antes de aceptar.

Para respetar los límites de cada API, el servidor puede reducir y recomprimir solo las copias usadas como referencias del modelo. El archivo original y la copia de composición permanecen guardados sin esa reducción. Con OpenAI, el recorte dental y la máscara alfa se envían a 1024 × 1024, el tamaño solicitado para la salida; la foto completa sirve de referencia de identidad. Esto mantiene la misma cuadrícula de coordenadas durante la edición, pero no añade detalle real a una foto pequeña. [La máscara guía al modelo, pero no garantiza un límite exacto](https://developers.openai.com/api/docs/guides/image-generation). La composición local sigue imponiendo ese límite de píxeles en ambos proveedores.

Las fechas de las etapas son etiquetas de una ilustración estética, no una predicción de cuánto se moverán los dientes. El prompt propuesto de 6 meses prioriza la apariencia dental original y pide cambios mínimos; el de 18 meses muestra una mejora intermedia. Un fallo o timeout registra el intento y no dispara reintentos de pago automáticos. Un trabajo en curso al reiniciar queda como resultado desconocido para revisión. Gemini usa `store: false`; ambos proveedores reciben de nuevo las referencias necesarias en cada petición. Es necesario disponer de permiso para enviar las fotografías al proveedor elegido.

Al abrir la versión nueva, los estudios creados con la secuencia de 1 y 2 años conservan sus originales, máscaras, archivos e intentos anteriores. Las etapas vigentes vuelven a pendiente: evita presentar una foto de 2 años como si fuera de 18 meses. Inicia una secuencia nueva para obtener las tres etapas actuales.

Se restauraron los textos predeterminados anteriores de instrucciones comunes, 6 meses, 18 meses y final. Al iniciar, solo se revierten los campos que coinciden con la versión nueva; los textos personalizados y los prompts guardados en cada intento permanecen intactos. **Editar prompts → Restaurar textos propuestos** carga los textos anteriores en el borrador. El texto de 18 meses y final describe continuar visualmente la etapa previa, pero cada generación paralela recibe el original y el recorte sin editar, no una imagen de otra etapa.

La concurrencia elimina la espera entre etapas, pero no garantiza una reducción fija: depende del proveedor y de su cuota. Se mantienen el modelo, la calidad y la resolución configurados; el historial registra el tiempo del proveedor por resultado. Cada llamada puede tener costo aunque otra falle. No se reintenta automáticamente ninguna; puedes regenerar solo la fallida cuando el lote termine. Rechazar o regenerar una etapa independiente no invalida las otras. Las dependencias reales de intentos antiguos sí se respetan. La coherencia dental entre generaciones independientes requiere revisión visual.

## Verificación

    npm run lint
    npm run typecheck
    npm run test
    npm run build
    npm run test:e2e

test:e2e compila la app y lanza un servidor de prueba en 127.0.0.1:4173 con imágenes sintéticas; nunca usa tu clave. Con cinco simulaciones reales completas y aceptadas, npm run test:visual:live verifica nuevamente hash y píxeles exteriores. La forma y el realismo dental deben comprobarse visualmente por un operador en esas cinco fotografías.

La evaluación con fotografías reales y llamadas al proveedor no se ejecuta durante la instalación ni en la suite automática: requiere fotografías autorizadas y una clave API del proveedor seleccionado.
