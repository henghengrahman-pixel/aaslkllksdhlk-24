const ACTION_ALLOWLIST = new Set([
  'SEND_MESSAGE',
  'ASK_MEMBER_ID',
  'ASK_PROOF',
  'SEND_HOLDING_MESSAGE',
  'ESCALATE_HUMAN',
  'UPDATE_CASE',
  'UPDATE_TICKET',
  'NO_REPLY'
]);

const HUMAN_STATES = new Set(['HUMAN_ACTIVE','HUMAN_TAKEOVER']);

function arr(v, max=50){ return Array.isArray(v) ? v.slice(0,max) : []; }
function txt(v,max=4000){ return String(v??'').trim().slice(0,max); }
function bool(v){ return Boolean(v); }
function normState(v=''){ return String(v||'BOT_ACTIVE').trim().toUpperCase().replace(/[^A-Z0-9_]/g,'_') || 'BOT_ACTIVE'; }

export function isHumanActiveState(state){ return HUMAN_STATES.has(normState(state)); }
export function isAgentAction(action){ return ACTION_ALLOWLIST.has(String(action||'').toUpperCase()); }
export function agentActionAllowlist(){ return [...ACTION_ALLOWLIST]; }

export function contextualClarification(input={}){
  const active=String(input.activeCase||input.currentIntent||input.previousIntent||'').toUpperCase();
  if(active.includes('WITHDRAW') || active==='WD') return 'Baik bosku, saya masih mengikuti kendala withdraw yang tadi ya. Bagian mana yang masih belum selesai?';
  if(active.includes('DEPOSIT') || active==='DP') return 'Baik bosku, saya masih mengikuti kendala deposit yang tadi ya. Bagian mana yang masih belum selesai?';
  if(active.includes('RESET') || active.includes('PASSWORD')) return 'Baik bosku, saya masih mengikuti proses reset akun yang tadi ya. Bagian mana yang masih belum selesai?';
  if(active.includes('BONUS')) return 'Baik bosku, saya masih mengikuti bonus yang tadi ya. Boleh jelaskan bagian yang masih belum selesai?';
  return 'Baik bosku, saya masih mengikuti kendala yang tadi ya. Boleh jelaskan bagian yang masih belum selesai?';
}

export function normalizeAgentInput(input={}){
  const state=normState(input.state);
  return {
    sessionId:txt(input.sessionId,240),
    conversationId:txt(input.conversationId,240),
    livechatChatId:txt(input.livechatChatId,240),
    threadId:txt(input.threadId,240),
    messageIds:arr(input.messageIds,100).map(x=>txt(x,240)).filter(Boolean),
    rawMessages:arr(input.rawMessages,100).map(x=>txt(x,4000)),
    normalizedMessages:arr(input.normalizedMessages,100).map(x=>txt(x,4000)),
    state,
    currentIntent:txt(input.currentIntent||'GENERAL',120).toUpperCase(),
    previousIntent:txt(input.previousIntent||'',120).toUpperCase(),
    activeCase:txt(input.activeCase||'',160).toUpperCase(),
    memberId:txt(input.memberId||'',240),
    memberIdKnown:bool(input.memberIdKnown || input.memberId),
    proofReceived:bool(input.proofReceived),
    telegramTicketExists:bool(input.telegramTicketExists),
    telegramTicketId:txt(input.telegramTicketId||'',240),
    telegramTicketStatus:txt(input.telegramTicketStatus||'',80).toUpperCase(),
    recentMessages:arr(input.recentMessages,80).map(m=>({
      sender:txt(m?.sender||m?.sender_type||'',40),
      text:txt(m?.text||'',4000),
      eventId:txt(m?.eventId||m?.event_id||'',240),
      createdAt:txt(m?.createdAt||m?.created_at||'',80)
    })),
    conversationSummary:txt(input.conversationSummary||'',12000),
    knowledge:txt(input.knowledge||'',30000),
    rules:txt(input.rules||'',30000),
    responses:txt(input.responses||'',30000),
    approvedLearningExamples:txt(input.approvedLearningExamples||'',20000),
    approvedCorrections:txt(input.approvedCorrections||'',20000),
    websiteProfile:input.websiteProfile && typeof input.websiteProfile==='object' ? input.websiteProfile : {},
    hasKnowledge:bool(input.hasKnowledge),
    attachments:arr(input.attachments,8),
    caseBrain:input.caseBrain && typeof input.caseBrain==='object' ? input.caseBrain : {}
  };
}

