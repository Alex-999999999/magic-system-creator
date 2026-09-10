# Creator Sandbox v28.7an

## v28.7an — Merge Variants
- Added **Merge Variants** to the shared 3D modeller used by Places, Structures, and Landscapes.
- Merge the active variant with any other variant into a brand-new third variant.
- All objects from both source variants are copied at their exact transforms and keep textures/settings.
- Every copied object gets a new internal mesh ID, so editing the merged variant never mutates either source.
- The two source variants are preserved unchanged, and the merged result becomes the active variant immediately.
- An optional name field lets you name the merged result before creating it.


Landscape footprint + weather authoring:
- Landscape 3D modelling now displays the exact **360 × 360 world-unit Surface loader baseplate**. X/Z coordinates and object sizes are now used 1:1 when the visited Surface is rendered, so placement in the modeller matches placement in-world.
- A 20-unit editor guide grid and cyan loader boundary make the real Surface footprint visible without becoming part of the saved environment.
- Landscape modelling opens zoomed out to the full loader footprint.
- Added a draggable **Weather Editor** beside Landscape modelling. Each sampled terrain color can override its sky color and define a default Rain, Storm + Lightning, or Sandstorm event with adjustable intensity and haze/sky color.
- The weather event can be previewed while modelling. Manual Surface weather still overrides the authored default.
- **Save & Return** now returns to the Landscape color picker and closes the Weather side panel.

Landscape 3D editor opening reliability fix:
- The sampled Planet object is now passed directly into the 3D modeller instead of being rediscovered after the click.
- The Landscape sampler only hides after the modeller is confirmed visible.
- The modeller window is made visible before secondary UI synchronization, preventing silent no-op failures.
- Palette swatches, globe samples, and saved Landscape Edit buttons all use the exact pinned Planet being authored.
- Viewport rendering errors are surfaced in the modeller status instead of preventing the window from opening.

## v28.7af — Place Controls + palette-first landscape flow
- Removed the legacy **Randomly scatter structures around the Place** and **Cycle variants randomly of this model** controls from the detached Place Controls menu. Their legacy runtime flags are forced off so older saves cannot keep activating that path.
- Fixed Country Border Painter, Planet Tile Editor, Landscape Editor, and Planet Color Palette launchers by using delegated click handling; moving buttons between draggable panels no longer breaks them.
- Landscape authoring is now palette-first: opening Landscape Editor requires an explicitly saved Planet Color Palette.
- Planet Color Palette now has a small **Save Palette** button. Saving it immediately persists the palette and, when Landscape Editor requested it, continues straight into the Landscape Editor.
- In Landscape Editor, clicking a terrain color on the real globe immediately opens the shared 3D modeller for that color.
- The older "Create or open a Planet first" dead-end was replaced by the palette prerequisite when a Planet is already being edited.

## Border Painter fixes
- Country borders can now be drawn continuously on the actual planet globe.
- Erase mode removes painted segments; Clear All removes every segment.
- Right-drag rotates the globe without switching tools.
- Border edits on an existing Country are persisted at the end of each stroke.
- Borders and country names remain visible only in Political mode on the main globe.

## Sampled-color Landscape Editor
- Choose an authored planet, then sample a color directly from its real globe.
- Each sampled color can own a full 3D model made with the same modeller used for Structures.
- A color landscape applies anywhere that same terrain color occurs on that planet.
- Repetition layouts: Grid, Line, Radial, and Area Scatter.
- Repetitions support per-instance size variation.
- Procedural behavior can be Same Pattern Everywhere or Unique Per Occurrence.
- Custom color landscapes are streamed only for the surface currently being visited.
- Each color rule can replace the normal procedural hills/trees while preserving the planet ground color.

Existing project systems, Political mode, country containment, Structure tile rules, texture tiling, and weather remain intact.


## v28.7aa — Planet Color Palette restored
- Restored an explicit **Planet Color Palette** button inside Planet Place Controls.
- The palette remains the source of land, ocean, gas giant, cloud, coverage, Moon, and planet colors.
- The panel is draggable and can always be reopened after closing it.
- The sampled-color Landscape Editor continues to use the real planet palette, so both systems coexist.


## v28.7ac — Planet Place Controls correction
- Reverted the accidental stripping of the main Place editor.
- The draggable side menu no longer steals Planet icon controls from the real Place editor.
- At Planet scale, the side menu keeps only Planet Color Palette + planet-wide Structure generation.
- Removed the legacy Planet-scale controls shown in the bug screenshot: random scatter, random variants, density, spreadness, and Structure Y alteration.
- Planet-wide generation still exposes the Generate Everywhere toggle, Structure/Countryside Tiles, Landscape Editor, and permitted Structure list.
- The main Place editor remains available instead of being replaced by a minimal shell.
## v28.7af
- Added a fourth terrestrial palette color, **Accent 2**, for the extra green surface accents/scenery that were previously effectively hard-coded.
- Accent 2 is saved on each Planet, propagated into generated planet state, used on the globe as a rarer terrain accent, and used by default surface hills/foliage.
- Landscape globe sampling now samples the actual surface cell under the pointer (including ocean and authored landscape-color overrides) before opening the 3D modeller.
- Landscape globe rotation now matches the main planet globe's drag direction.
- Planet preview snapshots are cached and spherical vertex trigonometry is reused; rotation redraws are requestAnimationFrame-throttled to reduce lag.


