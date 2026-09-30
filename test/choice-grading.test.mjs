import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../web/choice-grading.js', import.meta.url), 'utf8'), context);
const rules = context.ChoiceGrading;
const q = {type:'single_choice',options:[{label:'A'},{label:'B'}],correct_labels:['B']};
test('可靠单选才自动判断，不解析答案文字或多标签', () => {
 assert.equal(rules.grade(q,new Set(['B'])),true);
 assert.equal(rules.grade(q,new Set(['A'])),false);
 for (const invalid of [{...q,correct_labels:[]},{...q,correct_labels:['C']},{...q,correct_labels:['A','B']},{...q,options:[]},{...q,type:'multiple_choice'},{...q,options:[{label:'B'},{label:'B'}]}]) assert.equal(rules.answer(invalid),null);
 assert.equal(rules.grade(q,new Set()),null);
});
test('选错降级并收藏易错，改对保留标记与作答时间', () => {
 const wrong=rules.patch(false,{mastery:'mastered'},false,10);
 assert.equal(wrong.mastery,'learning');assert.equal(wrong.favorite,true);assert.equal(wrong.error_prone,true);
 const correct=rules.patch(true,wrong,true,20);
 assert.equal(correct.mastery,'mastered');assert.equal(correct.favorite,true);assert.equal(correct.error_prone,true);
 assert.equal(correct.last_ok,true);assert.equal(correct.last_practiced_at,20);
 const fresh=rules.patch(true,{},false);assert.equal(fresh.favorite,false);assert.equal(fresh.error_prone,false);
});
