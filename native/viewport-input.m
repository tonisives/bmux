#import <Cocoa/Cocoa.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <node_api.h>

// Compositor masks do not constrain AppKit hit testing. Limit only this page's
// input region, preserving Chromium's native view hierarchy and layout.
@interface BmuxInputRegion : NSObject
@property(nonatomic, weak) NSView *page;
@property(nonatomic, weak) NSView *root;
@property(nonatomic, assign) Class originalClass;
@property(nonatomic, assign) Class clippedClass;
@property(nonatomic) NSRect rect;
@end
@implementation BmuxInputRegion
@end
static NSMutableDictionary<NSNumber *, BmuxInputRegion *> *regions;
static char region_key;
static NSView *hit_test(NSView *page, SEL selector, NSPoint point) {
  BmuxInputRegion *region = objc_getAssociatedObject(page, &region_key);
  if (region.root && !NSPointInRect([page.superview convertPoint:point toView:region.root], region.rect)) return nil;
  struct objc_super parent = { page, region ? region.originalClass : class_getSuperclass(object_getClass(page)) };
  return ((NSView *(*)(struct objc_super *, SEL, NSPoint))objc_msgSendSuper)(&parent, selector, point);
}
static double number(napi_env env, napi_value value) { double result = 0; napi_get_value_double(env, value, &result); return result; }
static napi_value nothing(napi_env env) { napi_value value; napi_get_undefined(env, &value); return value; }
static NSRect rectangle(napi_env env, napi_value *args) { return NSMakeRect(number(env, args[0]), number(env, args[1]), number(env, args[2]), number(env, args[3])); }
static NSView *find_page(NSView *parent, NSView *root, NSRect target) {
  for (NSView *view in parent.subviews) {
    NSRect rect = [view convertRect:view.bounds toView:root];
    if ([view isKindOfClass:NSClassFromString(@"WebContentsViewCocoa")] &&
        fabs(rect.origin.x - target.origin.x) < 1 && fabs(rect.origin.y - target.origin.y) < 1 &&
        fabs(rect.size.width - target.size.width) < 1 && fabs(rect.size.height - target.size.height) < 1) return view;
    NSView *found = find_page(view, root, target);
    if (found) return found;
  }
  return nil;
}
static void restore(NSNumber *key) {
  BmuxInputRegion *region = regions[key]; NSView *page = region.page;
  if (page) {
    if (object_getClass(page) == region.clippedClass) object_setClass(page, region.originalClass);
    objc_setAssociatedObject(page, &region_key, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  [regions removeObjectForKey:key];
}
static napi_value clip(napi_env env, napi_callback_info info) {
  size_t count = 10; napi_value args[10];
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  void *data = NULL; size_t size = 0;
  if (count != 10 || napi_get_buffer_info(env, args[1], &data, &size) != napi_ok || size != sizeof(NSView *)) return nothing(env);
  NSNumber *key = @(number(env, args[0]));
  NSView *root = ((__bridge NSView *)*(void **)data).window.contentView;
  if (!root) return nothing(env);
  NSRect frame = rectangle(env, args + 2), target = rectangle(env, args + 6);
  target.origin.x += frame.origin.x; target.origin.y += frame.origin.y;
  if (!root.isFlipped) {
    target.origin.y = root.bounds.size.height - target.origin.y - target.size.height;
    frame.origin.y = root.bounds.size.height - frame.origin.y - frame.size.height;
  }
  BmuxInputRegion *region = regions[key];
  if (!region.page || region.page.window != root.window) {
    restore(key);
    NSView *page = find_page(root, root, target);
    if (!page) return nothing(env);
    region = [BmuxInputRegion new]; region.page = page; region.originalClass = object_getClass(page);
    NSString *name = [@"BmuxClippedInput_" stringByAppendingString:NSStringFromClass(region.originalClass)];
    Class subclass = NSClassFromString(name);
    if (!subclass) {
      subclass = objc_allocateClassPair(region.originalClass, name.UTF8String, 0);
      class_addMethod(subclass, @selector(hitTest:), (IMP)hit_test, method_getTypeEncoding(class_getInstanceMethod(region.originalClass, @selector(hitTest:))));
      objc_registerClassPair(subclass);
    }
    region.clippedClass = subclass;
    objc_setAssociatedObject(page, &region_key, region, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    object_setClass(page, subclass); regions[key] = region;
  }
  region.root = root; region.rect = frame;
  return nothing(env);
}
static napi_value clear(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value arg;
  napi_get_cb_info(env, info, &count, &arg, NULL, NULL);
  if (count == 1) restore(@(number(env, arg)));
  return nothing(env);
}
static void cleanup(void *data) { (void)data; for (NSNumber *key in regions.allKeys) restore(key); }
static napi_value initialize(napi_env env, napi_value exports) {
  regions = [NSMutableDictionary dictionary]; napi_add_env_cleanup_hook(env, cleanup, NULL);
  napi_property_descriptor methods[] = {
    { "clip", NULL, clip, NULL, NULL, NULL, napi_default, NULL },
    { "clear", NULL, clear, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, 2, methods); return exports;
}
NAPI_MODULE(viewport_input, initialize)
