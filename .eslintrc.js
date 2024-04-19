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
    "max-params": "off",
    //TODO: remove this overrides
    "max-lines-per-function": "off",
    "sort-keys": "off",
    "sonarjs/cognitive-complexity": "off",
    "@typescript-eslint/naming-convention": "off",
    "@typescript-eslint/explicit-function-return-type": "off"
  }
};