function legacyToAgentAction(decision={}){
  const a=String(decision.action||'').toUpperCase();
  const reply=txt(decision.reply,1200);
  if(a==='AUTO_REPLY') return 'SEND_MESSAGE';
  if(a==='ASK_INFO'){
    if(/(?:user\s*id|userid|id\s*(?:akun|member|user)|username)/i.test(reply)) return 'ASK_MEMBER_ID';
    if(/(?:bukti|screenshot|screen\s*shot|struk)/i.test(reply)) return 'ASK_PROOF';
    return 'SEND_MESSAGE';
  }
  if(a==='ASK_HUMAN' || a==='HANDOFF') return 'ESCALATE_HUMAN';
  return isAgentAction(a) ? a : 'ESCALATE_HUMAN';
}

function deriveNextState(input, decision, action){
  if(isHumanActiveState(input.state)) return 'HUMAN_ACTIVE';
  if(action==='ASK_MEMBER_ID') return 'WAITING_MEMBER_ID';
  if(action==='ASK_PROOF') return 'WAITING_PROOF';
  if(action==='ESCALATE_HUMAN' || action==='UPDATE_TICKET') return 'WAITING_HUMAN';
  const s=normState(decision?.brain?.status||decision?.status||'');
  if(s==='WAITING_MEMBER') return 'WAITING_MEMBER';
  if(s==='WAITING_HUMAN') return 'WAITING_HUMAN';
  return normState(input.state)==='NEW' ? 'BOT_ACTIVE' : normState(input.state);
}

export function validateAgentDecision(rawDecision={}, rawInput={}, {confidenceThreshold=0.86}={}){
  const input=normalizeAgentInput(rawInput);
  if(isHumanActiveState(input.state)){
    return {
      intent:txt(rawDecision?.brain?.primary_intent||rawDecision?.primary_intent||input.currentIntent||'GENERAL',120).toUpperCase(),
      subIntent:txt(rawDecision?.subIntent||'',120).toUpperCase(),
      confidence:Math.max(0,Math.min(1,Number(rawDecision?.confidence||0))),
      activeCase:input.activeCase||null,
      action:'NO_REPLY',reply:'',missingFields:[],shouldCreateTicket:false,shouldUpdateTicket:false,shouldEscalate:false,nextState:'HUMAN_ACTIVE',
      reason:'human_active_priority',brain:rawDecision?.brain||input.caseBrain,legacyDecision:rawDecision
    };
  }

  let action=legacyToAgentAction(rawDecision);
  let confidence=Math.max(0,Math.min(1,Number(rawDecision?.confidence||0)));
  let reply=txt(rawDecision?.reply,1200);
  const missing=arr(rawDecision?.brain?.missing_info||rawDecision?.brain?.missingInfo||rawDecision?.missingFields,30).map(x=>txt(x,160)).filter(Boolean);
  const intent=txt(rawDecision?.intent||rawDecision?.brain?.primary_intent||rawDecision?.primary_intent||input.currentIntent||'GENERAL',120).toUpperCase();
  const activeCase=txt(rawDecision?.activeCase||rawDecision?.active_case||input.activeCase||intent||'',160).toUpperCase()||null;
  let reason=txt(rawDecision?.reason||'',600);

  if(!isAgentAction(action)) { action='SEND_MESSAGE'; reply=contextualClarification(input); reason=`invalid_action_fallback|${reason}`; }
  if(action==='NO_REPLY') { action='SEND_MESSAGE'; reply=contextualClarification(input); reason=`no_reply_forbidden_outside_human|${reason}`; }

  if(confidence < Number(confidenceThreshold||0.86)){
    action='SEND_MESSAGE';
    reply=contextualClarification(input);
    reason=`low_confidence_contextual_clarification:${confidence.toFixed(2)}|${reason}`;
  }

  if(['SEND_MESSAGE','ASK_MEMBER_ID','ASK_PROOF','SEND_HOLDING_MESSAGE'].includes(action) && !reply){
    reply=contextualClarification(input);
    action='SEND_MESSAGE';
    reason=`empty_reply_safe_fallback|${reason}`;
  }

  if(action==='ASK_MEMBER_ID' && input.memberIdKnown){
    action='SEND_MESSAGE';
    reply=contextualClarification(input);
    reason=`member_id_already_known|${reason}`;
  }
  if(action==='ASK_PROOF' && input.proofReceived){
    action='SEND_MESSAGE';
    reply=contextualClarification(input);
    reason=`proof_already_received|${reason}`;
  }

  const shouldEscalate=action==='ESCALATE_HUMAN';
  const derivedNext=deriveNextState(input,rawDecision,action);
  const requestedNext=normState(rawDecision?.nextState||rawDecision?.next_state||'');
  const validNext=new Set(['NEW','BOT_ACTIVE','WAITING_MEMBER','WAITING_MEMBER_ID','WAITING_PROOF','WAITING_HUMAN','HUMAN_ACTIVE','RESOLVED','CLOSED']);
  const nextState=validNext.has(requestedNext) && requestedNext!=='HUMAN_ACTIVE' ? requestedNext : derivedNext;
  return {
    intent,
    subIntent:txt(rawDecision?.subIntent||'',120).toUpperCase(),
    confidence,
    activeCase,
    action,
    reply,
    missingFields:missing,
    shouldCreateTicket:shouldEscalate && !input.telegramTicketExists,
    shouldUpdateTicket:(shouldEscalate || action==='UPDATE_TICKET') && input.telegramTicketExists,
    shouldEscalate,
    nextState,
    reason,
    brain:rawDecision?.brain||input.caseBrain,
    legacyDecision:rawDecision
  };
}

