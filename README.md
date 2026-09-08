# Lossy Layers

A layered image editor where JPEG compression is shown live beside the clean
canvas, so you can see what the encode keeps while you are still working.

It grew out of [WeirdMakerBot](https://github.com/Antek1234l/WeirdMakerBot), a
Discord bot whose entire "compression" feature was one line:

```python
img.convert('RGB').save(out, quality=N)
```

That is still the heart of it. What is added here is a real editor around it,
and repeated passes, which the bot never had.

## Running it

```
npm install
npm run dev
```

`npm run build` type-checks, bundles everything into a single self-contained
`dist/index.html`, then writes `dist/artifact.html`, the same page with the
outer document skeleton stripped for hosts that supply their own.

`npm run typecheck` runs the compiler alone.

## How it is put together

```
src/
  core/        the document, and nothing that knows about the DOM shell
    types.ts       layers, blend modes, parameter specs
    canvas.ts      canvas helpers used everywhere
    store.ts       the document and every mutation of it
    history.ts     undo/redo
    compositor.ts  flattens the stack, including a stroke in progress
    brush.ts       the soft round brush and its stroke buffer
  tools/       pointer behaviour, one file per tool
  filters/     pixel effects, one registry, one file of built-ins
  pipeline/    the compression stage
  io/          import, project files, saving
  ui/          the shell: panels, viewport, wiring
```

The rule the layout enforces: `core`, `tools`, `filters`, `pipeline` and `io`
never reach into `ui`. Dependencies point one way, so a tool or filter can be
tested without a page around it.

### Adding a tool

Write a file in `src/tools/` exporting an object that satisfies `Tool`, then
register it in `src/ui/app.ts`. It gets a `ToolContext` with the store,
history, brush and a render request. Nothing in the shell needs changing; the
toolbar, the options panel and the keyboard shortcut all come from the
registration.

```ts
export const myTool: Tool = {
  id: 'smudge',
  label: 'Smudge',
  icon: '<circle cx="12" cy="12" r="7"/>',
  hint: 'What it does, in one line, shown under the toolbar.',
  shortcut: 's',
  buildOptions(host, ctx) { /* append controls from ui/controls */ },
  onPointerDown(p, ctx) {},
  onPointerMove(p, ctx) {},
  onPointerUp(p, ctx) {},
};
```

If the tool draws, return a `StrokeOverlay` from `overlay()` and the
compositor will show the stroke without committing it to the layer.

### Adding a filter

Write an object satisfying `Filter` and add it to the list in
`src/filters/builtin.ts`. Declare parameters as `ParamSpec` values and the
panel builds its own controls, preview, Apply, Reset and Cancel.

```ts
const invert: Filter = {
  id: 'invert',
  label: 'Invert',
  group: 'Adjust',
  params: [{ kind: 'range', key: 'amount', label: 'Amount', min: 0, max: 100, default: 100 }],
  apply(src, values) { /* return a new canvas */ },
};
```

A filter takes a canvas and returns a canvas. It never sees the layer stack,
the store or the DOM.

## Layer masks

A mask is an alpha channel the same size as its layer, held on `Layer.mask`.
The compositor applies it with one `destination-in`, so the layer shows only
where the mask is opaque and its own pixels are never modified.

This is what makes collage blending work. Erase on a mask and the image is
hidden, not deleted, so you can brush it straight back. The brush reveals and
the eraser hides, which spares anyone having to remember whether black or
white is the hiding colour.

`Store` owns the lifecycle: `addMask`, `removeMask`, `toggleMask`,
`invertMask`, `fillMask` and `applyMask`, plus `maskedPixels` for anywhere
that needs a layer already flattened against its mask. `mergeDown` uses that
last one, or merging would resurrect pixels the mask was hiding.

Tools write to whichever surface is selected. `ToolContext.target` is already
resolved, so a tool never has to check whether a mask exists, and
`Store.detachTarget` applies the copy-on-write rule to the right canvas.

## Two things worth knowing before changing them

**Undo is copy-on-write.** `History.push` snapshots the layer array with the
pixel buffers shared by reference, so a snapshot costs an array rather than a
stack of canvases. It only works because `Store.detach` gives a layer fresh
pixels before anything writes to them. Call `push` *before* mutating, and call
`detach` before touching pixels, or undo will quietly return the edited state.

**The pipeline encodes with `toDataURL`, not `toBlob`.** Both produce the same
JPEG bytes, but `toBlob` and `OffscreenCanvas.convertToBlob` return through a
scheduled callback that some embedders throttle to about one per second.
Measured here: 2 ms synchronous against 1005 ms through the callback. At the
thirty passes the app allows, that is half a second versus half a minute.
`pipeline/crunch.ts` converts the data URL back to exact bytes itself.

## Project files

`.lossy.json` holds the document and each layer's pixels as a PNG data URL.
PNG because layers carry alpha and a lossy intermediate would degrade the
document every time it was reopened. Files are therefore large; that is the
right trade for a source document. The reader checks a format tag and a
version and refuses anything newer than it understands.

Format 2 added masks. Version 1 files still load: they simply have no mask,
which `deserialize` treats as `null`.

## Licence

Personal project. The overlay art and phrase list in the original bot belong
to its author.
