# Magic System Sandbox V22.8a — Modern Save Metadata

V22.8 adaptive scaling remains intact.

## Save/export version

New save metadata now identifies the project as:

- `format: "MagicSystemSandbox"`
- `version: "22.8"`
- `schemaVersion: 22800`

Exported project files are now named:

`magic-system-v22.8.magicgraph`

instead of `magic-system-v15.magicgraph`.

## Richer exported saves

V22.8 exports can also include:
- technology settings
- Civilization Symbols
- world-state cache
- Simulation state
- scale-navigation state

## Backward compatibility

Older V15/V16/etc. `.magicgraph` files still load. Missing modern fields are
treated as optional and use the existing legacy-safe reset behavior.
