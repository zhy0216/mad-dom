// The locked happy-dom version this facade calibrates to. The userAgent string
// embeds it so the observable value matches the baseline byte for byte.
const HAPPY_DOM_VERSION = "20.11.11";

// --- detached-window browser settings (happy-dom DefaultBrowserSettings) -------

// The default browser settings happy-dom gives a detached window
// (`BrowserSettingsFactory.createSettings` over `DefaultBrowserSettings`),
// calibrated field for field against the locked baseline — including the
// `navigator.userAgent` default that embeds the platform / arch / version and
// the `timer` / `debug` `-1` sentinel defaults.
function defaultBrowserSettings() {
  return {
    disableJavaScriptEvaluation: false,
    enableJavaScriptEvaluation: false,
    disableJavaScriptFileLoading: false,
    disableCSSFileLoading: false,
    enableImageFileLoading: false,
    disableIframePageLoading: false,
    disableComputedStyleRendering: false,
    handleDisabledFileLoadingAsSuccess: false,
    disableErrorCapturing: false,
    errorCapture: "tryAndCatch",
    enableFileSystemHttpRequests: false,
    suppressCodeGenerationFromStringsWarning: false,
    suppressInsecureJavaScriptEnvironmentWarning: false,
    timer: {
      maxTimeout: -1,
      maxIntervalTime: -1,
      maxIntervalIterations: -1,
      preventTimerLoops: false,
    },
    fetch: {
      disableSameOriginPolicy: false,
      disableStrictSSL: false,
      interceptor: null,
      requestHeaders: null,
      virtualServers: null,
    },
    module: {
      resolveNodeModules: null,
      urlResolver: null,
      disableCache: false,
    },
    navigation: {
      disableMainFrameNavigation: false,
      disableChildFrameNavigation: false,
      disableChildPageNavigation: false,
      disableFallbackToSetURL: false,
      crossOriginPolicy: "anyOrigin",
      beforeContentCallback: null,
    },
    navigator: {
      userAgent: defaultUserAgent(),
      maxTouchPoints: 0,
    },
    device: {
      prefersColorScheme: "light",
      prefersReducedMotion: "no-preference",
      mediaType: "screen",
      forcedColors: "none",
    },
    debug: {
      traceWaitUntilComplete: -1,
    },
    viewport: {
      width: 1024,
      height: 768,
      devicePixelRatio: 1,
    },
    canvasAdapter: null,
  };
}

// happy-dom `BrowserSettingsFactory.validate` parity: unknown keys and
// wrong-typed scalar values throw with the baseline messages.
function validateBrowserSettings(target, source, parentNamespace) {
  for (const key of Object.keys(source)) {
    if (target[key] === undefined) {
      const namespace = parentNamespace ? parentNamespace + "." + key : key;
      throw new Error(`Unknown browser setting "${namespace}"`);
    }
    if (typeof target[key] === "object" && !Array.isArray(target[key]) && target[key] !== null) {
      const namespace = parentNamespace ? parentNamespace + "." + key : key;
      if (typeof source[key] !== "object" || Array.isArray(source[key]) || source[key] === null) {
        throw new Error(`Browser setting "${namespace}" cannot be null`);
      }
      validateBrowserSettings(target[key], source[key], namespace);
    } else {
      if (
        (typeof target[key] === "boolean" ||
          typeof target[key] === "number" ||
          typeof target[key] === "string") &&
        typeof source[key] !== typeof target[key]
      ) {
        const isValidPreventTimerLoops =
          key === "preventTimerLoops" && typeof source[key] === "object" && source[key] !== null;
        if (!isValidPreventTimerLoops) {
          const namespace = parentNamespace ? parentNamespace + "." + key : key;
          throw new Error(`Browser setting "${namespace}" must be of type "${typeof target[key]}"`);
        }
      }
    }
  }
}

// happy-dom `BrowserSettingsFactory.createSettings` parity: the defaults merged
// with the given settings, section by section.
export function createBrowserSettings(settings) {
  const defaults = defaultBrowserSettings();
  if (settings) {
    validateBrowserSettings(defaults, settings);
  }
  return {
    ...defaults,
    ...settings,
    navigation: { ...defaults.navigation, ...settings?.navigation },
    navigator: { ...defaults.navigator, ...settings?.navigator },
    timer: { ...defaults.timer, ...settings?.timer },
    fetch: { ...defaults.fetch, ...settings?.fetch },
    module: { ...defaults.module, ...settings?.module },
    device: { ...defaults.device, ...settings?.device },
    debug: { ...defaults.debug, ...settings?.debug },
    viewport: { ...defaults.viewport, ...settings?.viewport },
    canvasAdapter: settings?.canvasAdapter ?? defaults.canvasAdapter,
  };
}


export function defaultUserAgent() {
  const platform = process.platform;
  const label = platform.charAt(0).toUpperCase() + platform.slice(1);
  return `Mozilla/5.0 (X11; ${label} ${process.arch}) AppleWebKit/537.36 (KHTML, like Gecko) HappyDOM/${HAPPY_DOM_VERSION}`;
}
