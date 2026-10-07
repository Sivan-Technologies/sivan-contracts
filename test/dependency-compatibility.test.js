const { expect } = require("chai");

describe("Patched build dependency compatibility", () => {
  it("uses patched PBKDF2 and preserves long-password derivation", () => {
    const { pbkdf2Sync } = require("crypto");
    // Exercise the JS implementation implicated in the advisory, not its native wrapper.
    const derive = require("pbkdf2/lib/sync");
    expect(require("pbkdf2/package.json").version).to.equal("3.1.7");
    for (const digest of ["sha256", "sha512"]) {
      for (const password of ["short", "x".repeat(4096)]) {
        const expected = pbkdf2Sync(password, "test-only-salt", 10, 32, digest);
        expect(derive(password, "test-only-salt", 10, 32, digest).equals(expected)).to.equal(true);
      }
    }
  });
  it("preserves the archive API used by the compiler downloader", () => {
    const Zip = require("adm-zip");
    const zip = new Zip();
    zip.addFile("compiler.txt", Buffer.from("test-only"));
    expect(new Zip(zip.toBuffer()).readAsText("compiler.txt")).to.equal("test-only");
  });
  it("preserves serialization, patch, UUID and temporary-file APIs", () => {
    const serialize = require("serialize-javascript");
    expect(JSON.parse(serialize({a:1}))).to.deep.equal({a:1});
    const diff = require("diff");
    expect(diff.applyPatch("a\n", diff.createPatch("test", "a\n", "b\n"))).to.equal("b\n");
    const uuid = require("uuid");
    expect(uuid.validate(uuid.v4())).to.equal(true);
    const tmp = require("tmp").fileSync();
    tmp.removeCallback();
  });
  it("preserves Hardhat JSON-RPC over the patched HTTP transport", async () => {
    const http = require("http");
    const { HttpProvider } = require("hardhat/internal/core/providers/http");
    const { Pool } = require("undici");
    const server = http.createServer(async (req,res) => {
      let body=""; for await(const chunk of req) body+=chunk;
      const request=JSON.parse(body);
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify({jsonrpc:"2.0",id:request.id,result:"0x7a69"}));
    });
    await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const url = `http://127.0.0.1:${server.address().port}`;
    const pool = new Pool(url);
    try {
      const provider = new HttpProvider(url,"local-compatibility",{},2000,pool);
      expect(await provider.request({method:"eth_chainId",params:[]})).to.equal("0x7a69");
    } finally {
      await pool.close();
      await new Promise(resolve=>server.close(resolve));
    }
  });
});
