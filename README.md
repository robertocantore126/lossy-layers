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

### Adding a compression method

`src/pipeline/codecs.ts` holds the `Codec` interface and its registry;
`builtinCodecs.ts` holds the four that ship. A codec's `run` is one pass:
degrade the pixels the way the method does, and report what it costs. Feeding
its own output back in is what produces generation loss, so a codec has to be
able to consume what it produces.

Two rules keep the byte counts honest, and both exist because of a real trap:

- **Never trust a requested MIME type.** A canvas asked for a format it cannot
  encode returns a PNG without complaint, which would show up as a method that
  mysteriously never damages anything. `encodeAs` checks the returned type and
  gives back `null` instead, and `canEncode` probes once so unsupported
  formats are never offered. On this browser JPEG and WebP encode; AVIF, JPEG
  XL and HEIC all silently fall back.
- **Report the method, not the wrapper.** Set `reportedBytes` when the
  saveable file misrepresents the cost. Indexed colour needs it: the canvas
  PNG encoder always writes truecolour, so a 16-colour image comes back the
  size of the original. `indexedPayloadSize` packs the indices at their real
  bit depth with PNG's row padding and filter bytes, deflates them through
  `CompressionStream`, and adds the palette.

### The four that ship

| Method | What it does to the image |
| --- | --- |
| JPEG | Eight-pixel blocks, ringing at hard edges, colour smeared across them |
| WebP | Smears instead of blocking; flat waxy patches, fine texture gone |
| Indexed colour | Median-cut palette taken from the image, with optional dithering |
| Chroma crush | Keeps luma at full resolution and guts the colour difference channels |
| Repost chain | JPEG and WebP alternating, each hop worse than the last |

Repost chain is the reason `Codec.run` receives a `PassContext`. Most methods
ignore it and behave identically every time, because they model one encoder
applied repeatedly. That one models an image passed between platforms, so
each hop has to know where it sits: which format this round uses, how much
quality has been lost getting here, and whether to resize on the way through.
The two formats damage each other in a way neither does alone, since JPEG's
block edges become real detail for WebP to smear and WebP's flat patches give
JPEG new edges to ring against.

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

## The preview while dragging

`refresh(fast)` runs a cheaper render while the pointer is down. It used to
force a single pass, which was fine when the only method was JPEG and one
pass looked much like eight. Once the methods got stronger that became a bug
in disguise: you judged WebP at one hop while it was set to eight, so the
method looked weaker than it is, and the image visibly changed the moment you
let go.

`CrunchSettings.livePreview` now decides, and defaults to `full` — show what
you will actually get. `adaptive` fits as many passes as a 120 ms budget
allows, using the measured cost of the last full render. `fast` is the old
single-pass behaviour, kept for slow machines. The control only appears above
one pass, where the distinction means something.

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
