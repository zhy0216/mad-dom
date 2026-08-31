// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/permissions/PermissionNameEnum.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
enum PermissionNameEnum {
	geolocation = 'geolocation',
	notifications = 'notifications',
	push = 'push',
	midi = 'midi',
	camera = 'camera',
	microphone = 'microphone',
	backgroundFetch = 'background-fetch',
	backgroundSync = 'background-sync',
	persistentStorage = 'persistent-storage',
	ambientLightSensor = 'ambient-light-sensor',
	accelerometer = 'accelerometer',
	gyroscope = 'gyroscope',
	magnetometer = 'magnetometer',
	screenWakeLock = 'screen-wake-lock',
	nfc = 'nfc',
	displayCapture = 'display-capture',
	accessibilityEvents = 'accessibility-events',
	clipboardRead = 'clipboard-read',
	clipboardWrite = 'clipboard-write',
	paymentHandler = 'payment-handler',
	idleDetection = 'idle-detection',
	periodicBackgroundSync = 'periodic-background-sync',
	systemWakeLock = 'system-wake-lock',
	storageAccess = 'storage-access',
	windowManagement = 'window-management',
	windowPlacement = 'window-placement',
	localFonts = 'local-fonts',
	topLevelStorageAccess = 'top-level-storage-access'
}

export default PermissionNameEnum;
