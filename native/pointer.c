#include <ApplicationServices/ApplicationServices.h>
#include <math.h>
#include <node_api.h>

static napi_value move_pointer(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value arguments[2];
  double x, y;
  if (napi_get_cb_info(env, info, &count, arguments, NULL, NULL) != napi_ok || count != 2 ||
      napi_get_value_double(env, arguments[0], &x) != napi_ok ||
      napi_get_value_double(env, arguments[1], &y) != napi_ok || !isfinite(x) || !isfinite(y)) {
    napi_throw_type_error(env, NULL, "Expected finite screen coordinates");
    return NULL;
  }
  // Quartz and Electron use global logical display coordinates on macOS.
  // Warping does not click, activate a window, or inject an input event.
  CGError status = CGWarpMouseCursorPosition(CGPointMake(x, y));
  napi_value result;
  napi_get_boolean(env, status == kCGErrorSuccess, &result);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value move;
  napi_create_function(env, "move", NAPI_AUTO_LENGTH, move_pointer, NULL, &move);
  napi_set_named_property(env, exports, "move", move);
  return exports;
}

NAPI_MODULE(pointer, initialize)
