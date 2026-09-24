---
version: alpha
name: Sonrisa
description: Mesa local de revisión fotográfica de evolución dental con control por etapas.
colors:
  background: "#edf2f3"
  surface: "#ffffff"
  ink: "#153b40"
  muted: "#526a70"
  primary: "#18665f"
  tint: "#dfeee9"
  line: "#cddbdd"
  danger: "#a33732"
typography:
  display:
    fontFamily: "Manrope, system-ui, sans-serif"
  body:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  control: "8px"
  panel: "16px"
spacing:
  page-max: "1440px"
  header-height: "76px"
components:
  button:
    owner: "src/components/ui.tsx"
  dialog:
    owner: "src/components/ui.tsx"
  image-panel:
    owner: "src/components/ui.tsx"
---

# Sonrisa — contexto de diseño

## Subject and audience
Estudio local de simulación estética dental para un operador. Español de México. La tarea central es delimitar y revisar una fotografía real, con control explícito de la progresión. No es un diagnóstico ni un producto público.

## Visual direction
Mesa de revisión fotográfica clínica: superficies azul gris claro, texto petróleo y acento verde sobrio. La firma es una tira de cuatro fotogramas independientes con una línea temporal exterior a las fotografías. La fotografía manda; no hay imágenes de pacientes ficticios, efectos ornamentales ni promesas de resultados.

## Tokens and runtime ownership
La única fuente ejecutable es `src/styles.css`, bloque `:root`; este documento registra intención y valores. No hay adaptadores de otro framework.
- Fondo `--canvas: #edf2f3`; panel `--surface: #ffffff`.
- Tinta `--ink: #153b40`; secundario `--muted: #526a70`.
- Marca `--brand: #18665f`; suave `--tint: #dfeee9`.
- Borde `--line: #cddbdd`; peligro `--danger: #a33732`.
- Tipografía display: Manrope local; cuerpo: Source Sans 3 local; utilidades: monospace del sistema.
- Espaciado: múltiplos de 4px; radio de controles 8px, paneles 16px; foco visible de 3px.
- Movimiento discreto de 160ms, desactivado con reduced-motion; scrollbars globales visibles y gutter estable.

## Layout and responsive behavior
Cabecera sobria, historial a la izquierda y mesa de trabajo principal. Editor amplio más instrucciones en lateral; en móvil se apilan y la región de zoom posee su propio desplazamiento. El documento conserva el scroll vertical. El comparador mantiene igual proporción de aspecto en ambos paneles. Los controles tienen etiquetas y estados permanentes.

Las tres candidatas se generan en paralelo y conservan sus posiciones cronológicas aunque terminen en distinto orden. La máscara muestra una foto centrada y suficientemente grande para trabajar, con pincel fino proporcional a la resolución y un círculo que anticipa su diámetro. El zoom nunca cambia las coordenadas de la máscara guardada. El editor permite restaurar los textos anteriores en un borrador revisable y aclara las referencias usadas por el lote paralelo.

## Canonical components
Button, Notice, Dialog y ImagePanel en `src/components/ui.tsx`; máscara en MaskEditor; editor de instrucciones en PromptEditor; flujo en Workspace. UX-CONTRACT.md es la fuente de transiciones y recuperación visibles. No hay selects ni calendario en esta versión.

## Verification
Typecheck, lint, pruebas de composición y servicio, E2E con navegador y proveedor de prueba claramente identificado. La calidad dental necesita evaluación real independiente.
