# reviewctl TUI — Embedded in Agent Window

## El problema a resolver

Cuando el agente ejecuta `reviewctl run` (u otra fase), el output actual es texto plano desfilando por el terminal. El objetivo: **ese mismo terminal muestra el TUI**, sin abrir ventanas nuevas, sin cambiar de proceso.

```
[agente corre reviewctl run]
          │
          ▼
  ┌─────────────────────────────┐
  │  mismo terminal del agente  │
  │  ← TUI se renderiza aquí   │
  └─────────────────────────────┘
```

---

## Cómo funciona a nivel de TTY

Cuando el agente (shell, Claude Code, etc.) ejecuta:

```bash
reviewctl run
```

El proceso hijo **hereda el TTY del padre**. Eso significa que el proceso de `reviewctl` puede escribir directamente al terminal del agente usando secuencias ANSI. No necesita nada especial: el TTY compartido ya es el canal.

```
agente (proceso padre)
  └── reviewctl run (proceso hijo)
        └── hereda fd 0/1/2 del padre
              └── escribe ANSI al mismo terminal
```

---

## Dos modos de renderizado (elegir uno por fase)

### Modo A — Alternate Screen (recomendado para fases largas)

```
ANTES                        DURANTE reviewctl run          DESPUÉS
─────────────────            ─────────────────────          ──────────────────
$ reviewctl run    →→→      ╔═══════════════════╗  →→→     $ reviewctl run
[output anterior]           ║  CURRENT RUN       ║          ✓ run completed
                            ║  Status: RUNNING   ║          [output anterior visible]
                            ║  ████░░░░░ 60%     ║
                            ╚═══════════════════╝
```

- Usa `tput smcup` al entrar, `tput rmcup` al salir.
- El terminal del agente **vuelve exactamente como estaba** al terminar.
- Así trabajan: `vim`, `htop`, `less`, `git log --all`.
- El agente solo ve el proceso ejecutándose; el TUI es transparente.

```typescript
// Pseudocódigo de ciclo de vida
process.stdout.write('\x1b[?1049h'); // entrar alternate screen
renderTUI();
await phaseComplete();
process.stdout.write('\x1b[?1049l'); // salir alternate screen
printSummaryLine(); // esto sí queda en el scroll del agente
```

### Modo B — Inline panel fijo (para fases cortas / status bar)

```
$ reviewctl run
Exploring context...   [DONE]  ████████░░
Running agents...      [●●●●]  en curso...
────────────────────────────────────────
ETA: ~2min   branch: review/main-72cb7b2
```

- Usa ANSI cursor-up (`\x1b[{n}A`) para sobreescribir el panel.
- El log de texto queda arriba; el panel de estado sobreescribe siempre las últimas N líneas.
- Más frágil con resize de ventana, pero el output anterior permanece visible.

---

## Arquitectura: el CLI como host del TUI

Cada comando ya existente de `reviewctl` actúa como host:

```
reviewctl run
  │
  ├── detectTTY()
  │     ├── isTTY === true  → iniciar TUI renderer (alternate screen)
  │     └── isTTY === false → fallback a plain text (para pipes/CI)
  │
  ├── spawnPhaseWorker()    ← hace el trabajo real en background
  │
  ├── startTUILoop()        ← render loop mientras worker corre
  │     ├── leer artefactos en disco cada 500ms
  │     ├── actualizar badges (RUNNING → DONE/FAIL)
  │     └── capturar teclas (q=abort, Enter=ver log)
  │
  └── onWorkerExit()
        ├── salir alternate screen
        └── imprimir resumen de 1 línea al scroll principal
```

---

## Lo que ve el agente en su scroll (invariante)

El agente **siempre ve** al menos esto al terminar cada comando:

```
[reviewctl] run   ✓ completed   (42s)   run_20260226_585d9b36
```

Si falló:

```
[reviewctl] run   ✗ failed      (8s)    → ver: _ctx/.../error.json
```

El TUI es un detalle de presentación; el estado real siempre queda en disco y en una línea de resumen.

---

## Implementación por fases (criterio exacto + responsable)

### Fase 1 — Motor de render y fallback

- **Scope**: detección TTY, fallback plain text, renderer alternate-screen base.
- **Owner**: `mini-services/reviewctl/src/lib/tui/*`.
- **Salida**: `runWithTUI()` y `runWithPlainOutput()` con interfaz común.

### Fase 2 — Orquestación de comandos

- **Scope**: integrar renderer en `run` (y opcionalmente `plan`/`verdict`) sin cambiar lógica de negocio.
- **Owner**: `mini-services/reviewctl/src/commands/run.ts`.
- **Salida**: ciclo `start → render loop → stop → summary line`.

### Fase 3 — Señales y cleanup robusto

- **Scope**: cleanup idempotente para `SIGINT`, `SIGTERM`, `exit`.
- **Owner**: `mini-services/reviewctl/src/lib/tui/lifecycle.ts`.
- **Salida**: terminal siempre restaurado, incluso en abort.

