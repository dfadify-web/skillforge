# 🔨 Skillforge

**Skills de Claude Code que se escriben y se mejoran solas.**

[English](README.md)

Le explicas a Claude una y otra vez lo mismo: cómo despliegas, qué runner de tests usas, esa trampa del build. Skillforge lo convierte en skills de forma automática y hace que mejoren con cada uso.

```
 capturar ──► detectar patrón ──► crear skill ──► usar ──► aprender ──► refinar ──► fusionar / archivar
     ▲                                                                       │
     └───────────────────────────────────────────────────────────────────────┘
```

## Cómo funciona

Un único hook `Stop` mira cada turno cuando Claude termina. Es rápido y local, sin llamadas a ningún LLM.

| Situación | Qué pasa |
|---|---|
| Haces una **tarea parecida por 2ª vez** (firma de palabras clave y herramientas) | Claude te propone en una línea convertirla en skill |
| La tarea fue **dolorosa** (25+ herramientas, 3+ errores, o le corregiste) | La misma propuesta, al momento |
| Se usó una **skill gestionada** y algo falló o la corregiste | Claude apunta la lección en su journal; si hay evidencia suficiente, **refina** la skill |
| Cualquier otra cosa | Nada. Silencio. |

Barreras de seguridad, porque algo que se modifica a sí mismo las necesita:

- **Como mucho un aviso por sesión.** Si dices que no, no vuelve a proponer tareas parecidas.
- **Solo toca las skills que creó** (`managed-by: skillforge`). Las tuyas no se editan nunca.
- **Cada versión se guarda.** `rollback` deshace cualquier cambio.
- **Lint obligatorio.** La skill tiene que tener una descripción precisa de cuándo usarla, las secciones requeridas, menos de 300 líneas y ningún secreto. Si no lo cumple, no se guarda.
- **Se borran secretos y emails** antes de escribir en el journal.
- **Solo refina con evidencia:** una corrección explícita tuya o 3 lecciones en el journal. Nunca "porque sí".

## Instalar

```bash
npx github:dfadify-web/skillforge
```

Copia la skill a `~/.claude/skills/skillforge` y registra un hook `Stop` en `~/.claude/settings.json`, con copia de seguridad al lado. Necesita Node 18+.

Desinstalar (tus skills generadas se conservan):

```bash
npx github:dfadify-web/skillforge --uninstall
```

## Uso

Tú trabaja. Cuando tenga sentido, Claude acabará con algo como:

> *Es la 2ª vez que montamos un componente React con tests. ¿La convierto en skill? /skillforge*

Comandos manuales:

| Comando | |
|---|---|
| `/skillforge` | Convierte lo que acabamos de hacer en una skill, o mejora la que ya lo cubre |
| `/skillforge review` | Muestra propuestas pendientes, skills listas para refinar, solapes para fusionar y skills sin uso |
| `/skillforge stats` | Usos, aciertos y correcciones de cada skill |
| `/skillforge improve <skill>` | Aplica ya las lecciones del journal |
| `/skillforge rollback <skill> [n]` | Vuelve n versiones atrás |
| `/skillforge mode propose\|auto-draft\|off` | `propose` (por defecto) pregunta antes; `auto-draft` crea borradores sin preguntar |

## Anatomía de una skill generada

```markdown
---
name: react-component-test
description: Crea un componente React con test Vitest y story. Úsala cuando el usuario pida "crea un componente", "componente con test"...
managed-by: skillforge
version: 3
---
## Cuándo usar / Pasos / Gotchas / Verificación / Changelog
```

En `Gotchas` acaban tus correcciones, por ejemplo: *"usaba Jest → este repo usa Vitest"*. Es lo que hace que la siguiente vez salga mejor.

## Archivos

| Ruta | |
|---|---|
| `hooks/stop.js` | El hook: análisis del transcript, ledger y decisiones |
| `lib/` | Parser de transcripts, firmas de tarea, limpieza de secretos, lint e historial de versiones |
| `bin/forge.js` | CLI que usa Claude: `stats`, `review`, `commit`, `journal`, `rollback`, `archive`, `pending`, `mode` |
| `~/.claude/skillforge/` | Estado: `config.json`, `ledger.jsonl`, `journal/`, `history/`, `metrics.json`, `pending.json` |

Los umbrales se ajustan en `~/.claude/skillforge/config.json` (`minTools`, `repeatThreshold`, `similarity`, `refineAfter`, `archiveDays`…).

## Tests

```bash
npm test
```

## Licencia

MIT
