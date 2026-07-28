const { getDefaultConfig } = require("expo/metro-config");

// Keep the native development client rooted in the mobile app.  In a workspace
// Metro otherwise starts at the repository root and can resolve Expo internals
// with the wrong platform extension settings.
module.exports = getDefaultConfig(__dirname);
