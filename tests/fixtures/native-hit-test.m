#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#include <node_api.h>

// Read the real AppKit target; renderer/CDP mouse events bypass this routing.
static napi_value hit(napi_env env, napi_callback_info info) {
  size_t count = 3; napi_value args[3], result;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  void *data = NULL; size_t size = 0;
  if (count != 3 || napi_get_buffer_info(env, args[0], &data, &size) != napi_ok || size != sizeof(NSView *)) {
    napi_get_undefined(env, &result); return result;
  }
  NSView *root = ((__bridge NSView *)*(void **)data).window.contentView;
  double x = 0, y = 0;
  napi_get_value_double(env, args[1], &x); napi_get_value_double(env, args[2], &y);
  NSPoint point = NSMakePoint(x, root.isFlipped ? y : root.bounds.size.height - y);
  NSView *view = [root hitTest:[root convertPoint:point toView:root.superview]];
  while (view && ![view isKindOfClass:NSClassFromString(@"WebContentsViewCocoa")]) view = view.superview;
  NSString *target = view ? NSStringFromSize(view.bounds.size) : @"none";
  napi_create_string_utf8(env, target.UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}
// Send a physical mouse-wheel shaped event through AppKit, including Shift.
static napi_value scroll(napi_env env, napi_callback_info info) {
  size_t count = 4; napi_value args[4], result;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  void *data = NULL; size_t size = 0;
  napi_get_buffer_info(env, args[0], &data, &size);
  NSWindow *window = ((__bridge NSView *)*(void **)data).window;
  double x = 0, y = 0, delta = 0;
  napi_get_value_double(env, args[1], &x); napi_get_value_double(env, args[2], &y); napi_get_value_double(env, args[3], &delta);
  NSPoint point = [window.contentView convertPoint:NSMakePoint(x, window.contentView.isFlipped ? y : window.contentView.bounds.size.height - y) toView:nil];
  CGEventRef cg = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, (int32_t)delta);
  CGEventSetFlags(cg, kCGEventFlagMaskShift);
  NSPoint screen = [window convertPointToScreen:point];
  CGPoint location = CGPointMake(screen.x, CGDisplayBounds(CGMainDisplayID()).size.height - screen.y);
  CGEventRef move = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, location, kCGMouseButtonLeft);
  CGEventPost(kCGHIDEventTap, move);
  CFRelease(move);
  CGEventSetLocation(cg, location);
  CGEventPost(kCGHIDEventTap, cg);
  CFRelease(cg);
  // Reset the session's modifier state before another native-input fixture runs.
  CGEventRef release = CGEventCreateKeyboardEvent(NULL, 56, false);
  CGEventSetFlags(release, 0);
  CGEventPost(kCGHIDEventTap, release);
  CFRelease(release);
  napi_get_undefined(env, &result); return result;
}
static void describe(NSView *view, NSMutableString *text, NSUInteger depth) {
  [text appendFormat:@"%lu %@ %@\n", (unsigned long)depth, NSStringFromClass(object_getClass(view)), NSStringFromRect(view.frame)];
  for (NSView *child in view.subviews) describe(child, text, depth + 1);
}
static napi_value tree(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value arg, result;
  napi_get_cb_info(env, info, &count, &arg, NULL, NULL);
  void *data = NULL; size_t size = 0;
  napi_get_buffer_info(env, arg, &data, &size);
  NSMutableString *text = [NSMutableString string];
  describe(((__bridge NSView *)*(void **)data).window.contentView, text, 0);
  napi_create_string_utf8(env, text.UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    { "hit", NULL, hit, NULL, NULL, NULL, napi_default, NULL },
    { "scroll", NULL, scroll, NULL, NULL, NULL, napi_default, NULL },
    { "tree", NULL, tree, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, 3, methods);
  return exports;
}
NAPI_MODULE(native_hit_test, initialize)
