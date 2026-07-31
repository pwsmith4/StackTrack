// This file is deliberately kept in sync by infrastructure/release/bump-mobile-version.ps1.
// It is bundled into the app, so every installed device reports the exact release it runs.
export const APP_VERSION = "0.3.3";
export const APP_BUILD_NUMBER = 6;
const AUTOMATED_BUILD_ID = process.env.EXPO_PUBLIC_BUILD_ID?.trim();

// GitHub Actions supplies this on every push build. The local fallback keeps
// emulator builds readable while still identifying the native build number.
export const APP_REPORTED_VERSION = AUTOMATED_BUILD_ID
  ? `${APP_VERSION}+${AUTOMATED_BUILD_ID}`
  : APP_VERSION;
export const APP_RELEASE = AUTOMATED_BUILD_ID
  ? APP_REPORTED_VERSION
  : `${APP_VERSION} (build ${APP_BUILD_NUMBER})`;