### Fase 4 — UX y estabilidad

- **Scope**: resize, shortcut keys, estado final visible + resumen persistente.
- **Owner**: `mini-services/reviewctl/src/lib/tui/components/*`.
- **Salida**: TUI estable en sesiones interactivas largas.

---

## Detección de TTY: el contrato

```typescript
const isTTY = process.stdout.isTTY && process.stderr.isTTY;

if (!isTTY) {
  // modo CI / pipe: solo texto plano, sin ANSI
  runWithPlainOutput();
} else {
  // modo terminal interactivo: TUI completo
  runWithTUI();
}
```

Esto garantiza que el agente pueda correr `reviewctl run 2>&1 | tee log.txt` sin romper nada.

---

## Checklist de observabilidad y silent-failure

- Cada transición de fase emite evento estructurado: `phase`, `status`, `timestamp`, `run_id`.
- Cada error terminal registra: `code`, `message`, `phase`, `artifact_path`.
- El renderer nunca consume errores silenciosamente: todo fallo termina en summary line + artefacto (`error.json`).
- El worker no escribe logs crudos al mismo canal del renderer; usa buffer/event bus.
- Siempre se imprime una línea final parseable por agente, incluso en abort.

## Mapeo explícito de estados lógicos

| Estado lógico     | TUI badge      | Summary line                                     | Exit code      |
| ----------------- | -------------- | ------------------------------------------------ | -------------- |
| `RUNNING`         | spinner/active | no final line aún                                | n/a            |
| `COMPLETED`       | success        | `[reviewctl] <cmd> ✓ completed (...)`            | `0`            |
| `FAILED`          | error          | `[reviewctl] <cmd> ✗ failed (...) -> error.json` | `1`            |
| `ABORTED`         | warning        | `[reviewctl] <cmd> ! aborted (...)`              | `130`          |
| `NO_TTY_FALLBACK` | info           | `[reviewctl] <cmd> plain mode (...)`             | resultado real |

---

## Señales y limpieza

El TUI **debe** manejar señales para no corromper el terminal del agente:

```typescript
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  process.stdout.write('\x1b[?1049l'); // salir alternate screen
  process.stdout.write('\x1b[?25h'); // restaurar cursor
};

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});
process.on('exit', cleanup);
```

Sin esto: si el agente mata el proceso, el terminal del agente queda en alternate screen (el bug más común de TUIs mal implementados).

---

## Flujo completo desde el agente

```
agente ejecuta:  reviewctl run

  1. reviewctl detecta TTY → modo TUI
  2. guarda estado inicial en meta.json
  3. entra alternate screen → TUI visible en terminal del agente
  4. lanza worker de fase en segundo plano
  5. render loop actualiza badges mientras worker corre
  6. worker termina → final.json escrito
  7. TUI muestra "✓ completed" por 1s
  8. sale alternate screen → terminal del agente restaurado
  9. imprime: "[reviewctl] run ✓ completed (42s)"
 10. proceso termina con exit code 0 o 1

agente continúa con siguiente paso
```

---

## Stack concreto (Node/TS)

```
ink          → React para CLI (maneja alternate screen y re-renders)
ink-spinner  → spinner para RUNNING
chalk        → colores de badges
```

Ink ya maneja el alternate screen internamente. El entry point es minimal:

```typescript
// src/tui/index.tsx
import { render } from 'ink'
import { ReviewTUI } from './components/ReviewTUI'

export async function startTUI(runId: string) {
  const { waitUntilExit } = render(
    <ReviewTUI runId={runId} />,
    {
      altScreen: true,    // ← esto es todo lo necesario para alternate screen
      exitOnCtrlC: false  // ← manejamos Ctrl+C nosotros para cleanup
    }
  )
  await waitUntilExit()
}
```

---

## Matriz mínima de pruebas

- Unit: detección TTY, mapeo de estados, formatter de summary line.
- Integration: `run` en modo TTY simulado (alt-screen on/off + cleanup).
- Integration: `run` en `!isTTY` (plain output sin ANSI especial).
- Signals: `SIGINT` y `SIGTERM` restauran terminal y retornan exit code esperado.
- Regressión: `reviewctl run 2>&1 | tee log.txt` produce salida parseable.

---

## DoD ajustado

- [ ] `reviewctl run` muestra TUI en el mismo terminal donde fue invocado.
- [ ] Al terminar la fase, el terminal del agente queda **exactamente** como antes de invocar el comando.
- [ ] Una línea de resumen queda en el scroll permanente del agente.
- [ ] Si no hay TTY (pipe/CI), fallback a plain text sin ANSI.
- [ ] Ctrl+C limpia el terminal antes de salir (nunca corrompe el state del TTY).
- [ ] Resize de ventana no corrompe el layout.
- [ ] El agente puede parsear el exit code (0=ok, 1=fail) independientemente del TUI.