export function agentDecisionToLegacy(agentDecision={}){
  const a=String(agentDecision.action||'SEND_MESSAGE').toUpperCase();
  const legacyAction = a==='ESCALATE_HUMAN' ? 'ASK_HUMAN'
    : (a==='ASK_MEMBER_ID'||a==='ASK_PROOF') ? 'ASK_INFO'
    : a==='NO_REPLY' ? 'NO_REPLY'
    : 'AUTO_REPLY';
  return {
    ...(agentDecision.legacyDecision||{}),
    action:legacyAction,
    confidence:Number(agentDecision.confidence||0),
    reply:String(agentDecision.reply||''),
    reason:String(agentDecision.reason||''),
    brain:agentDecision.brain||agentDecision.legacyDecision?.brain||{}
  };
}

export async function runConversationAgent({client,input,style={},confidenceThreshold=0.86}={}){
  const ctx=normalizeAgentInput(input);
  if(!client || typeof client.classifyAndReply!=='function') throw new Error('AI_AGENT_CLIENT_REQUIRED');
  const contextJson=JSON.stringify({
    sessionId:ctx.sessionId,conversationId:ctx.conversationId,livechatChatId:ctx.livechatChatId,threadId:ctx.threadId,
    messageIds:ctx.messageIds,rawMessages:ctx.rawMessages,normalizedMessages:ctx.normalizedMessages,
    state:ctx.state,currentIntent:ctx.currentIntent,previousIntent:ctx.previousIntent,activeCase:ctx.activeCase,
    memberId:ctx.memberId,memberIdKnown:ctx.memberIdKnown,proofReceived:ctx.proofReceived,
    telegramTicketExists:ctx.telegramTicketExists,telegramTicketId:ctx.telegramTicketId,telegramTicketStatus:ctx.telegramTicketStatus,
    recentMessages:ctx.recentMessages,conversationSummary:ctx.conversationSummary,websiteProfile:ctx.websiteProfile,caseBrain:ctx.caseBrain
  },null,2);
  let raw;
  if(typeof client.decideAgent==='function'){
    raw=await client.decideAgent({input:ctx,style});
  }else{
    // Backward-compatible adapter for tests/older client implementations. Production OpenAIClient
    // implements decideAgent() and returns the final action allowlist directly.
    raw=await client.classifyAndReply({
      normalized:ctx.normalizedMessages.join('\n') || ctx.rawMessages.join('\n'),
      intent:ctx.currentIntent,
      context:`AI_AGENT_STRUCTURED_CONTEXT:\n${contextJson}`,
      rules:ctx.rules,
      knowledge:[ctx.knowledge,ctx.responses,ctx.approvedCorrections].filter(Boolean).join('\n'),
      attachments:ctx.attachments,
      style,
      conversationDigest:ctx.conversationSummary,
      csStyleExamples:ctx.approvedLearningExamples,
      historyLearning:ctx.approvedLearningExamples,
      caseBrain:ctx.caseBrain
    });
  }
  return validateAgentDecision(raw,ctx,{confidenceThreshold});
}
