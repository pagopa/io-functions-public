module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true
  },
  ignorePatterns: [
    "node_modules",
    "generated",
    "**/__tests__/*",
    "**/__mocks__/*",
    "*.d.ts"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "tsconfig.json",
    sourceType: "module"
  },
  extends: ["@pagopa/eslint-config/strong"],
  rules: {
    "max-params": "off"
  }
};
