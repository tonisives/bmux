#import <Cocoa/Cocoa.h>
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
static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor method = { "hit", NULL, hit, NULL, NULL, NULL, napi_default, NULL };
  napi_define_properties(env, exports, 1, &method);
  return exports;
}
NAPI_MODULE(native_hit_test, initialize)
