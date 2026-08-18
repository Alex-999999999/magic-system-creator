# Magic System Sandbox V22.8h — Stable Dragging + Persistent Toolbar

## Editor dragging fix

V22.8g switched panels to `position: fixed` while they were inside a transformed
editor container. That could make them disappear or jump to unexpected coordinate
systems.

V22.8h never changes positioning mode.

Dragging now uses transform offsets:
- editor shell stays centered in the viewport
- drag offset is added after the center transform
- side panels remain in normal flow and use their own transform offsets
- no fixed-position reparenting or coordinate-space conflicts

## Centered spawn

Every time an editor opens:
- drag offsets are reset to 0
- the editor shell starts at exact 50% / 50% viewport center

## Toolbar

The main toolbar now has a very high z-index and remains:
- visible while editors are open
- fully clickable while editors are open

The editor backdrop no longer captures toolbar input.

## Simulation exception

When Simulate is open, the main toolbar is explicitly hidden.

All V22.8g functionality and earlier systems remain intact.
