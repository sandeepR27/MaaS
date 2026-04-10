import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import checkFile from "eslint-plugin-check-file";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    plugins: {
      "check-file": checkFile,
    },
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        {
          "src/components/**/*.{tsx,jsx}": "PASCAL_CASE",
          "src/**/*.{ts,tsx,js,jsx}": "KEBAB_CASE"
        },
        {
          ignoreMiddleExtensions: true
        }
      ],
      "check-file/folder-naming-convention": [
        "error",
        {
          "src/**/": "KEBAB_CASE"
        }
      ]
    }
  }
]);

export default eslintConfig;
