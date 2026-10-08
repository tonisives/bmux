#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>

int main(void) {
  CGDirectDisplayID display = CGMainDisplayID();
  const void *keys[] = { kCGDisplayShowDuplicateLowResolutionModes };
  const void *values[] = { kCFBooleanTrue };
  CFDictionaryRef options = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFArrayRef modes = CGDisplayCopyAllDisplayModes(display, options);
  if (!modes) { fprintf(stderr, "Cannot list demo display modes.\n"); return 1; }
  CGDisplayModeRef selected = NULL;
  for (CFIndex index = 0; index < CFArrayGetCount(modes); index++) {
    CGDisplayModeRef mode = (CGDisplayModeRef)CFArrayGetValueAtIndex(modes, index);
    size_t width = CGDisplayModeGetWidth(mode), height = CGDisplayModeGetHeight(mode);
    if (width < 1400 || height < 900) continue;
    if (!selected || width * height < CGDisplayModeGetWidth(selected) * CGDisplayModeGetHeight(selected) ||
        (width == CGDisplayModeGetWidth(selected) && height == CGDisplayModeGetHeight(selected) && CGDisplayModeGetPixelWidth(mode) < CGDisplayModeGetPixelWidth(selected))) selected = mode;
  }
  if (!selected) { fprintf(stderr, "No display mode fits the demo workspace.\n"); return 1; }
  CGDisplayConfigRef configuration = NULL;
  CGError result = CGBeginDisplayConfiguration(&configuration);
  if (result == kCGErrorSuccess) result = CGConfigureDisplayWithDisplayMode(configuration, display, selected, NULL);
  if (result == kCGErrorSuccess) result = CGCompleteDisplayConfiguration(configuration, kCGConfigureForSession);
  else if (configuration) CGCancelDisplayConfiguration(configuration);
  if (result != kCGErrorSuccess) { fprintf(stderr, "Cannot set demo display mode: %d\n", result); return 1; }
  printf("Demo display: %zux%zu\n", CGDisplayModeGetWidth(selected), CGDisplayModeGetHeight(selected));
  CFRelease(modes);
  CFRelease(options);
  return 0;
}
