# bmux app icon

![Little lantern](app-icon.png)

The selected icon is Little lantern. Its [original concept](icon-concepts/warm-round/05-little-lantern.png) and [generation prompt](icon-concepts/warm-round/README.md) remain in the warm concept round.

`app-icon.png` is the production source with a transparent outer margin. Run `pnpm icons` on macOS to regenerate `build/icon.icns` and the website PNGs under `website/public/cdn`. Run `pnpm package` to build and install the app without restarting it.

The production source was prepared with the built-in image generator using this edit prompt:

Make the background transparent. Cut out the entire peach rounded-square app icon from the attached image, keeping the peach tile itself opaque and keeping every detail of the teal lantern inside it. The light gray outer margin must be empty transparent pixels. Preserve the original image, colors, size and composition. Output a transparent PNG app icon.
