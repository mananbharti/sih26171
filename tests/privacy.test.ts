import {test} from 'node:test';
import assert from 'node:assert/strict';
import {protect,firewall,validateFields} from '../src/privacy';
test('email, international phone, credentials and known names are masked',()=>{
 const result=protect('Aarav Mehta: aarav@example.com, +91 90000 00000 password=hunter42',{name:'Aarav Mehta'});
 for(const secret of ['Aarav Mehta','aarav@example.com','90000','hunter42'])assert.ok(!result.text.includes(secret));
 assert.equal(result.findings.length,4);assert.equal(firewall(result.text),result.text);
});
test('firewall fails closed for leaked email or credentials and oversized contexts',()=>{
 for(const value of ['leak@example.com','api_key=secret-secret','a'.repeat(32001)])assert.throws(()=>firewall(value));
});
test('safe content and empty input survive the scan',()=>{
 assert.equal(protect('A 12-week fellowship with INR 25,000 stipend').text,'A 12-week fellowship with INR 25,000 stipend');assert.deepEqual(protect('').findings,[]);
});
test('validator rejects password, unknown, multiline, empty and oversized actions',()=>{
 for(const input of [[],[{type:'password',key:'email',value:'secret'}],[{type:'text',key:'credit-card',value:'test'}],[{type:'text',key:'name',value:'a\nb'}],[{type:'text',key:'name',value:'a'.repeat(251)}]])assert.throws(()=>validateFields(input));
 assert.equal(validateFields([{type:'email',key:'email',value:'sample@example.com'}]),true);
});
