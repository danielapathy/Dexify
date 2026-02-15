import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dexify.app",
  appName: "Dexify",
  webDir: ".",
  server: {
    // During development, point to the local dev server.
    // Comment this out for production builds.
    // url: "http://10.0.2.2:5173",
    // cleartext: true,
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0b0b0b",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0b0b",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#0b0b0b",
  },
};

export default config;
