const test = require('node:test');
const assert = require('node:assert/strict');

const base = process.env.OBC_TEST_BASE;
const enabled = Boolean(base && process.env.OBC_TEST_ADMIN && process.env.OBC_TEST_PASSWORD && process.env.OBC_TEST_BRIDGE_TOKEN);
const request = async (url, options = {}) => fetch(`${base}${url}`, options);

test('V1.7.1 JWT auth, remote release transport and rollback request', { skip: !enabled }, async () => {
    let response = await request('/api/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username:process.env.OBC_TEST_ADMIN,password:process.env.OBC_TEST_PASSWORD}) });
    assert.equal(response.status, 200); const login = await response.json(); const admin = { authorization:`Bearer ${login.token}`, 'content-type':'application/json' };
    response = await request('/api/oblivion/traders', { headers:{'x-obc-role':'super_admin'} }); assert.equal(response.status, 401, 'spoofed role header rejected');
    response = await request('/api/oblivion/traders', { headers:admin }); assert.equal(response.status, 200, 'JWT super_admin pass');
    response = await request('/api/oblivion/drafts', { method:'POST',headers:admin,body:JSON.stringify({traderId:'skad'}) }); assert.equal(response.status, 201); const draft=await response.json();
    response = await request(`/api/oblivion/drafts/${draft.draftId}/items/Canteen`, { method:'PATCH',headers:admin,body:JSON.stringify({enabled:true,sellEnabled:true,sellPrice:501}) }); assert.equal(response.status, 200);
    await request(`/api/oblivion/drafts/${draft.draftId}/validate`, {method:'POST',headers:admin,body:'{}'});
    response = await request(`/api/oblivion/drafts/${draft.draftId}/publish`, {method:'POST',headers:admin,body:'{}'}); assert.equal(response.status,201); const release=await response.json();
    const bridge = {'x-obc-bridge-token':process.env.OBC_TEST_BRIDGE_TOKEN};
    response = await request(`/api/oblivion/bridge/releases/${release.releaseId}/manifest`); assert.equal(response.status,401, 'bridge token required');
    response = await request(`/api/oblivion/bridge/releases/${release.releaseId}/manifest`,{headers:bridge}); assert.equal(response.status,200); const manifest=await response.json(); assert.equal(manifest.files.length,7);
    response = await request(`/api/oblivion/bridge/releases/${release.releaseId}/files/not-allowed`,{headers:bridge}); assert.equal(response.status,404);
    response = await request(`/api/oblivion/releases/${release.releaseId}/rollback-request`,{method:'POST',headers:admin,body:'{}'}); assert.equal(response.status,202); assert.equal((await response.json()).status,'ROLLBACK_PENDING');
});
