const fs = require("fs");
const ts = require("typescript");
const { expect } = require("chai");

require.extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  module._compile(output, filename);
};

const { resolveAdminAccess } = require("../src/lib/adminAccess.ts");

describe("resolveAdminAccess", function () {
  it("denies connected wallets that do not have Admin or Manager roles", function () {
    expect(
      resolveAdminAccess({
        isContractConfigured: true,
        isConnected: true,
        wrongNetwork: false,
        isRoleLoading: false,
        isSuperAdmin: false,
        isManager: false,
      }),
    ).to.equal("denied");
  });
});
