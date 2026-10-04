#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>

// These layers belong to the browser, never to a site's DOM or renderer. The
// clipping view also keeps a swipe inside its pane and below browser controls.
@interface BmuxSwipeView : NSView
@property(nonatomic, strong) CALayer *page;
@end
@implementation BmuxSwipeView
- (BOOL)isFlipped { return YES; }
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
@end

static NSMutableDictionary<NSNumber *, BmuxSwipeView *> *previews;
static id monitor;
static napi_ref listener;

static NSView *view_argument(napi_env env, napi_value value) {
  void *data = NULL; size_t size = 0;
  if (napi_get_buffer_info(env, value, &data, &size) != napi_ok || size != sizeof(NSView *)) return nil;
  return (__bridge NSView *)*(void **)data;
}
static double number(napi_env env, napi_value value) {
  double result = 0;
  napi_get_value_double(env, value, &result);
  return result;
}
static napi_value nothing(napi_env env) { napi_value value; napi_get_undefined(env, &value); return value; }
static CGImageRef image(napi_env env, napi_value value) {
  void *data = NULL; size_t size = 0;
  if (napi_get_buffer_info(env, value, &data, &size) != napi_ok || !size) return NULL;
  NSImage *image = [[NSImage alloc] initWithData:[NSData dataWithBytes:data length:size]];
  return CGImageRetain([image CGImageForProposedRect:NULL context:nil hints:nil]);
}
static napi_value show(napi_env env, napi_callback_info info) {
  size_t count = 9; napi_value args[9];
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  if (count != 9) return nothing(env);
  NSNumber *key = @(number(env, args[0]));
  NSView *host = view_argument(env, args[1]).window.contentView;
  if (!host) return nothing(env);
  [previews[key] removeFromSuperview];
  CGFloat x = number(env, args[2]), y = number(env, args[3]), width = number(env, args[4]), height = number(env, args[5]);
  if (!host.isFlipped) y = host.bounds.size.height - y - height;
  BmuxSwipeView *view = [[BmuxSwipeView alloc] initWithFrame:NSMakeRect(x, y, width, height)];
  view.wantsLayer = YES;
  view.layer.masksToBounds = YES;
  view.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;
  CALayer *previous = [CALayer layer];
  previous.frame = view.bounds;
  previous.contents = CFBridgingRelease(image(env, args[7]));
  previous.contentsGravity = kCAGravityResize;
  [view.layer addSublayer:previous];
  view.page = [CALayer layer];
  view.page.frame = view.bounds;
  view.page.contents = CFBridgingRelease(image(env, args[6]));
  view.page.contentsGravity = kCAGravityResize;
  view.page.backgroundColor = NSColor.windowBackgroundColor.CGColor;
  view.page.shadowOpacity = 0.2;
  view.page.shadowRadius = 10;
  view.page.shadowOffset = CGSizeZero;
  view.page.transform = CATransform3DMakeTranslation(number(env, args[8]), 0, 0);
  [view.layer addSublayer:view.page];
  [host addSubview:view positioned:NSWindowAbove relativeTo:nil];
  previews[key] = view;
  return nothing(env);
}
static napi_value move(napi_env env, napi_callback_info info) {
  size_t count = 3; napi_value args[3];
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  if (count != 3) return nothing(env);
  BmuxSwipeView *view = previews[@(number(env, args[0]))];
  if (!view) return nothing(env);
  double duration = number(env, args[2]);
  if (!duration) [view.page removeAllAnimations];
  [CATransaction begin];
  [CATransaction setDisableActions:duration == 0];
  [CATransaction setAnimationDuration:duration];
  [CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut]];
  view.page.transform = CATransform3DMakeTranslation(number(env, args[1]), 0, 0);
  [CATransaction commit];
  return nothing(env);
}
static napi_value hide(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value arg;
  napi_get_cb_info(env, info, &count, &arg, NULL, NULL);
  if (count == 1) { NSNumber *key = @(number(env, arg)); [previews[key] removeFromSuperview]; [previews removeObjectForKey:key]; }
  return nothing(env);
}
static napi_value window_number(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value arg, result;
  napi_get_cb_info(env, info, &count, &arg, NULL, NULL);
  napi_create_int64(env, count == 1 ? view_argument(env, arg).window.windowNumber : 0, &result);
  return result;
}
static void cleanup(void *data) {
  (void)data;
  if (monitor) [NSEvent removeMonitor:monitor];
  monitor = nil;
  for (BmuxSwipeView *view in previews.allValues) [view removeFromSuperview];
  [previews removeAllObjects];
}
static napi_value observe(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value callback;
  napi_get_cb_info(env, info, &count, &callback, NULL, NULL);
  if (count != 1 || monitor) return nothing(env);
  napi_create_reference(env, callback, 1, &listener);
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    // Wheel events with no phases (ordinary mice and CDP) use the JS fallback.
    NSView *host = event.window.contentView;
    NSPoint point = [host convertPoint:event.locationInWindow fromView:nil];
    if (!host.isFlipped) point.y = host.bounds.size.height - point.y;
    napi_handle_scope scope;
    napi_open_handle_scope(env, &scope);
    napi_value fn, receiver, result, args[5];
    napi_get_reference_value(env, listener, &fn);
    napi_get_undefined(env, &receiver);
    double values[] = { event.window.windowNumber, point.x, point.y, event.phase, event.momentumPhase };
    for (size_t i = 0; i < 5; i++) napi_create_double(env, values[i], &args[i]);
    napi_call_function(env, receiver, fn, 5, args, &result);
    napi_close_handle_scope(env, scope);
    return event;
  }];
  return nothing(env);
}
static napi_value initialize(napi_env env, napi_value exports) {
  previews = [NSMutableDictionary dictionary];
  napi_add_env_cleanup_hook(env, cleanup, NULL);
  napi_property_descriptor methods[] = {
    { "show", NULL, show, NULL, NULL, NULL, napi_default, NULL },
    { "move", NULL, move, NULL, NULL, NULL, napi_default, NULL },
    { "hide", NULL, hide, NULL, NULL, NULL, napi_default, NULL },
    { "windowNumber", NULL, window_number, NULL, NULL, NULL, napi_default, NULL },
    { "observe", NULL, observe, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, 5, methods);
  return exports;
}
NAPI_MODULE(swipe, initialize)
