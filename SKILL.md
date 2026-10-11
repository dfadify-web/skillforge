---
name: skillforge
description: Convierte el trabajo que acabas de hacer en una skill reutilizable y la mejora con cada uso (journal de lecciones, refinado con evidencia, versiones y rollback, fusión y archivado). Úsala cuando el usuario diga /skillforge, "conviértelo en skill", "haz una skill de esto", "guarda cómo lo hemos hecho", "mejora la skill", "qué skills tengo", o cuando un mensaje [Skillforge] de un hook te lo pida.
---

# Skillforge

Ciclo: **capturar → detectar patrón → crear → usar → aprender → refinar → fusionar/archivar**.
Un hook `Stop` mira cada turno. Cuando una tarea se repite o cuesta mucho, te pide proponer una skill. Cuando una skill gestionada falla o el usuario la corrige, te pide anotar la lección. Tú haces el trabajo de criterio; el CLI hace la contabilidad.

CLI (funciona en bash y PowerShell): `node "$HOME/.claude/skills/skillforge/bin/forge.js" <comando>`. Abajo, `forge` es esa línea.

| Comando del usuario | Qué haces |
|---|---|
| `/skillforge` o "haz una skill de esto" | §Crear con la tarea de esta conversación |
| `/skillforge improve <skill>` | §Refinar |
| `/skillforge review` | `forge review` y propón acciones concretas (crear, refinar, fusionar, archivar) |
| `/skillforge stats` | `forge stats` y resume en 2-3 líneas |
| `/skillforge rollback <skill> [n]` | `forge rollback <skill> [n]` |
| `/skillforge mode propose\|auto-draft\|off` | `forge mode <modo>` |

**Regla de oro:** solo creas o editas skills con `managed-by: skillforge`. Las skills del usuario (sin esa línea) no se tocan nunca. Si una de ellas debería mejorar, propón el cambio en el chat.

## §Crear
1. **¿Merece la pena?** Merece si la tarea es repetible y tiene pasos no obvios, trampas o preferencias del usuario. Si fue algo trivial o único, dilo y no la crees (si venía de un hook, ejecuta `forge pending dismiss <id>`).
2. **¿Ya existe algo parecido?** Ejecuta `forge list` y mira las skills de `~/.claude/skills/`. Si una gestionada ya cubre la tarea, haz §Refinar sobre ella en vez de duplicarla.
3. **Extrae de la conversación**, no de tu imaginación:
   - los pasos que funcionaron, en orden, con comandos y rutas exactas (parametriza lo que cambie entre usos);
   - cada error o corrección del usuario, convertido en una regla dentro de `## Gotchas`;
   - cómo se verificó que salía bien.
4. **Nombre** en kebab-case y orientado a la tarea (`deploy-landing-vercel`, no `helper`). La `description` es lo que hace que la skill se active: qué hace, más "Úsala cuando…" con frases reales del usuario.
5. **Escribe** `~/.claude/skills/<nombre>/SKILL.md` a partir de `~/.claude/skills/skillforge/templates/generated-SKILL.md`. Debe tener menos de 300 líneas y ser imperativa y concreta. Si un paso es determinista y largo, sácalo a un script dentro de la carpeta de la skill y referéncialo. No incluyas secretos ni datos personales.
6. **Registra:** `forge commit <nombre> "creada: <resumen>" --pending <id>` (el `--pending` solo si venía de un hook). Si el lint falla, corrige y repite.
7. Cuéntaselo al usuario en 1-2 líneas: el nombre, cuándo se activará y cómo invocarla (`/<nombre>`).

## §Aprender (tras un uso con fallos)
Anota una lección accionable, no una crónica: `forge journal <skill> "<qué falló> → <regla correcta>"`.
Ejemplo: `"build falló por Node 18 → comprobar node -v ≥ 20 antes de npm run build"`.

## §Refinar
Hazlo cuando el hook lo pida, cuando `forge review` la marque o cuando el usuario lo pida.
1. Lee la skill y su journal en `~/.claude/skillforge/journal/<skill>.md`; solo cuentan las lecciones posteriores a la última versión.
2. Aplica **solo lo que tiene evidencia**:
   - una corrección explícita del usuario pasa a ser una regla en Gotchas o cambia un paso;
   - si un paso falla de forma repetida, reescríbelo;
   - si un atajo funcionó, añádelo.
   No reescribas lo que funciona; compacta y quita lo que quede obsoleto.
3. Sube `version` en 1 y añade una línea al Changelog: `- vN (fecha): <cambio> (motivo)`.
4. Ejecuta `forge commit <skill> "<cambio>"`. Esto guarda un snapshot, de modo que `forge rollback` siempre puede deshacerlo.
5. Dile al usuario qué cambió en una línea.

## §Higiene (en /skillforge review)
- **Fusionar:** si `review` lista dos skills solapadas, propone fusionarlas en una sola. La otra se archiva con `forge archive <skill>`, pero solo tras el "sí" del usuario.
- **Archivar:** si hay skills sin uso, ejecuta primero `forge archive --stale` (lo muestra sin hacer nada) y añade `--yes` solo con confirmación.
- **Revisar las que fallan mucho:** si una skill acumula muchas correcciones, revísala a fondo o propón borrarla.

## Comportamiento con mensajes `[Skillforge]` del hook
- Llegan al terminar un turno; como mucho uno por sesión.
- Haz lo que pidan sin repetir tu respuesta anterior y añade **una sola línea** visible.
- En modo `propose` nunca crees la skill sin un "sí" del usuario. En `auto-draft` créala directamente y avisa.
