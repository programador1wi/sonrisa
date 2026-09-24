# Contrato UX de Sonrisa

## Business context sources
La solicitud actual del usuario define: original intacto, edición dental localizada, cambios tempranos muy discretos, prompts editables por estudio y generación de tres etapas con una sola acción. El backend en server/service.ts es propietario de las transiciones y referencias. El proveedor real tiene consumo externo y solo se llama tras una acción explícita.

## Canonical UI Map
| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | MaskEditor y formularios etiquetados | Plan y API | carga, máscara, revisión | E2E |
| Scrollbar | src/styles.css | DESIGN.md | documento, editor | E2E computed style |
| Toast | Notice en src/components/ui.tsx | Contrato UX | status, error | E2E live regions |
| CRUD | Workspace + api.ts | server/service.ts | guardar y permanecer, eliminar y salir | E2E full flow |
| Dialog | Dialog en src/components/ui.tsx | Contrato UX | confirmación, comparador | foco y Escape E2E |

## Flow ledger
- Crear: seleccionar JPEG/PNG, subir, entrar al detalle de esa simulación.
- Máscara: pincel fino según resolución, círculo del diámetro visible, borrador/deshacer/zoom hasta 8× y alternativa por rectángulo numérico. Las fotos pequeñas se amplían y centran, sin cambiar coordenadas fuente. Confirmar guarda; no inicia consumo. Cambios sin guardar disparan diálogo propio al navegar y beforeunload al cerrar pestaña.
- Prompts: un editor del estudio permite modificar instrucciones comunes y específicas de 6 meses, 18 meses y final. Muestra el prompt compuesto exacto antes de generar, valida campos no vacíos y protege cambios sin guardar. Guardar no altera resultados vigentes; cada intento conserva el texto enviado. Restaurar textos propuestos carga los textos anteriores solo en el borrador. La reversión de los nuevos predeterminados conserva campos personalizados e intentos históricos.
- Lote: un botón solicita las tres candidatas en paralelo desde el mismo original y recorte. Límite global: tres peticiones activas; las demás esperan un lugar libre. Cada resultado se guarda y muestra al terminar, sin esperar al resto. Una nueva secuencia invalida las tres salidas vigentes y conserva los intentos anteriores en el historial. El estado persiste durante recargas.
- Progresión: un plan visual común pide cambios mínimos a 6 meses, moderados a 18 meses y alineación natural sin brackets al final. Cada etapa usa solo el original; no requiere generar ni aprobar otra. El plazo no representa una predicción clínica. La coherencia entre etapas se revisa visualmente.
- Migración: los estudios antiguos mantienen fotografía, máscara, archivos e intentos históricos de 1 y 2 años. Las etapas vigentes vuelven a pendiente y se crean 6 meses, 18 meses y final para evitar etiquetar una imagen de 2 años como 18 meses.
- Proveedor: se elige explícitamente en `.env.local` antes de crear el estudio. La cabecera muestra el proveedor activo; un estudio creado con otro proveedor conserva sus archivos pero bloquea nuevas generaciones hasta restaurar su configuración.
- Revisión: las candidatas aparecen según terminan; el operador puede aceptar o rechazar una mientras otra sigue generándose. Aceptar enfoca la siguiente candidata disponible sin efectuar otra solicitud de pago.
- Control visual: antes de presentar una candidata, el servidor compara cuánto cambió la selección dental y el borde de boca que debía conservarse. Desvíos grandes quedan en estado fallido, sin imagen vigente para aceptar; el recorte apartado y las mediciones permanecen en el historial. Al iniciar, también se revisan candidatas antiguas todavía pendientes. Los resultados ya aceptados no se cambian. Esta comprobación no sustituye la revisión humana de la anatomía dental.
- Rechazar: conserva candidato e historial e invalida las etapas posteriores que dependían de él. Regenerar es explícito; no hay reintentos automáticos de generación.
- Fallos del lote: cada intento es independiente. Si falla uno o no supera el control visual, los otros continúan y pueden tener costo. No se reintenta automáticamente. Al terminar el lote, se puede regenerar solo una etapa; las demás salidas independientes permanecen vigentes.
- Invalidar: cambiar máscara o regenerar una etapa con dependientes aceptados requiere diálogo con consecuencia. Los candidatos históricos se conservan hasta eliminar la simulación.
- Eliminar: diálogo propio con foco inicial en cancelar; eliminación física de archivos locales. No se afirma eliminar datos ya enviados al proveedor.
- Estados: inicial/vacío/cargando/error/sin conexión/pendiente/generando/requiere revisión/aceptado/rechazado/fallido/interrumpido. En desarrollo, Vite inicia después de la API; si la primera carga falla durante un reinicio, la interfaz reintenta y retira el aviso al reconectar.
- Historial local paginado con cargar más; URL contiene solo ID de simulación. No hay nombres de paciente ni secretos en URL.
- Resultados: cuatro imágenes independientes, aviso de simulación fuera, descarga de cada PNG vigente aceptado. Original se sirve byte a byte.

## Locale and accessibility
es-MX, fechas locales formateadas con Intl, etiquetas de acción españolas. Controles semánticos; foco visible; diálogos nativos showModal con título, foco y restauración; nunca window.confirm/alert/prompt. Mensajes críticos persistentes. Canvas tiene alternativa sin arrastrar mediante rectángulo numérico. Historial y editor usan los mismos botones y avisos. Sin acciones destructivas ocultas tras iconos sin nombre.
