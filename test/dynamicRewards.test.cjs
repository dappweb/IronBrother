const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const filePath = path.resolve(__dirname, "..", relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(compiled.outputText, filePath);
  return mod.exports;
}

test("calculates unsettled eligible dynamic rewards", () => {
  const {
    calculatePendingDynamicRewardRows,
    sumPendingDynamicRewards,
  } = loadTypeScriptModule("src/lib/dynamicRewards.ts");
  const unit = 10n ** 18n;

  const rows = calculatePendingDynamicRewardRows(
    [
      { source: "0xchild1", day: 12n, generation: 1, volume: 1000n * unit, settled: false },
      { source: "0xchild2", day: 12n, generation: 1, volume: 900n * unit, settled: false },
      { source: "0xchild3", day: 12n, generation: 2, volume: 1000n * unit, settled: false },
      { source: "0xchild4", day: 12n, generation: 1, volume: 1000n * unit, settled: true },
    ],
    [{ generation: 1, rateBps: 20n }],
    [{ day: 12n, eligibleGeneration: 1 }],
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "0xchild1");
  assert.equal(rows[0].reward, 2n * unit);
  assert.equal(rows[1].source, "0xchild2");
  assert.equal(rows[1].reward, (18n * unit) / 10n);
  assert.equal(sumPendingDynamicRewards(rows), (38n * unit) / 10n);
});
