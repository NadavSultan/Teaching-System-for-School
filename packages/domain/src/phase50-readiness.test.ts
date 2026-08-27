import { describe, expect, it } from 'vitest';
import { decideValidationReadiness } from './validation.js';
const base={id:'run',revisionId:'rev',revisionSequence:1,state:'SUCCEEDED' as const,rulesetVersion:'rules',evaluatorVersion:'eval',completeEvidence:true,sourceEligible:true,deterministicBlocker:false,semanticBlocker:false,unacknowledgedWarning:false};
const decide=(run:object=base,source=true)=>decideValidationReadiness({revisionId:'rev',runs:[run as never],currentRulesetVersion:'rules',currentEvaluatorVersion:'eval',currentSourceEligible:source});
describe('Package 1B readiness matrix',()=>{
 it('no run requires validation',()=>expect(decideValidationReadiness({revisionId:'rev',runs:[],currentRulesetVersion:'rules',currentEvaluatorVersion:'eval',currentSourceEligible:true}).reasonCode).toBe('VALIDATION_REQUIRED'));
 it('pending blocks',()=>expect(decide({...base,state:'PENDING'}).reasonCode).toBe('VALIDATION_PENDING'));
 it('processing blocks',()=>expect(decide({...base,state:'PROCESSING'}).reasonCode).toBe('VALIDATION_PROCESSING'));
 it('failed evaluator blocks',()=>expect(decide({...base,state:'FAILED'}).reasonCode).toBe('VALIDATION_FAILED'));
 it('deterministic blocker blocks',()=>expect(decide({...base,deterministicBlocker:true}).reasonCode).toBe('DETERMINISTIC_BLOCKER'));
 it('semantic blocker blocks',()=>expect(decide({...base,semanticBlocker:true}).reasonCode).toBe('SEMANTIC_BLOCKER'));
 it('unacknowledged warning blocks',()=>expect(decide({...base,unacknowledgedWarning:true}).reasonCode).toBe('WARNING_ACKNOWLEDGEMENT_REQUIRED'));
 it('acknowledged warning is ready',()=>expect(decide()).toMatchObject({status:'READY'}));
 it('clean and INFO-only run is ready',()=>expect(decide()).toMatchObject({status:'READY'}));
 it('stale registry blocks',()=>expect(decide({...base,rulesetVersion:'old'}).reasonCode).toBe('VALIDATION_VERSION_STALE'));
 it('revoked current eligibility blocks',()=>expect(decide(base,false).reasonCode).toBe('SOURCE_ELIGIBILITY_CHANGED'));
 it('greatest sequence masks old success and ties fail closed',()=>{expect(decideValidationReadiness({revisionId:'rev',runs:[base,{...base,id:'new',revisionSequence:2,state:'PENDING'}],currentRulesetVersion:'rules',currentEvaluatorVersion:'eval',currentSourceEligible:true}).reasonCode).toBe('VALIDATION_PENDING');expect(decideValidationReadiness({revisionId:'rev',runs:[base,{...base,id:'tie',revisionSequence:1}],currentRulesetVersion:'rules',currentEvaluatorVersion:'eval',currentSourceEligible:true}).reasonCode).toBe('VALIDATION_FAILED');});
});