## v28.7ag
- Added Land Accent 3 and Accent 4 to remove remaining hard-coded rock/highland and polar colors.
- Landscape Editor now exposes every saved palette color as a direct clickable swatch.
- Deep Ocean is always available as a Landscape color even when it only appears through globe shading.
- Globe sampling and swatch sampling now use a guarded 3D-modeller launcher that reports errors and forces the modeller above authoring panels.


## v28.7ah
- Removed Planet Palette Accent 2 / Accent 3 / Accent 4 controls.
- Saving a custom palette now disables legacy hidden biome accents entirely; authored terrestrial terrain uses only Primary, Secondary, and Accent.
- Deep Ocean is now a real generated ocean terrain class across deep-water cells, so its chosen color visibly appears on the globe and is sampleable by Landscape authoring.
- Old Accent 2/3/4 values are cleared on palette save so older projects cannot leak those colors back into the rendered planet.

## v28.7ak — empty authored landscapes + sky color
- Landscape 3D authoring now starts completely empty: only a circular ground patch in the sampled planet color is shown. The patch uses the same modelling footprint as the normal generated environment.
- The Environment selector and canned grass/desert/gas scenery are hidden/disabled while authoring a Landscape, because the authored model *is* the environment.
- New landscapes default to Single placement (no repetition). A Landscape Placement selector can switch to Procedural repetition.
- Area repetition now uses a stratified two-dimensional scatter so it fills width and depth instead of ever resembling a line. Grid, Line, Radial, variants, and size variation remain available.
- Authored color landscapes always replace the normal procedural hills/trees for that sampled terrain color.
- Planet Color Palette now includes Surface Sky color. It is used when entering the planet and as the Landscape modeller background.

## v28.7aq
- Added a true **Wedge** primitive to the shared 3D modeller. It renders as a triangular prism in both editor previews and the Surface loader.
- Fixed direct part dragging: left-click + drag on an object now moves it across X/Z immediately instead of entering a non-moving Select state.
- Corrected high-DPI/CSS-to-canvas scaling in the 3D drag basis so dragged objects track the cursor accurately.
- Existing gizmo scale/lift/rotate handles and G/S/R controls are unchanged.


## v28.7aq
- Fixed in-viewport 3D part dragging. The selected-part center Move handle now initializes the same movement state as direct object dragging.
- Part movement now uses ray/ground-plane intersection for accurate X/Z dragging, with the previous screen-basis solver retained as a near-horizontal-camera fallback.
- Wedge primitive from v28.7ao is preserved.


## v28.7aq — Restore parent Planet assignment
- Restored **Located on planet** inside Place Controls for every non-Planet Place.
- Countries still hide the selector only when Planet-scale mode makes their parent globe implicit.
- Existing `surfacePlanetId` assignments and save behavior are preserved.


## v28.7ar — Grid / Scatter Place population
- Added an explicit **Placement** choice to Place Structure Population: **Grid** or **Scatter**.
- Scatter uses deterministic 2D area distribution with anti-clumping, while still honoring Density and Spreadness.
- Grid preserves the previous rows/columns behavior for authored places that need orderly layouts.
- Legacy Places with no saved placement mode default to Scatter, fixing old surface scenes that looked unintentionally tiled into a grid.


## v28.7au — Structure variant population restored
- Restored Place-level Structure variant population as a proper three-mode control: **Current variant only**, **Cycle through variants**, and **Random variant per placement**.
- Cycle advances through drawable authored variants in order for each generated Structure placement.
- Random uses deterministic seeded choices, so Scatter/Grid layouts do not reshuffle every redraw.
- Older saves with the former `placeRandomStructureVariants` flag migrate naturally to Random mode.
- The setting works with both Grid and Scatter and is hidden for root Planet-wide tile generation, where the tile system remains authoritative.


## v28.7au
- Magical Objects now have a full 2D pixel drawer using the Material Painter's 8x8–256x256 toolset.
- Materials can define an acronym / short name.
- Materials can define an upgrade parent and exact required quantity (e.g. 2,596 Diamond -> Hyperdiamond).
- New visual Material Upgrade Tree follows those recipes automatically.
- Large quantities use compact acronyms (K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc) while exact values remain available in tooltips.
- Crafting graph quantity labels also use the compact quantity formatter.


## v28.7ax — Material Upgrade Compare
- Moved upgrade authoring out of individual Material editors into a separate Material Tools toolbar.
- Choose any two materials to see which one is higher in the authored upgrade chain.
- Direct upgrade steps can be defined or fixed from the comparison tool, including exact quantities with compact acronyms.


