# Magic System Sandbox V22.7h — Dedicated Civilization Util Save Path

Civilization Utils no longer rely on the generic node-editor save routine.

## Dedicated saving

`saveCivilizationUtilEditor()` now handles Civilization Utils directly.

It supports:
- Language
- Currency
- Disease
- Calendar
- Measurement System
- Legal Code
- Rank System
- Communication System
- Naming System

It handles both:
- creating a new Civilization Util
- editing an existing Civilization Util

## Save ordering

The node is now:
1. created/updated
2. subtype data is copied from the form
3. Life access links are synchronized
4. unrelated Organization/Material/Currency links are preserved
5. graph data is rebuilt
6. local save/storage is written
7. only then is the editor closed

This prevents editor cleanup from clearing editing state before the utility is
persisted.

## Defensive routing

The Save button capture handler directly calls the dedicated Civilization Util
save routine.

The generic `saveEditor()` also delegates to the same routine if it is ever
called while a Civilization Util is active.

V22.7g draggable symbols, palette sizing, Language timeline events and earlier
features remain intact.
