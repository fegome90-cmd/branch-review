# Reviewctl Quick Start (Portable)

Sistema de orquestación de revisiones portable para `reviewctl`.

## Instalación

Desde cualquier repositorio, ejecuta el instalador apuntando al repo fuente de `branch-review`:

```bash
bash /ruta/hacia/branch-review/scripts/install-reviewctl.sh
```

Esto crea:

- `./scripts/reviewctl-wrappers/reviewctl-wrapper.sh` (Bash/Zsh)
- `./scripts/reviewctl-wrappers/reviewctl-wrapper.fish` (Fish)

## Activación

Bash/Zsh:

```bash
source scripts/reviewctl-wrappers/reviewctl-wrapper.sh
```

Fish:

```fish
source scripts/reviewctl-wrappers/reviewctl-wrapper.fish
```

## Configuración

El token no se persiste en archivos. Debe existir en la sesión actual:

```bash
export REVIEW_API_TOKEN="tu-token-seguro"
```

Opcionalmente puedes fijar el core CLI path de forma explícita:

```bash
export REVIEWCTL_CORE_CLI_PATH="/ruta/hacia/branch-review/mini-services/reviewctl/src/index.ts"
```

## Comportamiento operativo

- El wrapper usa estrategia API-first.
- Solo hace fallback local cuando la API es inalcanzable a nivel transporte.
- Si la API responde `4xx` o `5xx`, falla de forma explícita y no hace fallback silencioso.
- Si falta `REVIEW_API_TOKEN`, el wrapper usa modo local directo.
- El scope del review sigue siendo diff-based; `reviewctl` revisa branch diff, no listas ad-hoc de archivos.

## Comandos principales

- `reviewctl_init`
- `reviewctl_plan`
- `reviewctl_run`
- `reviewctl_verdict`
- `reviewctl_status`
- `reviewctl_full_workflow`

## Observabilidad mínima

Los wrappers registran contexto de ejecución con campos como:

- `mode=api|local-fallback|local-direct`
- `command=<cmd>`
- `http_status=<code>` cuando aplica
- `core_cli_path=<path resuelto>`

## Gates de portabilidad

- Sin rutas absolutas hardcodeadas en el wrapper generado.
- Sin tokens en archivos.
- Fish shell sin `eval`.
- Argumentos serializados con semántica estable hacia la API.
- Fallback local limitado a errores de transporte.
