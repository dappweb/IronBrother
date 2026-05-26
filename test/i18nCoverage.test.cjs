const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'App.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hanRegex = /[\u4e00-\u9fff]/;

function stringLiteralText(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

const englishTranslations = new Map();
const translatedSourceStrings = new Set();
let zhTwSpreadsEnglishTranslations = false;

function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'EN_TRANSLATIONS' &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    for (const property of node.initializer.properties) {
      if (!ts.isPropertyAssignment(property)) continue;

      const key = stringLiteralText(property.name);
      const value = stringLiteralText(property.initializer);
      if (key && value) {
        englishTranslations.set(key, value);
      }
    }
  }

  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'TEXT_TRANSLATIONS' &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    for (const property of node.initializer.properties) {
      if (!ts.isPropertyAssignment(property)) continue;

      const key = stringLiteralText(property.name);
      if (key !== 'zh-TW' || !ts.isObjectLiteralExpression(property.initializer)) continue;

      zhTwSpreadsEnglishTranslations = property.initializer.properties.some(
        (entry) => ts.isSpreadAssignment(entry) && ts.isIdentifier(entry.expression) && entry.expression.text === 'EN_TRANSLATIONS',
      );
    }
  }

  if (ts.isCallExpression(node)) {
    const callName = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
    if (callName === 't') {
      const value = stringLiteralText(node.arguments[0]);
      if (value && hanRegex.test(value)) translatedSourceStrings.add(value);
    }

    if (callName === 'translateText') {
      const value = stringLiteralText(node.arguments[1]);
      if (value && hanRegex.test(value)) translatedSourceStrings.add(value);
    }
  }

  ts.forEachChild(node, visit);
}

visit(sourceFile);

const missingEnglishTranslations = [...translatedSourceStrings]
  .filter((value) => !englishTranslations.has(value))
  .sort((left, right) => left.localeCompare(right, 'zh-CN'));

assert.deepEqual(
  missingEnglishTranslations,
  [],
  `Missing EN_TRANSLATIONS entries for: ${missingEnglishTranslations.join(', ')}`,
);

const englishValuesWithChinese = [...englishTranslations.entries()]
  .filter(([, value]) => hanRegex.test(value))
  .map(([key, value]) => `${key} -> ${value}`)
  .sort((left, right) => left.localeCompare(right, 'zh-CN'));

assert.deepEqual(
  englishValuesWithChinese,
  [],
  `EN_TRANSLATIONS values must not contain Chinese text: ${englishValuesWithChinese.join(', ')}`,
);

assert.equal(
  zhTwSpreadsEnglishTranslations,
  false,
  'zh-TW must use Traditional Chinese fallback, not the English translation table.',
);
