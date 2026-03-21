import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["cesium"],
  webpack: (config) => {
    config.amd = {
      ...(config.amd ?? {}),
      toUrlUndefined: true,
    };
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      cesium_source: path.resolve(__dirname, "node_modules/cesium/Source"),
    };
    return config;
  },
};

export default nextConfig;
