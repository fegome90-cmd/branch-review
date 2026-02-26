# Plan de fixes (frontend design audit) — v2

## Objetivo
Corregir inconsistencias de spacing, radio y elevación sin introducir regresiones visuales ni de accesibilidad.

## Alcance
- **Incluido:** `src/app/globals.css`, primitives en `src/components/ui/*` y pantallas que los consumen.
- **Excluido (por ahora):** rediseño visual completo, cambios de UX flow, refactors estructurales no relacionados.

## Fase 0 — Baseline y quality gates
1. Crear rama: `fix/frontend-design-consistency`.
2. Captura baseline visual obligatoria (antes de tocar estilos):
   - Rutas: `/`, pantallas de review principales, estados con modal/popover/tooltip.
   - Viewports: `1280x800`, `390x844`.
   - Estados: default, hover, focus-visible, disabled, open/closed.
3. Gates iniciales:
   - `bun run lint`
   - `bun run typecheck`

### DoD Fase 0
- Baseline documentado y reutilizable para comparación.
- Lint/typecheck en verde.

---

## Fase 1 — Tokens globales (PR1)
### Cambios
- `src/app/globals.css`
  - `--radius: 0.625rem` -> `0.5rem` (8px).
  - Mantener escala de radios coherente derivada del base.

### Riesgo
- Medio: impacto transversal en todos los `rounded-*`.

### Rollback
- Revert de PR1 completo (1 commit atómico).

### DoD Fase 1
- No aparecen bordes rotos/cortes en light/dark.
- Dialog, card, input, select y sidebar visualmente consistentes.

---

## Fase 2 — Spacing fraccional fuera de grid 4px (PR2)
### Cambios
Enfoque por familias, sin replace global ciego:
1. `badge.tsx`: `py-0.5` -> `py-1`.
2. Menús/selección (`context-menu`, `dropdown-menu`, `select`, `menubar`, `command`):
   - `py-1.5` -> `py-1` o `py-2` según densidad acordada.
   - `gap-1.5` -> `gap-1` o `gap-2`.
3. `chart.tsx`, `tabs.tsx`, `pagination.tsx`:
   - `px-2.5`, `gap-1.5`, `p-[3px]` -> tokens de 4px.

### Guardrail (CI/local)
Agregar chequeo para evitar reintroducciones de spacing fraccional en utilidades de layout:
- detectar `p|m|gap` con `.5`
- detectar `p-[3px]` y similares fuera de allowlist.

### Riesgo
- Medio/alto por volumen de componentes shared.

### Rollback
- Revert de PR2 completo.

### DoD Fase 2
- No quedan `py-0.5`, `py-1.5`, `gap-1.5`, `px-2.5`, `p-[3px]` en archivos objetivo.
- Altura clickable y alineación icono-texto correcta en menús.

---

## Fase 3 — Sombras y elevación (PR3)
### Cambios
- Reducir `shadow-lg/xl` en overlays (`dialog`, `alert-dialog`, `sheet`, `popover`, `hover-card`, `dropdown`, `context-menu`, `toast`, tooltip de chart).
- Priorizar `border + bg` y una sombra uniforme más sutil (`shadow-sm`/`shadow-md`).

### Riesgo
- Medio: pérdida de separación de capas si se reduce de más.

### Rollback
- Revert de PR3 completo o parcial por componente.

### DoD Fase 3
- Overlays mantienen jerarquía visual clara en light/dark.
- No hay sombras dramáticas inconsistentes entre componentes equivalentes.

---

## Fase 4 — Densidad y padding por familia (PR4)
### Matriz de densidad
- **Default:** controles de formulario primarios.
- **Compact:** context menus, items secundarios, barras densas.

### Tabla inicial (target)

| Componente | Densidad | Altura | Padding X | Padding Y | Clases Tailwind |
|---|---|---|---|---|---|
| input / select / textarea | compact | 32px | px-2 | py-1 | `h-8 px-2 py-1` |
| input / select / textarea | default | 40px | px-3 | py-2 | `h-10 px-3 py-2` |
| input / select / textarea | relaxed | 48px | px-4 | py-3 | `h-12 px-4 py-3` |
| button | sm | 32px | px-2 | — | `h-8 px-2` |
| button | default | 36px | px-4 | py-2 | `h-9 px-4 py-2` |
| button | lg | 40px | px-6 | — | `h-10 px-6` |
| navigation-menu | default | 48px | px-4 | py-2 | `h-12 gap-x-4 py-2` |

### DoD Fase 4
- Tabla de densidad aplicada y consistente en primitives.
- No hay mezcla arbitraria entre default/compact.

---

## Fase 5 — QA final y cierre
1. `bun run lint`
2. `bun run typecheck`
3. `bun run build`
4. Smoke visual comparando baseline vs final.
5. Checklist a11y mínimo:
   - focus visible en componentes tocados
   - navegación teclado en menús/dialog
   - contraste no degradado
   - targets interactivos razonables en mobile

### DoD Fase 5
- Build/lint/typecheck en verde.
- Sin regresiones visuales críticas detectadas.

---

## Dependencias y orden de merge

> **Nota:** El plan original contemplaba cuatro PRs secuenciales (PR1–PR4). Estos han sido consolidados en un único PR. Las fases originales sirven como **checkpoints de validación interna** dentro del PR; el DoD de cada checkpoint debe verificarse antes de dar por cerrado el siguiente.

| Fase original | Checkpoint en este PR | Estado | Contenido |
|---|---|---|---|
| PR1 (tokens) | Checkpoint 1 | ✅ | `globals.css` — radius token → 0.5rem, escala derivada |
| PR2 (spacing) | Checkpoint 2 | ✅ | Fractional spacing eliminado; guardrail `lint:spacing-grid` activo |
| PR3 (elevación) | Checkpoint 3 | ✅ | Shadow scale reducida en todos los overlays |
| PR4 (densidad) | Checkpoint 4 | 🔄 | Input/button/select density según tabla target |

La regla original ("no abrir PR siguiente sin validar DoD del anterior") se aplica aquí como: **no cerrar este PR hasta que todos los checkpoints tengan su DoD validado**.

## Matriz de alcance (resumen)
- **Tokens:** `src/app/globals.css`
- **Spacing:** `badge`, `chart`, `tabs`, `pagination`, `context-menu`, `dropdown-menu`, `select`, `menubar`, `command`
- **Elevación:** overlays y popups
- **Densidad:** input/select/textarea/button/navigation-menu