## v28.7ax — Global Upgrade Tool
- Replaced the separate Material Tools bar with one tiny circular Upgrade button at the top-center of the screen.
- Upgrade comparison now includes Materials and Magical Objects, including Components and legacy Tools.
- Upgrade relationships can cross categories (for example Material -> Magical Object) and still keep exact required quantities plus compact quantity acronyms.
- Existing Material upgrade fields remain supported and are mirrored into the generalized upgrade relationship when edited.


## v28.7ba — Simplified Upgrade linking

The global Upgrade menu now focuses on one action: pick two Materials/Magical Objects, choose which one is the successor, and press **Link Upgrade**. The app creates the directed upgrade relationship automatically. The old comparison/step-analysis and directional A→B/B→A authoring controls were removed from this menu, while existing upgrade data remains compatible.


## v28.7ba — Upgrade relationship types
The global Upgrade tool can now label successor links as Upgrade, Refinement, Enchantment, Infusion, Transmutation, Empowerment, Evolution, or Modification. The selected relationship is stored on the successor and used as the graph edge label.


## v28.7bb — Multi-input progression links
- Upgrade now supports multiple predecessors and multiple successors in one operation.
- Every selected predecessor links to every selected successor, allowing converging progression recipes.
- Added editable predecessor-side and successor-side connection messages.
- Progression edges render both messages near their respective ends while preserving the relationship type.


## v28.7bc — Normal 1-to-1 progression messages
- One predecessor to one successor now uses one normal centered connection message.
- Multi-predecessor or multi-successor relationships keep the two editable endpoint messages.
- Relationship type metadata is preserved in both cases.


## v28.7bf — Crafting insertion + readable recipe repair

Crafting insertion is now refreshed whenever Insert is selected, stale candidate state is cleared, hub-to-node role changes no longer leave Crafting permanently disabled, and the duplicate process-placement click path was removed. Readable recipe conversion now recognizes process/helper/product routing, avoids emitting internal graph bookkeeping as recipe steps, keeps process-state tags on materials, and formats final-product links more cleanly. Save/export/readable metadata and filenames now report v28.7bf (schema 28944).


## v28.7bf
- Hardened Crafting Editor insertion so selections survive candidate refreshes and inserts no longer silently fail.
- Insert actions now give visible success/error feedback and recover a missing draft when possible.
- Updated save/export version metadata to v28.7bf / schema 28944.


## v28.7bg — Reliable Crafting Insert

Fixed the intermittent Crafting Editor Insert failure. Permanent Insert now keeps the chosen item selected after insertion instead of silently clearing it, so repeated inserts remain valid. New permanent and temporary nodes use collision-aware deterministic placement so they cannot be created directly underneath an existing workspace node, and the newly inserted node is selected immediately. Save/export metadata now reports v28.7bg (schema 28945).


## v28.7bh — Crafting first-insert workspace fix
- Reworked permanent ingredient insertion around one canonical workspace commit path.
- The editor now verifies that every successful draft insertion also renders as an interactive workspace node.
- Added an immediate render plus next-frame recovery render to eliminate the first-insert display race.
- Temporary inserts use the same workspace-render recovery.
- Save/export metadata updated to v28.7bh / schema 28946.


## v28.7bi — Crafting workspace renderer rewrite
- Replaced the fragile Crafting Graph node `innerHTML` redraw path with explicit DOM node construction.
- Insert now mutates one authoritative graph draft and immediately rebuilds usable workspace nodes.
- Removed the requestAnimationFrame verification/rerender loop that could race with later redraws.
- Hardened malformed/legacy node coordinates and graph arrays instead of allowing one bad node to abort the entire workspace render.
- Dragging now updates node position + links without recursively rebuilding the whole workspace on every pointer move.
- Save/export metadata updated to v28.7bi / schema 28947.


## v28.7bj
- Fixed Crafting Graph quantities such as `450 000` not inserting. The quantity field now accepts human-formatted grouped numbers (spaces, commas, NBSP/thin spaces, underscores) instead of relying on a native number input that silently rejects them.
- Invalid quantities now show a visible error instead of silently falling back.
- Save/export version updated to v28.7bj / schema 28948.


## v28.7bk — High crafting quantity isolation

Crafting quantities now use a dedicated bounded formatter instead of the shared material abbreviation path. Large quantities are stored as one ingredient quantity only; they never create repeated DOM nodes. Rendering and insert status no longer depend on Intl formatting or material acronym formatting. Exact quantities are shown with grouped digits while node badges use bounded compact notation. Save metadata is schema 28949.


## v28.7bl
- Fixed real-graph interaction after crafting quantity changes: ordinary authored nodes can always be dragged even if stale `fixed` state leaked into saved data.
- Main-graph selection now resolves back to the canonical authored node before opening its selection/inspect card.
- Reserved hard-lock behavior only for genuine virtual/system graph points such as class points and the Technology root/spine.
- Updated save/export metadata to v28.7bl / schema 28950.
