const path = require("path");

const config = {
  projectName: "literature-mp",
  date: "2026-10-2",
  designWidth: 375,
  deviceRatio: {
    375: 2,
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: "src",
  outputRoot: "dist",
  plugins: [],
  defineConstants: {},
  copy: { patterns: [], options: {} },
  framework: "react",
  compiler: "webpack5",
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: { onePxTransform: false }
      },
      cssModules: {
        enable: false
      }
    }
  },
  h5: {}
};

module.exports = function (merge) {
  if (process.env.NODE_ENV === "production") {
    return merge({}, config, require("./prod.js"));
  }
  return merge({}, config, require("./dev.js"));
};
