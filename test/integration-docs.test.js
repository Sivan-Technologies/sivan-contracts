const {expect}=require('chai');
const {compare}=require('../scripts/check-integration-docs');
describe('Integration documentation drift detection',()=>{
  it('accepts identical fingerprints',()=>{
    expect(compare({files:{a:'1'}},{files:{a:'1'}})).deep.eq([]);
  });
  it('detects changed source or prose and added/deleted tracked files',()=>{
    expect(compare({files:{source:'old',guide:'old',deleted:'1'}},
      {files:{source:'new',guide:'new',added:'1'}})).deep.eq(['added','deleted','guide','source']);
  });
});
